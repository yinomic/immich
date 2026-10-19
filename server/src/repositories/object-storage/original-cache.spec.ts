import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { vitest } from 'vitest';
import { OriginalCache } from 'src/repositories/object-storage/original-cache.js';

const DAY = 24 * 60 * 60 * 1000;

const read = (path: string) => readFile(path, 'utf8');

/** a file the upload flow would have staged locally */
const staged = async (staging: string, name: string) => {
  const path = join(staging, name);
  await writeFile(path, 'photo');
  return path;
};

const age = async (path: string, hours: number) => {
  const when = new Date(Date.now() - hours * 60 * 60 * 1000);
  await utimes(path, when, when);
};

describe(OriginalCache.name, () => {
  const roots: string[] = [];

  const setup = async (options?: { maxBytes?: number; ttlMs?: number }) => {
    const root = await mkdtemp(join(tmpdir(), 'immich-original-cache-'));
    roots.push(root);
    const folder = join(root, 'originals');
    const staging = join(root, 'staging');
    await mkdir(staging, { recursive: true });

    const cache = new OriginalCache({
      folder,
      maxBytes: options?.maxBytes ?? 1024,
      ttlMs: options?.ttlMs ?? 60_000,
    });

    return { cache, folder, staging };
  };

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('should only be enabled when it has room', async () => {
    await expect(setup({ maxBytes: 0 }).then(({ cache }) => cache.enabled)).resolves.toBe(false);
    await expect(setup({ maxBytes: 1 }).then(({ cache }) => cache.enabled)).resolves.toBe(true);
  });

  it('should download an object once and serve the next caller from disk', async () => {
    const { cache } = await setup();
    const load = vitest.fn((destination: string) => writeFile(destination, 'photo'));

    await expect(cache.withEntry('upload/a.jpg', load, read)).resolves.toBe('photo');
    await expect(cache.withEntry('upload/a.jpg', load, read)).resolves.toBe('photo');
    await expect(cache.withEntry('upload/a.jpg', load, read)).resolves.toBe('photo');

    // the three jobs an upload queues used to be three downloads
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('should share a single download between concurrent callers', async () => {
    const { cache } = await setup();
    const load = vitest.fn(async (destination: string) => {
      await delay(20);
      await writeFile(destination, 'photo');
    });

    const contents = await Promise.all(
      ['a', 'b', 'c'].map(() => cache.withEntry('upload/a.jpg', load, (path) => readFile(path, 'utf8'))),
    );

    expect(contents).toEqual(['photo', 'photo', 'photo']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('should clean up after a failed download', async () => {
    const { cache, folder } = await setup();
    const load = vitest.fn().mockRejectedValue(new Error('bucket is gone'));

    await expect(cache.withEntry('upload/a.jpg', load, () => Promise.resolve())).rejects.toThrow('bucket is gone');
    await expect(readdir(folder)).resolves.toEqual([]);
  });

  it('should keep a seeded upload and drop the staging copy', async () => {
    const { cache, staging } = await setup();
    const source = await staged(staging, 'upload-a');

    await expect(cache.seed('upload/a.jpg', source)).resolves.toBe(true);
    await expect(stat(source)).rejects.toThrow();

    const path = await cache.lookup('upload/a.jpg');
    expect(path).toEqual(expect.stringContaining('originals'));
    await expect(readFile(path!, 'utf8')).resolves.toBe('photo');
  });

  it('should refuse to seed an object that would fill the whole cache', async () => {
    const { cache, staging } = await setup({ maxBytes: 4 });
    const source = await staged(staging, 'upload-a');

    await expect(cache.seed('upload/a.jpg', source)).resolves.toBe(false);
    // the caller still owns the file and cleans it up
    await expect(stat(source)).resolves.toBeDefined();
    await expect(cache.lookup('upload/a.jpg')).resolves.toBeUndefined();
  });

  it('should expire a copy that has not been used', async () => {
    const { cache, staging } = await setup({ ttlMs: 1000 });
    await cache.seed('upload/a.jpg', await staged(staging, 'upload-a'));

    const path = (await cache.lookup('upload/a.jpg'))!;
    await age(path, 1);

    await expect(cache.lookup('upload/a.jpg')).resolves.toBeUndefined();
    await expect(stat(path)).rejects.toThrow();
  });

  it('should drop an invalidated copy', async () => {
    const { cache, staging } = await setup();
    await cache.seed('upload/a.jpg', await staged(staging, 'upload-a'));

    await cache.invalidate('upload/a.jpg');

    await expect(cache.lookup('upload/a.jpg')).resolves.toBeUndefined();
  });

  it('should evict the least recently used copy when it runs out of room', async () => {
    const { cache, staging } = await setup({ maxBytes: 10, ttlMs: DAY });

    await cache.seed('upload/a.jpg', await staged(staging, 'upload-a'));
    await cache.seed('upload/b.jpg', await staged(staging, 'upload-b'));
    await age((await cache.lookup('upload/a.jpg'))!, 3);
    await age((await cache.lookup('upload/b.jpg'))!, 2);
    await cache.seed('upload/c.jpg', await staged(staging, 'upload-c'));
    await age((await cache.lookup('upload/c.jpg'))!, 1);

    // this one has no room left, so the oldest copy has to go
    await cache.seed('upload/d.jpg', await staged(staging, 'upload-d'));

    await expect(cache.lookup('upload/a.jpg')).resolves.toBeUndefined();
    await expect(cache.lookup('upload/b.jpg')).resolves.toEqual(expect.any(String));
    await expect(cache.lookup('upload/c.jpg')).resolves.toEqual(expect.any(String));
  });

  it('should never evict a copy that a caller is reading', async () => {
    const { cache, staging } = await setup({ maxBytes: 5, ttlMs: DAY });
    await cache.seed('upload/a.jpg', await staged(staging, 'upload-a'));
    await age((await cache.lookup('upload/a.jpg'))!, 3);
    await cache.seed('upload/b.jpg', await staged(staging, 'upload-b'));

    const readWhileSeeding = cache.withEntry(
      'upload/a.jpg',
      () => Promise.reject(new Error('should have been cached')),
      async (path) => {
        // two more objects: the cache is far over its limit now, and the copies
        // that are not being read have to give way
        await cache.seed('upload/c.jpg', await staged(staging, 'upload-c'));
        await cache.seed('upload/d.jpg', await staged(staging, 'upload-d'));
        return readFile(path, 'utf8');
      },
    );

    await expect(readWhileSeeding).resolves.toBe('photo');
  });
});

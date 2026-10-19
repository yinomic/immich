import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { vitest } from 'vitest';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { LocalObjectStorage } from 'src/repositories/object-storage/local-object-storage.js';
import { ObjectStorageRepository } from 'src/repositories/object-storage.repository.js';
import { mockEnvData } from 'test/repositories/config.repository.mock.js';
import { automock } from 'test/utils.js';

const setup = (softDeleteOnly: boolean) => {
  const config = { getEnv: () => mockEnvData({ storage: { ...mockEnvData({}).storage, softDeleteOnly } }) };
  // eslint-disable-next-line no-sparse-arrays
  const logger = automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false });
  const sut = new ObjectStorageRepository(config as never, logger);

  return { sut, logger };
};

/** the object is only ever read through `stream`, never buffered */
const newRemoteStorage = () => ({
  isRemote: () => true,
  stream: vitest.fn().mockImplementation(() => Promise.resolve(Readable.from('photo'))),
  get: vitest.fn(),
  put: vitest.fn().mockResolvedValue(undefined),
  putFile: vitest.fn().mockResolvedValue(undefined),
  rename: vitest.fn().mockResolvedValue(undefined),
});

const read = (path: string) => readFile(path, 'utf8');

describe(ObjectStorageRepository.name, () => {
  it('should keep the objects when soft delete only is on', async () => {
    const { sut, logger } = setup(true);
    const storage = sut as unknown as { storage?: LocalObjectStorage };
    const deleteSpy = vitest.fn();
    storage.storage = { delete: deleteSpy, isRemote: () => true } as never;

    await sut.delete(['upload/a.jpg', 'upload/b.jpg']);

    expect(deleteSpy).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Soft delete only: keeping 2 object(s)'));
  });

  it('should delegate the deletion when the switch is off', async () => {
    const { sut } = setup(false);
    const storage = sut as unknown as { storage?: LocalObjectStorage };
    const deleteSpy = vitest.fn().mockResolvedValue(undefined);
    storage.storage = { delete: deleteSpy, isRemote: () => true } as never;

    await sut.delete(['upload/a.jpg']);

    expect(deleteSpy).toHaveBeenCalledWith(['upload/a.jpg']);
  });

  describe('object storage', () => {
    const roots: string[] = [];

    const setupRemote = async (options?: { cacheMb?: number; remote?: boolean }) => {
      const root = await mkdtemp(join(tmpdir(), 'immich-object-storage-'));
      roots.push(root);
      const config = {
        getEnv: () =>
          mockEnvData({
            storage: {
              ...mockEnvData({}).storage,
              backend: 'tos',
              cacheLocation: root,
              originalCacheMb: options?.cacheMb ?? 1024,
            },
          }),
      };
      // eslint-disable-next-line no-sparse-arrays
      const logger = automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false });
      const sut = new ObjectStorageRepository(config as never, logger);
      const storage = newRemoteStorage();
      if (options?.remote === false) {
        storage.isRemote = () => false;
      }

      (sut as unknown as { storage?: unknown }).storage = storage;

      const stage = async (name: string) => {
        const path = join(root, name);
        await writeFile(path, 'photo');
        return path;
      };

      return { sut, storage, root, read, stage };
    };

    afterEach(async () => {
      await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
    });

    it('should materialise an object once and reuse it for the follow-up jobs', async () => {
      const { sut, storage, read } = await setupRemote();

      // metadata extraction, thumbnail generation, edited thumbnails
      await expect(sut.withLocalCopy('upload/a.jpg', read)).resolves.toBe('photo');
      await expect(sut.withLocalCopy('upload/a.jpg', read)).resolves.toBe('photo');
      await expect(sut.withLocalCopy('upload/a.jpg', read)).resolves.toBe('photo');

      expect(storage.stream).toHaveBeenCalledTimes(1);
      expect(storage.get).not.toHaveBeenCalled();
    });

    it('should serve the local path as-is when the library is on disk', async () => {
      const { sut, storage, stage, read } = await setupRemote({ remote: false });
      const path = await stage('local.jpg');

      await expect(sut.withLocalCopy(path, read)).resolves.toBe('photo');

      expect(storage.stream).not.toHaveBeenCalled();
    });

    it('should not download a file that was just uploaded', async () => {
      const { sut, storage, read, stage } = await setupRemote();
      const path = await stage('staged.jpg');

      await sut.seedLocalCopy('upload/a.jpg', path);

      await expect(stat(path)).rejects.toThrow();
      await expect(sut.withLocalCopy('upload/a.jpg', read)).resolves.toBe('photo');
      expect(storage.stream).not.toHaveBeenCalled();
    });

    it('should delete the staged file when caching is switched off', async () => {
      const { sut, storage, read, stage } = await setupRemote({ cacheMb: 0 });
      const path = await stage('staged.jpg');

      await sut.seedLocalCopy('upload/a.jpg', path);

      await expect(stat(path)).rejects.toThrow();
      await expect(sut.withLocalCopy('upload/a.jpg', read)).resolves.toBe('photo');
      expect(storage.stream).toHaveBeenCalledTimes(1);
    });

    it('should drop the cached copy when the object changes', async () => {
      const { sut, storage, read } = await setupRemote();

      await sut.withLocalCopy('upload/a.jpg', read);
      await sut.put('upload/a.jpg', Buffer.from('edited'));
      await sut.withLocalCopy('upload/a.jpg', read);

      expect(storage.stream).toHaveBeenCalledTimes(2);
    });

    it('should write changes back without caching them', async () => {
      const { sut, storage, read } = await setupRemote();

      await sut.withLocalCopy('upload/a.jpg', (path) => writeFile(path, 'edited'), {
        uploadBack: true,
        contentType: 'image/jpeg',
      });

      expect(storage.putFile).toHaveBeenCalledWith('upload/a.jpg', expect.stringContaining('immich-object-'), {
        contentType: 'image/jpeg',
      });
      // the edited bytes are in the bucket, not in the cache
      await expect(sut.withLocalCopy('upload/a.jpg', read)).resolves.toBe('photo');
      expect(storage.stream).toHaveBeenCalledTimes(2);
    });

    it('should upload a local file without buffering it', async () => {
      const { sut, storage, stage } = await setupRemote();
      const path = await stage('staged.jpg');

      await sut.putFile('upload/a.jpg', path, { contentType: 'image/jpeg' });

      expect(storage.putFile).toHaveBeenCalledWith('upload/a.jpg', path, { contentType: 'image/jpeg' });
    });

    it('should move an object inside the bucket, keeping its cached copy', async () => {
      const { sut, storage, read } = await setupRemote();

      await sut.withLocalCopy('upload/a.jpg', read);
      await sut.rename('upload/a.jpg', 'library/admin/2026/09/12/a.jpg');

      expect(storage.rename).toHaveBeenCalledWith('upload/a.jpg', 'library/admin/2026/09/12/a.jpg');
      // the cached copy moved along, so the follow-up job is not a download
      await expect(sut.withLocalCopy('library/admin/2026/09/12/a.jpg', read)).resolves.toBe('photo');
      expect(storage.stream).toHaveBeenCalledTimes(1);
    });
  });
});

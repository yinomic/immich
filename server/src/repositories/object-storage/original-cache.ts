import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, utimes } from 'node:fs/promises';
import { extname, join } from 'node:path';

export interface OriginalCacheOptions {
  /** where the copies live (inside the disposable cache location) */
  folder: string;
  /** hard limit for the whole cache in bytes; `0` disables it */
  maxBytes: number;
  /** how long an *unused* copy stays around */
  ttlMs: number;
}

/** materialise the object at `destination` (a temporary path the cache renames into place) */
export type OriginalLoader = (destination: string) => Promise<void>;

/**
 * A short-lived local copy of recently used library objects.
 *
 * exiftool, sharp and ffmpeg all need a real file, so every job that touches an
 * original had to download it from the bucket again — a single upload therefore
 * cost three full downloads of the very bytes that were just sent (metadata
 * extraction, thumbnails, and the edited-thumbnail pass). Keeping the object on
 * disk for a while means a burst of jobs for one asset is served locally, and a
 * freshly uploaded file is cached before those jobs even run.
 *
 * The folder is disposable: it holds nothing that is not in the bucket and can
 * be deleted at any time. `mtime` is both the idle timer and the LRU clock, so a
 * copy that keeps being used stays, and one that is never read again expires.
 */
export class OriginalCache {
  /** concurrent callers for the same key share one download */
  private readonly inflight = new Map<string, Promise<string>>();
  /** paths handed to a callback right now — never evict those */
  private readonly inUse = new Map<string, number>();
  private pruning?: Promise<void>;

  constructor(private readonly options: OriginalCacheOptions) {}

  get enabled(): boolean {
    return this.options.maxBytes > 0;
  }

  /** the local copy of `key`, or undefined when it is not cached (anymore) */
  async lookup(key: string): Promise<string | undefined> {
    const path = this.pathFor(key);
    try {
      const { mtimeMs } = await stat(path);
      if (Date.now() - mtimeMs > this.options.ttlMs) {
        await rm(path, { force: true });
        return undefined;
      }

      const now = new Date();
      await utimes(path, now, now);
      return path;
    } catch {
      return undefined;
    }
  }

  /**
   * Run `callback` against a local copy of the object.
   *
   * Callers may run concurrently for the same object, so the callback must treat
   * the path as read-only — anything that modifies the file has to go through
   * `ObjectStorageRepository.withLocalCopy(..., { uploadBack: true })`.
   */
  async withEntry<T>(key: string, load: OriginalLoader, callback: (path: string) => Promise<T>): Promise<T> {
    const cached = await this.lookup(key);
    const path = cached ?? (await this.materialize(key, load));

    this.retain(path);
    try {
      return await callback(path);
    } finally {
      this.release(path);
    }
  }

  /**
   * Store a file that is already local (a freshly staged upload) under `key`.
   * Returns false when it could not be cached, so the caller can clean up.
   */
  async seed(key: string, sourcePath: string): Promise<boolean> {
    const { size } = await stat(sourcePath);
    if (size > this.options.maxBytes) {
      // never let one object push everything else out
      return false;
    }

    await mkdir(this.options.folder, { recursive: true });
    const destination = this.pathFor(key);
    await rm(destination, { force: true });

    // make room first: the copy we are about to add must never be its own victim
    await this.prune();

    try {
      // both folders live under the cache location, so this is a cheap rename
      await rename(sourcePath, destination);
      return true;
    } catch {
      // e.g. an unexpected cross-device staging folder: just do not cache it,
      // the object is safely in the bucket already
      return false;
    }
  }

  /** drop the copy of `key`: the object changed, so the cached bytes are stale */
  async invalidate(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private retain(path: string) {
    this.inUse.set(path, (this.inUse.get(path) ?? 0) + 1);
  }

  private release(path: string) {
    const users = (this.inUse.get(path) ?? 0) - 1;
    if (users > 0) {
      this.inUse.set(path, users);
    } else {
      this.inUse.delete(path);
    }
  }

  private materialize(key: string, load: OriginalLoader): Promise<string> {
    const running = this.inflight.get(key);
    if (running) {
      return running;
    }

    const promise = this.load(key, load).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async load(key: string, load: OriginalLoader): Promise<string> {
    await mkdir(this.options.folder, { recursive: true });
    const destination = this.pathFor(key);
    // make room before the download, so the object we are fetching cannot be
    // evicted out from under the callback that is waiting for it
    await this.prune();

    // download next to the final name and rename afterwards, so a reader never
    // sees a half-written object
    const temporary = `${destination}.${randomUUID()}.part`;
    try {
      await load(temporary);
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }

    return destination;
  }

  /** keep the folder under `maxBytes` by dropping the least recently used copies */
  private prune(): Promise<void> {
    if (this.pruning) {
      return this.pruning;
    }

    this.pruning = this.evict()
      .catch(() => {})
      .finally(() => {
        this.pruning = undefined;
      });

    return this.pruning;
  }

  private async evict(): Promise<void> {
    const entries = await readdir(this.options.folder, { withFileTypes: true });
    const files: { path: string; size: number; mtimeMs: number }[] = [];
    let total = 0;

    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith('.part')) {
        continue;
      }

      const path = join(this.options.folder, entry.name);
      try {
        const { size, mtimeMs } = await stat(path);
        files.push({ path, size, mtimeMs });
        total += size;
      } catch {
        // it vanished while we were looking at it
      }
    }

    if (total <= this.options.maxBytes) {
      return;
    }

    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const file of files) {
      if (total <= this.options.maxBytes) {
        return;
      }
      if (this.inUse.has(file.path)) {
        continue;
      }

      await rm(file.path, { force: true });
      total -= file.size;
    }
  }

  private pathFor(key: string): string {
    const digest = createHash('sha1').update(key).digest('hex');
    // keep the extension: some tools are happier with one
    const extension = extname(key).replaceAll(/[^\w.]/g, '');
    return join(this.options.folder, `${digest}${extension}`);
  }
}

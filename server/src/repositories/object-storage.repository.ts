import { Injectable } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { LocalObjectStorage } from 'src/repositories/object-storage/local-object-storage.js';
import { ObjectStorage } from 'src/repositories/object-storage/object-storage.js';
import { OriginalCache } from 'src/repositories/object-storage/original-cache.js';
import { TosObjectStorage } from 'src/repositories/object-storage/tos-object-storage.js';

const DEFAULT_CACHE_MB = 2048;
const DEFAULT_CACHE_TTL_SECONDS = 900;

/**
 * The library backend: local filesystem (default) or a Volcengine TOS bucket.
 *
 * Selected with `IMMICH_STORAGE_BACKEND=tos` plus the `TOS_*` variables.
 *
 * Objects are never downloaded more often than necessary: `withLocalCopy` serves
 * tooling (exiftool, sharp, ffmpeg) from a short-lived local cache, and an upload
 * seeds that cache with the file it just sent — so the follow-up jobs for a new
 * asset cost no egress at all.
 */
@Injectable()
export class ObjectStorageRepository implements ObjectStorage {
  private storage?: ObjectStorage;
  private cache?: OriginalCache;

  constructor(
    private configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(ObjectStorageRepository.name);
  }

  isRemote(): boolean {
    return this.getStorage().isRemote();
  }

  async put(key: string, body: Buffer | Readable, contentType?: string): Promise<void> {
    await this.getStorage().put(key, body, contentType);
    await this.invalidateCache(key);
  }

  async putFile(key: string, filePath: string, options?: { contentType?: string }): Promise<void> {
    await this.getStorage().putFile(key, filePath, options);
    await this.invalidateCache(key);
  }

  get(key: string): Promise<Buffer> {
    return this.getStorage().get(key);
  }

  stream(key: string): Promise<Readable> {
    return this.getStorage().stream(key);
  }

  exists(key: string): Promise<boolean> {
    return this.getStorage().exists(key);
  }

  size(key: string): Promise<number | undefined> {
    return this.getStorage().size(key);
  }

  async delete(keys: string[]): Promise<void> {
    // NOTE (family fork): the objects are the family's photos — with soft delete only
    // (the default) they are never removed from the bucket.
    if (this.configRepository.getEnv().storage.softDeleteOnly) {
      this.logger.log(`Soft delete only: keeping ${keys.length} object(s) in the bucket`);
      return;
    }

    return this.deleteObjects(keys);
  }

  private async deleteObjects(keys: string[]): Promise<void> {
    await this.getStorage().delete(keys);
    await Promise.all(keys.map((key) => this.invalidateCache(key)));
  }

  /**
   * Move an object inside the bucket (a storage template migration renames an
   * original to its library path). The copy happens in the bucket, so no bytes
   * travel through this server, and the local copy moves along with it.
   */
  async rename(source: string, target: string): Promise<void> {
    await this.getStorage().rename(source, target);
    if (this.cache) {
      await this.cache.relocate(source, target);
    }
  }

  presign(key: string, options?: { contentType?: string; fileName?: string; ttlSeconds?: number }): Promise<string> {
    return this.getStorage().presign(key, options);
  }

  localPath(key: string): string {
    return this.getStorage().localPath(key);
  }

  /**
   * Materialise a remote object as a local file so tools that need a real path
   * (exiftool, sharp, ffmpeg) keep working.
   *
   * The copy comes from the local originals cache when possible, so a burst of
   * jobs for the same asset only costs one download. `uploadBack` forces a
   * private copy: that callback modifies the file, and the result is pushed back
   * to the bucket.
   */
  async withLocalCopy<T>(
    key: string,
    callback: (path: string) => Promise<T>,
    options?: { uploadBack?: boolean; contentType?: string },
  ): Promise<T> {
    if (!this.isRemote()) {
      // local backend: the argument already is a usable path
      return callback(key);
    }

    const cache = this.getCache();
    if (options?.uploadBack || !cache.enabled) {
      return this.withTemporaryCopy(key, callback, options);
    }

    return cache.withEntry(key, (destination) => this.downloadToFile(key, destination), callback);
  }

  /**
   * Keep a local file that was just uploaded, so the jobs queued by the upload
   * (metadata, thumbnails) read from disk instead of downloading back the bytes
   * we have only just sent. Removes the file when it cannot be cached.
   */
  async seedLocalCopy(key: string, localPath: string): Promise<void> {
    const cache = this.getCache();
    let cached = false;
    if (cache.enabled) {
      try {
        cached = await cache.seed(key, localPath);
      } catch (error) {
        this.logger.warn(`Unable to cache the uploaded object ${key}: ${error}`);
      }
    }

    if (!cached) {
      await this.removeLocalFile(localPath);
    }
  }

  /** remove a file that only exists locally (staged uploads, temp copies) */
  async removeLocalFile(filepath: string): Promise<void> {
    await rm(filepath, { force: true });
  }

  private async withTemporaryCopy<T>(
    key: string,
    callback: (path: string) => Promise<T>,
    options?: { uploadBack?: boolean; contentType?: string },
  ): Promise<T> {
    const folder = await mkdtemp(join(tmpdir(), 'immich-object-'));
    const path = join(folder, 'object');
    try {
      await this.downloadToFile(key, path);
      const result = await callback(path);

      if (options?.uploadBack) {
        await this.getStorage().putFile(key, path, { contentType: options.contentType });
        await this.invalidateCache(key);
      }

      return result;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  /** stream the object to disk: a 4 GB video must not go through a Buffer */
  private async downloadToFile(key: string, destination: string): Promise<void> {
    await mkdir(dirname(destination), { recursive: true });
    const stream = await this.getStorage().stream(key);
    try {
      await pipeline(stream, createWriteStream(destination));
    } catch (error) {
      // do not leave a partial file behind for the next reader
      await rm(destination, { force: true });
      throw error;
    }
  }

  private invalidateCache(key: string): Promise<void> {
    return this.cache?.invalidate(key) ?? Promise.resolve();
  }

  private getCache(): OriginalCache {
    if (!this.cache) {
      const { storage } = this.configRepository.getEnv();
      this.cache = new OriginalCache({
        folder: join(storage.cacheLocation, 'originals'),
        maxBytes: (storage.originalCacheMb ?? DEFAULT_CACHE_MB) * 1024 * 1024,
        ttlMs: (storage.originalCacheTtlSeconds ?? DEFAULT_CACHE_TTL_SECONDS) * 1000,
      });
    }

    return this.cache;
  }

  private getStorage(): ObjectStorage {
    if (this.storage) {
      return this.storage;
    }

    const { storage } = this.configRepository.getEnv();
    if (storage.backend === 'tos') {
      const tos = storage.tos;
      this.storage = new TosObjectStorage(
        {
          endpoint: tos.endpoint,
          region: tos.region,
          bucket: tos.bucket,
          accessKeyId: tos.accessKeyId,
          accessKeySecret: tos.accessKeySecret,
          prefix: tos.prefix,
          presignTtlSeconds: tos.presignTtlSeconds,
        },
        this.logger,
      );
      return this.storage;
    }

    this.storage = new LocalObjectStorage(storage.mediaLocation ?? '/data');
    return this.storage;
  }
}

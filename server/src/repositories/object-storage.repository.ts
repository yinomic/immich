import { Injectable } from '@nestjs/common';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { LocalObjectStorage } from 'src/repositories/object-storage/local-object-storage.js';
import { ObjectStorage } from 'src/repositories/object-storage/object-storage.js';
import { S3ObjectStorage } from 'src/repositories/object-storage/s3-object-storage.js';

/**
 * The library backend: local filesystem (default) or an S3-compatible bucket.
 *
 * Selected with `IMMICH_STORAGE_BACKEND=s3` plus the `S3_*` variables.
 */
@Injectable()
export class ObjectStorageRepository implements ObjectStorage {
  private storage?: ObjectStorage;

  constructor(
    private configRepository: ConfigRepository,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(ObjectStorageRepository.name);
  }

  isRemote(): boolean {
    return this.getStorage().isRemote();
  }

  put(key: string, body: Buffer | Readable, contentType?: string): Promise<void> {
    return this.getStorage().put(key, body, contentType);
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

  delete(keys: string[]): Promise<void> {
    return this.getStorage().delete(keys);
  }

  presign(key: string, options?: { contentType?: string; fileName?: string; ttlSeconds?: number }): Promise<string> {
    return this.getStorage().presign(key, options);
  }

  localPath(key: string): string {
    return this.getStorage().localPath(key);
  }

  /**
   * Materialise a remote object as a local file so tools that need a real path
   * (exiftool, sharp, ffmpeg) keep working. The temporary copy is removed again
   * afterwards; `uploadBack` pushes changes back to the bucket.
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

    const folder = await mkdtemp(join(tmpdir(), 'immich-object-'));
    const path = join(folder, 'object');
    try {
      await writeFile(path, await this.get(key));
      const result = await callback(path);

      if (options?.uploadBack) {
        await this.put(key, await this.readLocalFile(path), options.contentType);
      }

      return result;
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  }

  private async readLocalFile(path: string): Promise<Buffer> {
    const { readFile } = await import('node:fs/promises');
    return readFile(path);
  }

  /** create the folder a local (temporary) write will go to */
  async ensureLocalFolder(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
  }

  private getStorage(): ObjectStorage {
    if (this.storage) {
      return this.storage;
    }

    const { storage } = this.configRepository.getEnv();
    if (storage.backend === 's3') {
      const s3 = storage.s3;
      this.storage = new S3ObjectStorage(
        {
          endpoint: s3.endpoint,
          region: s3.region,
          bucket: s3.bucket,
          accessKeyId: s3.accessKeyId,
          secretAccessKey: s3.secretAccessKey,
          forcePathStyle: s3.forcePathStyle,
          prefix: s3.prefix,
          presignTtlSeconds: s3.presignTtlSeconds,
        },
        this.logger,
      );
      return this.storage;
    }

    this.storage = new LocalObjectStorage(storage.mediaLocation ?? '/data');
    return this.storage;
  }
}

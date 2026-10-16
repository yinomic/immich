import { Readable } from 'node:stream';

/**
 * Where the library itself lives.
 *
 * `local` keeps the historical behaviour (absolute paths under the media
 * location). `s3` stores the library in an S3-compatible bucket (Volcengine
 * TOS, Tencent COS, MinIO, ...) and makes every media path an object key.
 *
 * Only original files, sidecars, profile images and backups live here. Derived
 * files (thumbnails, transcodes) never leave the local cache.
 */
export interface ObjectStorage {
  isRemote(): boolean;

  put(key: string, body: Buffer | Readable, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  exists(key: string): Promise<boolean>;
  size(key: string): Promise<number | undefined>;
  delete(keys: string[]): Promise<void>;
  /** URL the client can fetch directly (remote) or the local absolute path */
  presign(key: string, options?: { contentType?: string; fileName?: string; ttlSeconds?: number }): Promise<string>;
  /** local absolute path for a key (local backend only) */
  localPath(key: string): string;
}

export class ObjectStorageError extends Error {
  constructor(
    message: string,
    readonly options?: { cause?: unknown; status?: number },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = ObjectStorageError.name;
  }
}

/** Keys are always relative and posix-style; keep them normalised in one place. */
export const normalizeKey = (key: string): string =>
  key
    .replaceAll('\\', '/')
    .replace(/^\.?\//, '')
    .replaceAll(/\/{2,}/g, '/');

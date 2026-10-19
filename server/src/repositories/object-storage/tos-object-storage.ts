import { TosClient, TosClientError, TosServerError } from '@volcengine/tos-sdk';
import { Readable } from 'node:stream';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { ObjectStorage, ObjectStorageError, normalizeKey } from 'src/repositories/object-storage/object-storage.js';
import { mimeTypes } from 'src/utils/mime-types.js';

export interface TosObjectStorageOptions {
  /** e.g. tos-cn-beijing.volces.com (no scheme) */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  /** optional key prefix, e.g. `immich/` */
  prefix?: string;
  presignTtlSeconds?: number;
}

/**
 * Volcengine TOS (对象存储) backend, using the official TOS SDK.
 *
 * `tos-server` is handled by the SDK, so no S3 compatibility layer, no chunked
 * transfer encoding and no Content-MD5 workarounds are needed.
 */
export class TosObjectStorage implements ObjectStorage {
  private readonly client: TosClient;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly presignTtl: number;

  constructor(
    options: TosObjectStorageOptions,
    private logger: LoggingRepository,
  ) {
    this.bucket = options.bucket;
    this.prefix = options.prefix ? normalizeKey(options.prefix).replace(/\/?$/, '/') : '';
    this.presignTtl = options.presignTtlSeconds ?? 3600;
    this.client = new TosClient({
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      endpoint: options.endpoint,
      region: options.region,
      bucket: options.bucket,
    });

    this.logger.setContext(TosObjectStorage.name);
    this.logger.log(`Using Volcengine TOS (${options.endpoint}, bucket ${options.bucket}, prefix "${this.prefix}")`);
  }

  isRemote(): boolean {
    return true;
  }

  async put(key: string, body: Buffer | Readable, contentType?: string): Promise<void> {
    await this.client.putObject({
      bucket: this.bucket,
      key: this.objectKey(key),
      body,
      contentType,
    });
  }

  async putFile(key: string, filePath: string, options?: { contentType?: string }): Promise<void> {
    // the SDK streams the file (and can retry), so a 4 GB video never lands in memory
    await this.client.putObjectFromFile({
      bucket: this.bucket,
      key: this.objectKey(key),
      filePath,
      contentType: options?.contentType,
    });
  }

  async get(key: string): Promise<Buffer> {
    const { data } = await this.client.getObject({ bucket: this.bucket, key: this.objectKey(key) });
    return data;
  }

  async stream(key: string): Promise<Readable> {
    const { data } = await this.client.getObjectV2({
      bucket: this.bucket,
      key: this.objectKey(key),
      dataType: 'stream',
    });
    const content = data.content;
    return (
      typeof (content as { pipe?: unknown }).pipe === 'function' ? content : Readable.fromWeb(content as never)
    ) as Readable;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.size(key)) !== undefined;
  }

  async size(key: string): Promise<number | undefined> {
    try {
      const { data } = await this.client.headObject({ bucket: this.bucket, key: this.objectKey(key) });
      const { 'content-length': contentLength } = data;
      return contentLength === undefined ? undefined : Number(contentLength);
    } catch (error: unknown) {
      if (this.isNotFound(error)) {
        return undefined;
      }
      throw new ObjectStorageError(`Failed to check object ${key}`, { cause: error });
    }
  }

  async delete(keys: string[]): Promise<void> {
    // filter before prefixing, otherwise an empty key would target the prefix itself
    const objects = keys.filter((key) => key.length > 0).map((key) => ({ key: this.objectKey(key) }));
    if (objects.length === 0) {
      return;
    }

    await this.client.deleteMultiObjects({ bucket: this.bucket, objects });
  }

  /**
   * TOS's own `renameObject` answers 403 for a plain read/write key, but a
   * server-side copy followed by a delete does the same job and, like the rename,
   * never moves the bytes through this server.
   */
  async rename(source: string, target: string): Promise<void> {
    const srcKey = this.objectKey(source);
    const key = this.objectKey(target);
    await this.client.copyObject({
      bucket: this.bucket,
      key,
      srcBucket: this.bucket,
      srcKey,
      contentType: mimeTypes.lookup(target),
    });
    await this.client.deleteObject({ bucket: this.bucket, key: srcKey });
  }

  presign(key: string, options?: { contentType?: string; fileName?: string; ttlSeconds?: number }): Promise<string> {
    const url = this.client.getPreSignedUrl({
      bucket: this.bucket,
      key: this.objectKey(key),
      method: 'GET',
      expires: options?.ttlSeconds ?? this.presignTtl,
      response: {
        contentType: options?.contentType,
        contentDisposition: options?.fileName
          ? `inline; filename*=UTF-8''${encodeURIComponent(options.fileName)}`
          : undefined,
      },
    });

    return Promise.resolve(url);
  }

  localPath(key: string): string {
    throw new ObjectStorageError(`Object ${key} is remote and has no local path`);
  }

  private isNotFound(error: unknown): boolean {
    if (error instanceof TosServerError) {
      return error.statusCode === 404;
    }
    if (error instanceof TosClientError) {
      return true;
    }

    // be tolerant about the exact error shape: a 404 from any layer means "absent"
    const status =
      (error as { statusCode?: number; status?: number })?.statusCode ?? (error as { status?: number })?.status;
    return status === 404 || /404|NotFound|NoSuchKey/i.test((error as Error)?.message ?? '');
  }

  private objectKey(key: string): string {
    return `${this.prefix}${normalizeKey(key)}`;
  }
}

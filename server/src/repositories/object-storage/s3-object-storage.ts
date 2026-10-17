import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { ObjectStorage, ObjectStorageError, normalizeKey } from 'src/repositories/object-storage/object-storage.js';

export interface S3ObjectStorageOptions {
  /** e.g. https://tos-s3-cn-beijing.volces.com or https://cos.ap-guangzhou.myqcloud.com */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** required by most S3-compatible services, including TOS and COS */
  forcePathStyle?: boolean;
  /** optional key prefix, e.g. `immich/` */
  prefix?: string;
  presignTtlSeconds?: number;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;
  private readonly presignTtl: number;

  constructor(
    private options: S3ObjectStorageOptions,
    private logger: LoggingRepository,
  ) {
    this.bucket = options.bucket;
    this.prefix = options.prefix ? normalizeKey(options.prefix).replace(/\/?$/, '/') : '';
    this.presignTtl = options.presignTtlSeconds ?? 3600;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
      // TOS and COS reject the `aws-chunked` transfer encoding with trailing
      // checksums that SDK v3 uses by default, so only send checksums if required.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    this.logger.setContext(S3ObjectStorage.name);
    this.logger.log(`Using S3 object storage (${options.endpoint}, bucket ${options.bucket}, prefix "${this.prefix}")`);
  }

  isRemote(): boolean {
    return true;
  }

  async put(key: string, body: Buffer | Readable, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
    const stream = response.Body as Readable | undefined;
    if (!stream) {
      throw new ObjectStorageError(`Object ${key} has no body`);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  async stream(key: string): Promise<Readable> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
    const stream = response.Body as Readable | undefined;
    if (!stream) {
      throw new ObjectStorageError(`Object ${key} has no body`);
    }
    return stream;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.size(key)) !== undefined;
  }

  async size(key: string): Promise<number | undefined> {
    try {
      const response = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }));
      return response.ContentLength;
    } catch (error: unknown) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404 || (error as { name?: string })?.name === 'NotFound') {
        return undefined;
      }
      throw new ObjectStorageError(`Failed to check object ${key}`, { cause: error, status });
    }
  }

  async delete(keys: string[]): Promise<void> {
    const objects = keys.map((key) => ({ Key: this.objectKey(key) })).filter(({ Key }) => Key.length > 0);
    if (objects.length === 0) {
      return;
    }

    try {
      await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects } }));
    } catch (error: unknown) {
      // Tencent COS rejects the multi-object delete without a Content-MD5 header
      // ("Missing required header for this request: Content-MD5"), so fall back to
      // deleting one by one.
      const message = (error as Error)?.message ?? String(error);
      if (!/Content-MD5|InvalidRequest/i.test(message)) {
        throw error;
      }

      this.logger.warn(`Batch delete failed (${message}), deleting objects individually`);
      for (const { Key } of objects) {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key }));
      }
    }
  }

  presign(key: string, options?: { contentType?: string; fileName?: string; ttlSeconds?: number }): Promise<string> {
    const responseContentDisposition = options?.fileName
      ? `inline; filename*=UTF-8''${encodeURIComponent(options.fileName)}`
      : undefined;

    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        ResponseContentType: options?.contentType,
        ResponseContentDisposition: responseContentDisposition,
      }),
      { expiresIn: options?.ttlSeconds ?? this.presignTtl },
    );
  }

  localPath(key: string): string {
    throw new ObjectStorageError(`Object ${key} is remote and has no local path`);
  }

  private objectKey(key: string): string {
    return `${this.prefix}${normalizeKey(key)}`;
  }
}

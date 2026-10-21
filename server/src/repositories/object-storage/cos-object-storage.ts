import COS from 'cos-nodejs-sdk-v5';
import { Readable } from 'node:stream';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { ObjectStorage, ObjectStorageError, normalizeKey } from 'src/repositories/object-storage/object-storage.js';
import { mimeTypes } from 'src/utils/mime-types.js';

export interface CosObjectStorageOptions {
  /** `name-appid`, e.g. `family-1250000000` */
  bucket: string;
  /** e.g. `ap-guangzhou` — keep it next to the server, see round 45 */
  region: string;
  secretId: string;
  secretKey: string;
  /** custom endpoint template, e.g. `{Bucket}.cos.{Region}.myqcloud.com` */
  domain?: string;
  /** optional key prefix, e.g. `immich/` */
  prefix?: string;
  presignTtlSeconds?: number;
  /** multipart part size in MiB (also the threshold above which multipart kicks in) */
  chunkSizeMb?: number;
  /** how many parts of one file may be in flight at the same time */
  concurrency?: number;
}

/** COS wants the source key URL-encoded per segment, not as one blob */
const encodeSourceKey = (key: string): string =>
  key
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

const DEFAULT_CHUNK_SIZE_MB = 8;
const DEFAULT_CONCURRENCY = 4;
const MIB = 1024 * 1024;
/** COS CopyObject refuses a simple copy above this; a bigger file needs a multipart copy */
const MAX_SIMPLE_COPY_BYTES = 5 * 1024 * MIB;

/**
 * Tencent COS backend.
 *
 * Same contract as the TOS one, with one deliberate difference: files are pushed
 * with `uploadFile`, which splits anything above `chunkSizeMb` and sends the parts
 * in parallel instead of holding a single TCP stream open for half an hour
 * (round 45: a 200 MiB video took 40 minutes over one stream).
 */
export class CosObjectStorage implements ObjectStorage {
  private readonly client: COS;
  private readonly bucket: string;
  private readonly region: string;
  private readonly prefix: string;
  private readonly presignTtl: number;

  constructor(
    options: CosObjectStorageOptions,
    private logger: LoggingRepository,
  ) {
    this.bucket = options.bucket;
    this.region = options.region;
    this.prefix = options.prefix ? normalizeKey(options.prefix).replace(/\/?$/, '/') : '';
    this.presignTtl = options.presignTtlSeconds ?? 3600;

    const chunkSize = (options.chunkSizeMb ?? DEFAULT_CHUNK_SIZE_MB) * MIB;
    this.client = new COS({
      SecretId: options.secretId,
      SecretKey: options.secretKey,
      Protocol: 'https:',
      Domain: options.domain,
      SliceSize: chunkSize,
      ChunkSize: chunkSize,
      ChunkParallelLimit: options.concurrency ?? DEFAULT_CONCURRENCY,
    });

    this.logger.setContext(CosObjectStorage.name);
    this.logger.log(
      `Using Tencent COS (bucket ${options.bucket}, region ${options.region}, prefix "${this.prefix}", ` +
        `${chunkSize / MIB} MiB parts, ${options.concurrency ?? DEFAULT_CONCURRENCY} in parallel)`,
    );
  }

  isRemote(): boolean {
    return true;
  }

  async put(key: string, body: Buffer | Readable, contentType?: string): Promise<void> {
    // COS refuses a PutObject without a Content-Length, so a stream cannot be
    // streamed straight through: write it to a file and use putFile().
    if (!Buffer.isBuffer(body)) {
      throw new ObjectStorageError(`COS needs the length up front: buffer the content or use putFile() (${key})`);
    }

    await this.client.putObject({
      Bucket: this.bucket,
      Region: this.region,
      Key: this.objectKey(key),
      Body: body,
      ContentLength: body.length,
      ContentType: contentType,
    });
  }

  async putFile(key: string, filePath: string, options?: { contentType?: string }): Promise<void> {
    // uploadFile picks simple upload below `SliceSize` and multipart above it,
    // pushing `ChunkParallelLimit` parts at once — no 4 GB video in memory.
    await this.client.uploadFile({
      Bucket: this.bucket,
      Region: this.region,
      Key: this.objectKey(key),
      FilePath: filePath,
      ContentType: options?.contentType,
    });
  }

  async get(key: string): Promise<Buffer> {
    const { Body } = await this.client.getObject({
      Bucket: this.bucket,
      Region: this.region,
      Key: this.objectKey(key),
    });
    return Body;
  }

  stream(key: string): Promise<Readable> {
    // the SDK hands back the pass-through immediately; a missing object or a
    // network failure surfaces as an `error` event on it, which the caller's
    // pipeline() already handles
    const stream = this.client.getObjectStream({
      Bucket: this.bucket,
      Region: this.region,
      Key: this.objectKey(key),
    });

    return Promise.resolve(stream as unknown as Readable);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.size(key)) !== undefined;
  }

  async size(key: string): Promise<number | undefined> {
    try {
      const data = await this.client.headObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: this.objectKey(key),
      });
      const contentLength = data.headers?.['content-length'] ?? (data as { ContentLength?: string }).ContentLength;
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
    const Objects = keys.filter((key) => key.length > 0).map((key) => ({ Key: this.objectKey(key) }));
    if (Objects.length === 0) {
      return;
    }

    await this.client.deleteMultipleObject({
      Bucket: this.bucket,
      Region: this.region,
      Objects,
    });
  }

  /** server-side copy + delete: the bytes never travel through this server */
  async rename(source: string, target: string): Promise<void> {
    const srcKey = this.objectKey(source);
    const key = this.objectKey(target);
    const size = await this.size(source);

    if (size !== undefined && size > MAX_SIMPLE_COPY_BYTES) {
      throw new ObjectStorageError(
        `Object ${source} is ${size} bytes: COS can only copy that with a multipart copy, which is not wired up yet`,
      );
    }

    await this.client.putObjectCopy({
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
      CopySource: `${this.bucket}.cos.${this.region}.myqcloud.com/${encodeSourceKey(srcKey)}`,
      // keep the name, take the content type from the target key (the template
      // may well have changed the extension)
      MetadataDirective: 'Replaced',
      ContentType: mimeTypes.lookup(target),
    });
    await this.client.deleteObject({ Bucket: this.bucket, Region: this.region, Key: srcKey });
  }

  presign(key: string, options?: { contentType?: string; fileName?: string; ttlSeconds?: number }): Promise<string> {
    const query: Record<string, string> = {};
    if (options?.contentType) {
      query['response-content-type'] = options.contentType;
    }
    if (options?.fileName) {
      query['response-content-disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(options.fileName)}`;
    }

    const url = this.client.getObjectUrl({
      Bucket: this.bucket,
      Region: this.region,
      Key: this.objectKey(key),
      Sign: true,
      Method: 'GET',
      Expires: options?.ttlSeconds ?? this.presignTtl,
      Query: Object.keys(query).length > 0 ? query : undefined,
    });

    return Promise.resolve(url);
  }

  localPath(key: string): string {
    throw new ObjectStorageError(`Object ${key} is remote and has no local path`);
  }

  private isNotFound(error: unknown): boolean {
    const status =
      (error as { statusCode?: number; status?: number })?.statusCode ?? (error as { status?: number })?.status;
    if (status === 404) {
      return true;
    }

    const code = (error as { code?: string })?.code ?? '';
    if (/^(NoSuchKey|NoSuchBucket|NotFound)$/i.test(code)) {
      return true;
    }

    // be tolerant about the exact error shape: a 404 from any layer means "absent"
    return /404|NoSuchKey|NotFound/i.test((error as Error)?.message ?? '');
  }

  private objectKey(key: string): string {
    return `${this.prefix}${normalizeKey(key)}`;
  }
}

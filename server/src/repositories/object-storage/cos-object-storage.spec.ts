import { Readable } from 'node:stream';
import { vitest } from 'vitest';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { CosObjectStorage } from 'src/repositories/object-storage/cos-object-storage.js';
import { automock } from 'test/utils.js';

const mocks = vitest.hoisted(() => ({
  putObject: vitest.fn(),
  uploadFile: vitest.fn(),
  getObject: vitest.fn(),
  getObjectStream: vitest.fn(),
  headObject: vitest.fn(),
  deleteMultipleObject: vitest.fn(),
  deleteObject: vitest.fn(),
  putObjectCopy: vitest.fn(),
  getObjectUrl: vitest.fn(),
}));

vitest.mock('cos-nodejs-sdk-v5', () => ({
  default: function Cos() {
    return mocks;
  },
}));

const newSut = (options?: {
  prefix?: string;
  presignTtlSeconds?: number;
  chunkSizeMb?: number;
  concurrency?: number;
}) =>
  new CosObjectStorage(
    {
      bucket: 'family-1250000000',
      region: 'ap-guangzhou',
      secretId: 'id',
      secretKey: 'key',
      ...options,
    },
    // eslint-disable-next-line no-sparse-arrays
    automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false }),
  );

describe(CosObjectStorage.name, () => {
  beforeEach(() => {
    vitest.resetAllMocks();
  });

  it('should be remote and refuse a local path', () => {
    const sut = newSut();

    expect(sut.isRemote()).toBe(true);
    expect(() => sut.localPath('upload/a.jpg')).toThrow('remote');
  });

  it('should upload a buffer with the configured prefix and content type', async () => {
    const body = Buffer.from('x');

    await newSut({ prefix: 'immich' }).put('upload/a.jpg', body, 'image/jpeg');

    expect(mocks.putObject).toHaveBeenCalledWith({
      Bucket: 'family-1250000000',
      Region: 'ap-guangzhou',
      Key: 'immich/upload/a.jpg',
      Body: body,
      ContentLength: 1,
      ContentType: 'image/jpeg',
    });
  });

  it('should refuse to stream a body, because COS needs the length first', async () => {
    await expect(newSut().put('upload/a.jpg', Readable.from('x'))).rejects.toThrow('use putFile');
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('should upload a local file through the multipart uploader', async () => {
    await newSut({ prefix: 'immich' }).putFile('upload/a.mp4', '/tmp/staged/a.mp4', { contentType: 'video/mp4' });

    expect(mocks.uploadFile).toHaveBeenCalledWith({
      Bucket: 'family-1250000000',
      Region: 'ap-guangzhou',
      Key: 'immich/upload/a.mp4',
      FilePath: '/tmp/staged/a.mp4',
      ContentType: 'video/mp4',
    });
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('should read an object as a buffer', async () => {
    mocks.getObject.mockResolvedValue({ Body: Buffer.from('hello') });

    await expect(newSut().get('upload/a.jpg')).resolves.toEqual(Buffer.from('hello'));
  });

  it('should stream an object', async () => {
    const stream = Readable.from('hello');
    mocks.getObjectStream.mockReturnValue(stream);

    await expect(newSut().stream('upload/a.jpg')).resolves.toBe(stream);
    expect(mocks.getObjectStream).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'family-1250000000', Key: 'upload/a.jpg' }),
    );
  });

  it('should map the head response to a size', async () => {
    mocks.headObject.mockResolvedValue({ headers: { 'content-length': '2048' } });

    await expect(newSut().size('upload/a.jpg')).resolves.toBe(2048);
    await expect(newSut().exists('upload/a.jpg')).resolves.toBe(true);
  });

  it('should treat a missing object as undefined', async () => {
    mocks.headObject.mockRejectedValue(Object.assign(new Error('Not Found'), { statusCode: 404 }));

    await expect(newSut().size('upload/missing.jpg')).resolves.toBeUndefined();
    await expect(newSut().exists('upload/missing.jpg')).resolves.toBe(false);
  });

  it('should rethrow unexpected head errors', async () => {
    mocks.headObject.mockRejectedValue(new Error('boom'));

    await expect(newSut().size('upload/a.jpg')).rejects.toThrow('Failed to check object');
  });

  it('should delete several objects at once and skip empty keys', async () => {
    await newSut({ prefix: 'immich' }).delete(['upload/a.jpg', '', 'upload/b.jpg']);

    expect(mocks.deleteMultipleObject).toHaveBeenCalledWith({
      Bucket: 'family-1250000000',
      Region: 'ap-guangzhou',
      Objects: [{ Key: 'immich/upload/a.jpg' }, { Key: 'immich/upload/b.jpg' }],
    });
  });

  it('should not call COS when there is nothing to delete', async () => {
    await newSut().delete(['']);

    expect(mocks.deleteMultipleObject).not.toHaveBeenCalled();
  });

  it('should move an object with a server-side copy and a delete', async () => {
    mocks.headObject.mockResolvedValue({ headers: { 'content-length': '1024' } });

    await newSut({ prefix: 'immich' }).rename('upload/a.jpg', 'library/admin/2026/09/12/IMG_1.jpg');

    expect(mocks.putObjectCopy).toHaveBeenCalledWith({
      Bucket: 'family-1250000000',
      Region: 'ap-guangzhou',
      Key: 'immich/library/admin/2026/09/12/IMG_1.jpg',
      CopySource: 'family-1250000000.cos.ap-guangzhou.myqcloud.com/immich/upload/a.jpg',
      MetadataDirective: 'Replaced',
      ContentType: 'image/jpeg',
    });
    expect(mocks.deleteObject).toHaveBeenCalledWith({
      Bucket: 'family-1250000000',
      Region: 'ap-guangzhou',
      Key: 'immich/upload/a.jpg',
    });
  });

  it('should url-encode the copy source per path segment', async () => {
    mocks.headObject.mockResolvedValue({ headers: { 'content-length': '1' } });

    await newSut().rename('upload/宝宝 1.jpg', 'library/宝宝 2.jpg');

    expect(mocks.putObjectCopy).toHaveBeenCalledWith(
      expect.objectContaining({
        CopySource: `family-1250000000.cos.ap-guangzhou.myqcloud.com/upload/${encodeURIComponent('宝宝 1.jpg')}`,
      }),
    );
  });

  it('should refuse to rename an object that a simple copy cannot handle', async () => {
    mocks.headObject.mockResolvedValue({ headers: { 'content-length': String(6 * 1024 * 1024 * 1024) } });

    await expect(newSut().rename('upload/a.mp4', 'library/a.mp4')).rejects.toThrow('multipart copy');
    expect(mocks.putObjectCopy).not.toHaveBeenCalled();
  });

  it('should presign a GET url with a content type and inline filename', async () => {
    mocks.getObjectUrl.mockReturnValue('https://signed.example/a.jpg');

    const url = await newSut({ presignTtlSeconds: 120 }).presign('upload/a.jpg', {
      contentType: 'image/jpeg',
      fileName: '宝宝.jpg',
    });

    expect(url).toBe('https://signed.example/a.jpg');
    expect(mocks.getObjectUrl).toHaveBeenCalledWith({
      Bucket: 'family-1250000000',
      Region: 'ap-guangzhou',
      Key: 'upload/a.jpg',
      Sign: true,
      Method: 'GET',
      Expires: 120,
      Query: {
        'response-content-type': 'image/jpeg',
        'response-content-disposition': "inline; filename*=UTF-8''%E5%AE%9D%E5%AE%9D.jpg",
      },
    });
  });

  it('should fall back to the default presign expiry', async () => {
    mocks.getObjectUrl.mockReturnValue('https://signed.example/a.jpg');

    await newSut().presign('upload/a.jpg');

    expect(mocks.getObjectUrl).toHaveBeenCalledWith(expect.objectContaining({ Expires: 3600, Query: undefined }));
  });
});

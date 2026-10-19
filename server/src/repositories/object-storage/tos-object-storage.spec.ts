import { Readable } from 'node:stream';
import { vitest } from 'vitest';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { TosObjectStorage } from 'src/repositories/object-storage/tos-object-storage.js';
import { automock } from 'test/utils.js';

const mocks = vitest.hoisted(() => ({
  putObject: vitest.fn(),
  putObjectFromFile: vitest.fn(),
  getObject: vitest.fn(),
  getObjectV2: vitest.fn(),
  headObject: vitest.fn(),
  deleteMultiObjects: vitest.fn(),
  getPreSignedUrl: vitest.fn(),
}));

vitest.mock('@volcengine/tos-sdk', () => ({
  TosClient: function TosClient() {
    return mocks;
  },
  TosServerError: class TosServerError extends Error {
    statusCode = 404;
  },
  TosClientError: class TosClientError extends Error {},
}));

const newSut = (options?: { prefix?: string; presignTtlSeconds?: number }) =>
  new TosObjectStorage(
    {
      endpoint: 'tos-cn-beijing.volces.com',
      region: 'cn-beijing',
      bucket: 'family-photos',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      ...options,
    },
    // eslint-disable-next-line no-sparse-arrays
    automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false }),
  );

describe(TosObjectStorage.name, () => {
  beforeEach(() => {
    vitest.resetAllMocks();
  });

  it('should be remote and refuse a local path', () => {
    const sut = newSut();

    expect(sut.isRemote()).toBe(true);
    expect(() => sut.localPath('upload/a.jpg')).toThrow('remote');
  });

  it('should upload with the configured prefix and content type', async () => {
    await newSut({ prefix: 'immich' }).put('upload/a.jpg', Buffer.from('x'), 'image/jpeg');

    expect(mocks.putObject).toHaveBeenCalledWith({
      bucket: 'family-photos',
      key: 'immich/upload/a.jpg',
      body: expect.any(Buffer),
      contentType: 'image/jpeg',
    });
  });

  it('should upload a local file through the SDK, without buffering it', async () => {
    await newSut({ prefix: 'immich' }).putFile('upload/a.jpg', '/tmp/staged/a.jpg', { contentType: 'image/jpeg' });

    expect(mocks.putObjectFromFile).toHaveBeenCalledWith({
      bucket: 'family-photos',
      key: 'immich/upload/a.jpg',
      filePath: '/tmp/staged/a.jpg',
      contentType: 'image/jpeg',
    });
    expect(mocks.putObject).not.toHaveBeenCalled();
  });

  it('should read an object as a buffer', async () => {
    mocks.getObject.mockResolvedValue({ data: Buffer.from('hello') });

    await expect(newSut().get('upload/a.jpg')).resolves.toEqual(Buffer.from('hello'));
  });

  it('should stream an object', async () => {
    const stream = Readable.from('hello');
    mocks.getObjectV2.mockResolvedValue({ data: { content: stream } });

    await expect(newSut().stream('upload/a.jpg')).resolves.toBe(stream);
    expect(mocks.getObjectV2).toHaveBeenCalledWith(
      expect.objectContaining({ dataType: 'stream', key: 'upload/a.jpg' }),
    );
  });

  it('should map the head response to a size', async () => {
    mocks.headObject.mockResolvedValue({ data: { 'content-length': '2048' } });

    await expect(newSut().size('upload/a.jpg')).resolves.toBe(2048);
    await expect(newSut().exists('upload/a.jpg')).resolves.toBe(true);
  });

  it('should treat a missing object as undefined', async () => {
    mocks.headObject.mockRejectedValue(
      new (class extends Error {
        statusCode = 404;
      })(),
    );

    await expect(newSut().size('upload/missing.jpg')).resolves.toBeUndefined();
    await expect(newSut().exists('upload/missing.jpg')).resolves.toBe(false);
  });

  it('should rethrow unexpected head errors', async () => {
    mocks.headObject.mockRejectedValue(new Error('boom'));

    await expect(newSut().size('upload/a.jpg')).rejects.toThrow('Failed to check object');
  });

  it('should delete several objects at once and skip empty keys', async () => {
    await newSut({ prefix: 'immich' }).delete(['upload/a.jpg', '', 'upload/b.jpg']);

    expect(mocks.deleteMultiObjects).toHaveBeenCalledWith({
      bucket: 'family-photos',
      objects: [{ key: 'immich/upload/a.jpg' }, { key: 'immich/upload/b.jpg' }],
    });
  });

  it('should not call TOS when there is nothing to delete', async () => {
    await newSut().delete(['']);

    expect(mocks.deleteMultiObjects).not.toHaveBeenCalled();
  });

  it('should presign a GET url with a content type and inline filename', async () => {
    mocks.getPreSignedUrl.mockReturnValue('https://signed.example/a.jpg');

    const url = await newSut({ presignTtlSeconds: 120 }).presign('upload/a.jpg', {
      contentType: 'image/jpeg',
      fileName: '宝宝.jpg',
    });

    expect(url).toBe('https://signed.example/a.jpg');
    expect(mocks.getPreSignedUrl).toHaveBeenCalledWith({
      bucket: 'family-photos',
      key: 'upload/a.jpg',
      method: 'GET',
      expires: 120,
      response: {
        contentType: 'image/jpeg',
        contentDisposition: "inline; filename*=UTF-8''%E5%AE%9D%E5%AE%9D.jpg",
      },
    });
  });

  it('should fall back to the default presign expiry', async () => {
    mocks.getPreSignedUrl.mockReturnValue('https://signed.example/a.jpg');

    await newSut().presign('upload/a.jpg');

    expect(mocks.getPreSignedUrl).toHaveBeenCalledWith(expect.objectContaining({ expires: 3600 }));
  });
});

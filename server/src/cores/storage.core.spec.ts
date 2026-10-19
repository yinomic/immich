import { vitest } from 'vitest';
import { StorageCore } from 'src/cores/storage.core.js';
import { AssetFileType, AssetPathType } from 'src/enum.js';

vitest.mock('src/constants', () => ({
  IWorker: 'IWorker',
}));

const newStorageCore = (options?: { remote?: boolean }) => {
  const storageRepository = {
    isRemote: () => options?.remote ?? false,
    mkdirSync: vitest.fn(),
    rename: vitest.fn().mockResolvedValue(undefined),
    renameObject: vitest.fn().mockResolvedValue(undefined),
    stat: vitest.fn(),
    copyFile: vitest.fn(),
    utimes: vitest.fn(),
    unlink: vitest.fn(),
    checkFileExists: vitest.fn(),
  };
  const moveRepository = {
    getByEntity: vitest.fn().mockResolvedValue(undefined),
    // like the real repository, the created row carries the paths of the move
    create: vitest.fn().mockImplementation((move: unknown) => Promise.resolve({ ...(move as object), id: 'move-1' })),
    update: vitest.fn(),
    delete: vitest.fn().mockResolvedValue(undefined),
  };
  const assetRepository = { update: vitest.fn(), upsertFile: vitest.fn() };
  const logger = {
    setContext: vitest.fn(),
    debug: vitest.fn(),
    log: vitest.fn(),
    warn: vitest.fn(),
    fatal: vitest.fn(),
  };

  StorageCore.reset();
  const core = StorageCore.create(
    assetRepository as never,
    {} as never,
    {} as never,
    moveRepository as never,
    storageRepository as never,
    {} as never,
    logger as never,
  );

  return { core, storageRepository, assetRepository };
};

describe('StorageCore', () => {
  describe('moveFile', () => {
    it('should move a remote original inside the bucket', async () => {
      const { core, storageRepository, assetRepository } = newStorageCore({ remote: true });

      await core.moveFile({
        entityId: 'asset-1',
        pathType: AssetPathType.Original,
        oldPath: 'upload/1a/2b/a.jpg',
        newPath: 'library/admin/2026/09/12/a.jpg',
        assetInfo: { sizeInBytes: 9, checksum: Buffer.from('checksum') },
      });

      // the bytes never travel through the server, and a key is not a folder
      expect(storageRepository.renameObject).toHaveBeenCalledWith(
        'upload/1a/2b/a.jpg',
        'library/admin/2026/09/12/a.jpg',
      );
      expect(storageRepository.rename).not.toHaveBeenCalled();
      expect(storageRepository.mkdirSync).not.toHaveBeenCalled();
      expect(assetRepository.update).toHaveBeenCalledWith({
        id: 'asset-1',
        originalPath: 'library/admin/2026/09/12/a.jpg',
      });
    });

    it('should move a derived file on disk even with a bucket library', async () => {
      const { core, storageRepository } = newStorageCore({ remote: true });

      await core.moveFile({
        entityId: 'asset-1',
        ownerId: 'admin',
        pathType: AssetFileType.Thumbnail,
        oldPath: '/cache/thumbnails/admin/a.jpg',
        newPath: '/cache/thumbnails/admin/b.jpg',
      });

      expect(storageRepository.rename).toHaveBeenCalledWith(
        '/cache/thumbnails/admin/a.jpg',
        '/cache/thumbnails/admin/b.jpg',
      );
      expect(storageRepository.renameObject).not.toHaveBeenCalled();
    });

    it('should move a local library with the filesystem', async () => {
      const { core, storageRepository } = newStorageCore();

      await core.moveFile({
        entityId: 'asset-1',
        pathType: AssetPathType.Original,
        oldPath: '/photos/upload/a.jpg',
        newPath: '/photos/library/admin/a.jpg',
        assetInfo: { sizeInBytes: 9, checksum: Buffer.from('checksum') },
      });

      expect(storageRepository.rename).toHaveBeenCalledWith('/photos/upload/a.jpg', '/photos/library/admin/a.jpg');
      expect(storageRepository.renameObject).not.toHaveBeenCalled();
    });
  });

  describe('isImmichPath', () => {
    beforeAll(() => {
      StorageCore.setMediaLocation('/photos');
    });

    it('should return true for APP_MEDIA_LOCATION path', () => {
      const immichPath = '/photos';
      expect(StorageCore.isImmichPath(immichPath)).toBe(true);
    });

    it('should return true for paths within the APP_MEDIA_LOCATION', () => {
      const immichPath = '/photos/new/';
      expect(StorageCore.isImmichPath(immichPath)).toBe(true);
    });

    it('should return false for paths outside the APP_MEDIA_LOCATION and same starts', () => {
      const nonImmichPath = '/photos_new';
      expect(StorageCore.isImmichPath(nonImmichPath)).toBe(false);
    });

    it('should return false for paths outside the APP_MEDIA_LOCATION', () => {
      const nonImmichPath = '/some/other/path';
      expect(StorageCore.isImmichPath(nonImmichPath)).toBe(false);
    });
  });
});

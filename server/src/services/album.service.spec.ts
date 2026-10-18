import { BadRequestException } from '@nestjs/common';
import { BulkIdErrorReason } from 'src/dtos/asset-ids.response.dto.js';
import { AlbumUserRole, AssetOrder, UserMetadataKey } from 'src/enum.js';
import { AlbumService } from 'src/services/album.service.js';
import { AlbumFactory } from 'test/factories/album.factory.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { getForAlbum } from 'test/mappers.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(AlbumService.name, () => {
  let sut: AlbumService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AlbumService));
    mocks.album.getMetadataForIds.mockResolvedValue([]);
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('getStatistics', () => {
    it('should get the album count', async () => {
      mocks.album.getAll.mockResolvedValue([]);
      await expect(sut.getStatistics(authStub.admin)).resolves.toEqual({ owned: 0 });

      expect(mocks.album.getAll).toHaveBeenCalledExactlyOnceWith(authStub.admin.user.id, { isOwned: true });
    });
  });

  describe('getAll', () => {
    it('gets list of albums for auth user', async () => {
      const album = AlbumFactory.from().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const otherAlbum = AlbumFactory.from().owner(owner).build();
      mocks.album.getAll.mockResolvedValue([getForAlbum(album), getForAlbum(otherAlbum)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 0,
          startDate: null,
          endDate: null,
          lastModifiedAssetTimestamp: null,
        },
        {
          albumId: otherAlbum.id,
          assetCount: 0,
          startDate: null,
          endDate: null,
          lastModifiedAssetTimestamp: null,
        },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), {});
      expect(result).toHaveLength(2);
      expect(result[0].id).toEqual(album.id);
      expect(result[1].id).toEqual(otherAlbum.id);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, { isOwned: undefined, isShared: undefined });
    });

    it('gets list of albums that have a specific asset', async () => {
      const album = AlbumFactory.from()
        .owner({ isAdmin: true })
        .asset({}, (builder) => builder.exif())
        .asset({}, (builder) => builder.exif())
        .build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getByAssetId.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 1,
          startDate: new Date('1970-01-01'),
          endDate: new Date('1970-01-01'),
          lastModifiedAssetTimestamp: new Date('1970-01-01'),
        },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { assetId: album.assets[0].id });
      expect(result).toHaveLength(1);
      expect(result[0].id).toEqual(album.id);
      expect(mocks.album.getByAssetId).toHaveBeenCalledTimes(1);
    });

    it('forwards the isShared=true filter', async () => {
      const album = AlbumFactory.from().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 0,
          startDate: null,
          endDate: null,
          lastModifiedAssetTimestamp: null,
        },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { isShared: true });
      expect(result).toHaveLength(1);
      expect(result[0].id).toEqual(album.id);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, expect.objectContaining({ isShared: true }));
    });

    it('forwards the isShared=false filter', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 0,
          startDate: null,
          endDate: null,
          lastModifiedAssetTimestamp: null,
        },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { isShared: false });
      expect(result).toHaveLength(1);
      expect(result[0].id).toEqual(album.id);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, expect.objectContaining({ isShared: false }));
    });

    it('gets only owned albums when isOwned=true', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { isOwned: true });
      expect(result).toHaveLength(1);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, expect.objectContaining({ isOwned: true }));
    });

    it('forwards the isOwned=false filter', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { isOwned: false });
      expect(result).toHaveLength(1);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, expect.objectContaining({ isOwned: false }));
    });

    it('forwards both the isOwned and isShared filters', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
      mocks.album.getMetadataForIds.mockResolvedValue([
        { albumId: album.id, assetCount: 0, startDate: null, endDate: null, lastModifiedAssetTimestamp: null },
      ]);

      const result = await sut.getAll(AuthFactory.create(owner), { isOwned: true, isShared: true });
      expect(result).toHaveLength(1);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, { isOwned: true, isShared: true });
    });

    it('returns empty list when isOwned=false and isShared=false', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getAll.mockResolvedValue([]);

      const result = await sut.getAll(AuthFactory.create(owner), { isOwned: false, isShared: false });
      expect(result).toHaveLength(0);
      expect(mocks.album.getAll).toHaveBeenCalledWith(owner.id, { isOwned: false, isShared: false });
    });
  });

  it('counts assets correctly', async () => {
    const album = AlbumFactory.create();
    const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
    mocks.album.getAll.mockResolvedValue([getForAlbum(album)]);
    mocks.album.getMetadataForIds.mockResolvedValue([
      {
        albumId: album.id,
        assetCount: 1,
        startDate: new Date('1970-01-01'),
        endDate: new Date('1970-01-01'),
        lastModifiedAssetTimestamp: new Date('1970-01-01'),
      },
    ]);

    const result = await sut.getAll(AuthFactory.create(owner), {});
    expect(result).toHaveLength(1);
    expect(result[0].assetCount).toEqual(1);
    expect(mocks.album.getAll).toHaveBeenCalledTimes(1);
  });

  describe('create', () => {
    it('creates album', async () => {
      const assetId = newUuid();
      const album = AlbumFactory.from({ albumName: 'test', description: 'description' })
        .asset({ id: assetId }, (asset) => asset.exif())
        .build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;

      mocks.album.create.mockResolvedValue(getForAlbum(album));
      mocks.user.get.mockResolvedValue(UserFactory.create(album.albumUsers[0].user));
      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

      await sut.create(AuthFactory.create(owner), {
        albumName: 'test',
        description: 'description',
        assetIds: [assetId],
      });

      expect(mocks.album.create).toHaveBeenCalledWith(
        {
          albumName: 'test',
          description: 'description',
          order: album.order,
          albumThumbnailAssetId: assetId,
        },
        [assetId],
        [{ userId: owner.id, role: AlbumUserRole.Owner }],
        owner.id,
      );

      expect(mocks.user.getMetadata).toHaveBeenCalledWith(owner.id);
      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(owner.id, new Set([assetId]), false);
    });

    it('creates album with assetOrder from user preferences', async () => {
      const assetId = newUuid();
      const album = AlbumFactory.from()
        .asset({ id: assetId }, (asset) => asset.exif())
        .build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.create.mockResolvedValue(getForAlbum(album));
      mocks.albumUser.create.mockResolvedValue(album.albumUsers[0]);
      mocks.user.getMetadata.mockResolvedValue([
        {
          key: UserMetadataKey.Preferences,
          value: {
            albums: {
              defaultAssetOrder: AssetOrder.Asc,
            },
          },
        },
      ]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

      await sut.create(AuthFactory.create(owner), {
        albumName: album.albumName,
        description: album.description,
        assetIds: [assetId],
      });

      expect(mocks.album.create).toHaveBeenCalledWith(
        {
          albumName: album.albumName,
          description: album.description,
          order: 'asc',
          albumThumbnailAssetId: assetId,
        },
        [assetId],
        [{ userId: owner.id, role: AlbumUserRole.Owner }],
        owner.id,
      );

      expect(mocks.user.getMetadata).toHaveBeenCalledWith(owner.id);
      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(owner.id, new Set([assetId]), false);
    });

    it('should only add assets the user is allowed to access', async () => {
      const assetId = newUuid();
      const album = AlbumFactory.from()
        .asset({ id: assetId }, (asset) => asset.exif())
        .build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.user.get.mockResolvedValue(album.albumUsers[0].user);
      mocks.album.create.mockResolvedValue(getForAlbum(album));
      mocks.user.getMetadata.mockResolvedValue([]);
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

      await sut.create(AuthFactory.create(owner), {
        albumName: album.albumName,
        description: album.description,
        assetIds: [assetId, 'asset-2'],
      });

      expect(mocks.album.create).toHaveBeenCalledWith(
        {
          albumName: album.albumName,
          description: album.description,
          order: 'desc',
          albumThumbnailAssetId: assetId,
        },
        [assetId],
        [{ userId: owner.id, role: AlbumUserRole.Owner }],
        owner.id,
      );
      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(owner.id, new Set([assetId, 'asset-2']), false);
    });
  });

  describe('update', () => {
    it('should prevent updating an album that does not exist', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      mocks.album.getById.mockResolvedValue(void 0);

      await expect(
        sut.update(AuthFactory.create(), 'invalid-id', {
          albumName: 'Album',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should require a valid thumbnail asset id', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValue(new Set());

      await expect(
        sut.update(AuthFactory.create(owner), album.id, { albumThumbnailAssetId: 'not-in-album' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.album.getAssetIds).toHaveBeenCalledWith(album.id, ['not-in-album']);
      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should allow the owner to update the album', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.update.mockResolvedValue(getForAlbum(album));

      await sut.update(AuthFactory.create(owner), album.id, { albumName: 'new album name' });

      expect(mocks.album.update).toHaveBeenCalledTimes(1);
      expect(mocks.album.update).toHaveBeenCalledWith(
        album.id,
        { id: album.id, albumName: 'new album name' },
        owner.id,
      );
    });
  });

  describe('delete', () => {
    it('should require permissions', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.delete(AuthFactory.create(owner), album.id)).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.album.delete).not.toHaveBeenCalled();
    });

    it('should let the owner delete an album', async () => {
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await sut.delete(AuthFactory.create(owner), album.id);

      expect(mocks.album.delete).toHaveBeenCalledTimes(1);
      expect(mocks.album.delete).toHaveBeenCalledWith(album.id);
    });
  });

  describe('getAlbumInfo', () => {
    it('should get an album', async () => {
      const album = AlbumFactory.from().build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getMetadataForIds.mockResolvedValue([
        {
          albumId: album.id,
          assetCount: 1,
          startDate: new Date('1970-01-01'),
          endDate: new Date('1970-01-01'),
          lastModifiedAssetTimestamp: new Date('1970-01-01'),
        },
      ]);

      await sut.get(AuthFactory.create(owner), album.id);

      expect(mocks.album.getById).toHaveBeenCalledWith(album.id, owner.id);
      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalledWith(owner.id, new Set([album.id]));
    });

    it('should throw an error for no access', async () => {
      const auth = AuthFactory.create();
      await expect(sut.get(auth, 'album-123')).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set(['album-123']));
    });
  });

  describe('addAssets', () => {
    it('should allow the owner to add assets', async () => {
      const owner = UserFactory.create({ isAdmin: true });
      const album = AlbumFactory.from().owner(owner).build();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset1.id, asset2.id, asset3.id] }),
      ).resolves.toEqual([
        { success: true, id: asset1.id },
        { success: true, id: asset2.id },
        { success: true, id: asset3.id },
      ]);

      expect(mocks.album.update).toHaveBeenCalledWith(
        album.id,
        {
          id: album.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.addAssetIds).toHaveBeenCalledWith(album.id, [asset1.id, asset2.id, asset3.id]);
    });

    it('should not set the thumbnail if the album has one already', async () => {
      const [asset1, asset2] = [AssetFactory.create(), AssetFactory.create()];
      const album = AlbumFactory.from({ albumThumbnailAssetId: asset1.id }).build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset2.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set());

      await expect(sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset2.id] })).resolves.toEqual([
        { success: true, id: asset2.id },
      ]);

      expect(mocks.album.update).toHaveBeenCalledWith(
        album.id,
        {
          id: album.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.addAssetIds).toHaveBeenCalled();
    });

    it('should skip duplicate assets', async () => {
      const asset = AssetFactory.create();
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set([asset.id]));

      await expect(sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset.id] })).resolves.toEqual([
        { success: false, id: asset.id, error: BulkIdErrorReason.DUPLICATE },
      ]);

      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should skip assets the user does not own', async () => {
      const asset = AssetFactory.create();
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set());

      await expect(sut.addAssets(AuthFactory.create(owner), album.id, { ids: [asset.id] })).resolves.toEqual([
        { success: false, id: asset.id, error: BulkIdErrorReason.NO_PERMISSION },
      ]);

      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(owner.id, new Set([asset.id]), false);
    });

    it('should not allow unauthorized access to the album', async () => {
      const user = UserFactory.create();
      const album = AlbumFactory.create();
      const asset = AssetFactory.create({ ownerId: user.id });
      mocks.album.getById.mockResolvedValue(getForAlbum(album));

      await expect(sut.addAssets(AuthFactory.create(user), album.id, { ids: [asset.id] })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalled();
    });
  });

  describe('addAssetsToAlbums', () => {
    it('should allow the owner to add assets', async () => {
      const album1 = AlbumFactory.create();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.create();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkOwnerAccess.mockResolvedValueOnce(new Set([album1.id, album2.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(owner), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({ success: true, error: undefined });

      expect(mocks.album.update).toHaveBeenCalledTimes(2);
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        1,
        album1.id,
        {
          id: album1.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        2,
        album2.id,
        {
          id: album2.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.addAssetIdsToAlbums).toHaveBeenCalledWith([
        { albumId: album1.id, assetId: asset1.id },
        { albumId: album1.id, assetId: asset2.id },
        { albumId: album1.id, assetId: asset3.id },
        { albumId: album2.id, assetId: asset1.id },
        { albumId: album2.id, assetId: asset2.id },
        { albumId: album2.id, assetId: asset3.id },
      ]);
    });

    it('should not set the thumbnail if the album has one already', async () => {
      const asset = AssetFactory.create();
      const album1 = AlbumFactory.from({ albumThumbnailAssetId: asset.id }).build();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.from({ albumThumbnailAssetId: asset.id }).build();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.access.album.checkOwnerAccess.mockResolvedValueOnce(new Set([album1.id, album2.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(owner), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({ success: true, error: undefined });

      expect(mocks.album.update).toHaveBeenCalledTimes(2);
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        1,
        album1.id,
        {
          id: album1.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset.id,
        },
        owner.id,
      );
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        2,
        album2.id,
        {
          id: album2.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset.id,
        },
        owner.id,
      );
      expect(mocks.album.addAssetIdsToAlbums).toHaveBeenCalledWith([
        { albumId: album1.id, assetId: asset1.id },
        { albumId: album1.id, assetId: asset2.id },
        { albumId: album1.id, assetId: asset3.id },
        { albumId: album2.id, assetId: asset1.id },
        { albumId: album2.id, assetId: asset2.id },
        { albumId: album2.id, assetId: asset3.id },
      ]);
    });

    it('should skip some duplicate assets', async () => {
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      const album1 = AlbumFactory.create();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.create();

      mocks.access.album.checkOwnerAccess.mockResolvedValueOnce(new Set([album1.id, album2.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getAssetIds
        .mockResolvedValueOnce(new Set([asset1.id, asset2.id, asset3.id]))
        .mockResolvedValueOnce(new Set());
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(owner), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({ success: true, error: undefined });

      expect(mocks.album.update).toHaveBeenCalledTimes(1);
      expect(mocks.album.update).toHaveBeenNthCalledWith(
        1,
        album2.id,
        {
          id: album2.id,
          updatedAt: expect.any(Date),
          albumThumbnailAssetId: asset1.id,
        },
        owner.id,
      );
      expect(mocks.album.addAssetIdsToAlbums).toHaveBeenCalledWith([
        { albumId: album2.id, assetId: asset1.id },
        { albumId: album2.id, assetId: asset2.id },
        { albumId: album2.id, assetId: asset3.id },
      ]);
    });

    it('should skip all duplicate assets', async () => {
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      const album1 = AlbumFactory.create();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.create();
      mocks.access.album.checkOwnerAccess
        .mockResolvedValueOnce(new Set([album1.id]))
        .mockResolvedValueOnce(new Set([album2.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValue(new Set([asset1.id, asset2.id, asset3.id]));

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(owner), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({
        success: false,
        error: BulkIdErrorReason.DUPLICATE,
      });

      expect(mocks.album.update).not.toHaveBeenCalled();
      expect(mocks.album.addAssetIds).not.toHaveBeenCalled();
    });

    it('should skip assets the user does not own', async () => {
      const user = UserFactory.create();
      const album1 = AlbumFactory.create();
      const { user: owner } = album1.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      const album2 = AlbumFactory.from().owner(owner).build();
      const [asset1, asset2, asset3] = [
        AssetFactory.create({ ownerId: user.id }),
        AssetFactory.create({ ownerId: user.id }),
        AssetFactory.create({ ownerId: user.id }),
      ];
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album1.id, album2.id]));
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));
      mocks.album.getAssetIds.mockResolvedValueOnce(new Set()).mockResolvedValueOnce(new Set());

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(owner), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({
        success: false,
        error: BulkIdErrorReason.NO_PERMISSION,
      });

      expect(mocks.album.update).not.toHaveBeenCalled();
      expect(mocks.album.addAssetIds).not.toHaveBeenCalled();
      expect(mocks.access.asset.checkOwnerAccess).toHaveBeenCalledWith(
        owner.id,
        new Set([asset1.id, asset2.id, asset3.id]),
        false,
      );
    });

    it('should not allow unauthorized access to the albums', async () => {
      const user = UserFactory.create();
      const album1 = AlbumFactory.create();
      const album2 = AlbumFactory.create();
      const [asset1, asset2, asset3] = [AssetFactory.create(), AssetFactory.create(), AssetFactory.create()];
      mocks.album.getById.mockResolvedValueOnce(getForAlbum(album1)).mockResolvedValueOnce(getForAlbum(album2));

      await expect(
        sut.addAssetsToAlbums(AuthFactory.create(user), {
          albumIds: [album1.id, album2.id],
          assetIds: [asset1.id, asset2.id, asset3.id],
        }),
      ).resolves.toEqual({
        success: false,
        error: BulkIdErrorReason.NO_PERMISSION,
      });

      expect(mocks.album.update).not.toHaveBeenCalled();
      expect(mocks.album.addAssetIds).not.toHaveBeenCalled();
      expect(mocks.access.album.checkOwnerAccess).toHaveBeenCalled();
    });
  });

  describe('removeAssets', () => {
    it('should allow the owner to remove assets', async () => {
      const asset = AssetFactory.create();
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValue(new Set([asset.id]));

      await expect(sut.removeAssets(AuthFactory.create(owner), album.id, { ids: [asset.id] })).resolves.toEqual([
        { success: true, id: asset.id },
      ]);

      expect(mocks.album.removeAssetIds).toHaveBeenCalledWith(album.id, [asset.id]);
    });

    it('should skip assets not in the album', async () => {
      const asset = AssetFactory.create();
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValue(new Set());

      await expect(sut.removeAssets(AuthFactory.create(owner), album.id, { ids: [asset.id] })).resolves.toEqual([
        { success: false, id: asset.id, error: BulkIdErrorReason.NOT_FOUND },
      ]);

      expect(mocks.album.update).not.toHaveBeenCalled();
    });

    it('should allow owner to remove all assets from the album', async () => {
      const asset = AssetFactory.create();
      const album = AlbumFactory.create();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValue(new Set([asset.id]));

      await expect(sut.removeAssets(AuthFactory.create(owner), album.id, { ids: [asset.id] })).resolves.toEqual([
        { success: true, id: asset.id },
      ]);
    });

    it('should reset the thumbnail if it is removed', async () => {
      const asset1 = AssetFactory.create();
      const asset2 = AssetFactory.create();
      const album = AlbumFactory.from({ albumThumbnailAssetId: asset1.id }).build();
      const { user: owner } = album.albumUsers.find(({ role }) => role === AlbumUserRole.Owner)!;
      mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set([album.id]));
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([asset1.id]));
      mocks.album.getById.mockResolvedValue(getForAlbum(album));
      mocks.album.getAssetIds.mockResolvedValue(new Set([asset1.id, asset2.id]));

      await expect(sut.removeAssets(AuthFactory.create(owner), album.id, { ids: [asset1.id] })).resolves.toEqual([
        { success: true, id: asset1.id },
      ]);

      expect(mocks.album.updateThumbnails).toHaveBeenCalled();
    });
  });

  // // it('removes assets from shared album (shared with auth user)', async () => {
  // //   const albumEntity = _getOwnedSharedAlbum();
  // //   albumRepositoryMock.get.mockImplementation(() => Promise.resolve<AlbumEntity>(albumEntity));
  // //   albumRepositoryMock.removeAssets.mockImplementation(() => Promise.resolve<AlbumEntity>(albumEntity));

  // //   await expect(
  // //     sut.removeAssetsFromAlbum(
  // //       auth,
  // //       {
  // //         ids: ['1'],
  // //       },
  // //       albumEntity.id,
  // //     ),
  // //   ).resolves.toBeUndefined();
  // //   expect(albumRepositoryMock.removeAssets).toHaveBeenCalledTimes(1);
  // //   expect(albumRepositoryMock.removeAssets).toHaveBeenCalledWith(albumEntity, {
  // //     ids: ['1'],
  // //   });
  // // });

  // it('prevents removing assets from a not owned / shared album', async () => {
  //   const albumEntity = _getNotOwnedNotSharedAlbum();

  //   const albumResponse: AddAssetsResponseDto = {
  //     alreadyInAlbum: [],
  //     successfullyAdded: 1,
  //   };

  //   const albumId = albumEntity.id;

  //   albumRepositoryMock.get.mockImplementation(() => Promise.resolve<AlbumEntity>(albumEntity));
  //   albumRepositoryMock.addAssets.mockImplementation(() => Promise.resolve<AddAssetsResponseDto>(albumResponse));

  //   await expect(sut.removeAssets(auth, albumId, { ids: ['1'] })).rejects.toBeInstanceOf(ForbiddenException);
  // });
});

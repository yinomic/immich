import { Kysely } from 'kysely';
import { SyncEntityType, SyncRequestType } from 'src/enum.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { DB } from 'src/schema/index.js';
import { updateLockedColumns } from 'src/utils/database.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB, wait } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

const updateSyncAck = {
  ack: expect.stringContaining(SyncEntityType.AlbumAssetExifUpdateV1),
  data: {},
  type: SyncEntityType.SyncAckV1,
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SyncRequestType.AlbumAssetExifsV1, () => {
  it('should detect and sync the first album asset exif', async () => {
    const { auth, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newExif({ assetId: asset.id, make: 'Canon' });
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.AlbumAssetExifsV1]);
    expect(response).toEqual([
      updateSyncAck,
      {
        ack: expect.any(String),
        data: {
          assetId: asset.id,
          city: null,
          country: null,
          dateTimeOriginal: null,
          description: '',
          exifImageHeight: null,
          exifImageWidth: null,
          exposureTime: null,
          fNumber: null,
          fileSizeInByte: null,
          focalLength: null,
          fps: null,
          iso: null,
          latitude: null,
          lensModel: null,
          longitude: null,
          make: 'Canon',
          model: null,
          modifyDate: null,
          orientation: null,
          profileDescription: null,
          projectionType: null,
          rating: null,
          state: null,
          timeZone: null,
        },
        type: SyncEntityType.AlbumAssetExifCreateV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AlbumAssetExifsV1]);
  });

  it('should sync album asset exif for own user', async () => {
    const { auth, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newExif({ assetId: asset.id, make: 'Canon' });
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    await expect(ctx.syncStream(auth, [SyncRequestType.AssetExifsV1])).resolves.toEqual([
      expect.objectContaining({ type: SyncEntityType.AssetExifV1 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await expect(ctx.syncStream(auth, [SyncRequestType.AlbumAssetExifsV1])).resolves.toEqual([
      expect.objectContaining({ type: SyncEntityType.SyncAckV1 }),
      expect.objectContaining({ type: SyncEntityType.AlbumAssetExifCreateV1 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  it('should sync asset exif updates for an album', async () => {
    const { auth, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newExif({ assetId: asset.id, make: 'asset' });
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    await wait(2);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.AlbumAssetExifsV1]);
    expect(response).toEqual([
      updateSyncAck,
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          assetId: asset.id,
        }),
        type: SyncEntityType.AlbumAssetExifCreateV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);

    // update the asset
    const assetRepository = ctx.get(AssetRepository);
    await assetRepository.upsertExif({
      exif: updateLockedColumns({
        assetId: asset.id,
        city: 'New City',
      }),
      lockedPropertiesBehavior: 'append',
    });

    await expect(ctx.syncStream(auth, [SyncRequestType.AlbumAssetExifsV1])).resolves.toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          assetId: asset.id,
          city: 'New City',
        }),
        type: SyncEntityType.AlbumAssetExifUpdateV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  it('should sync delayed asset exif creates for an album', async () => {
    const { auth, ctx } = await setup();
    const { asset: assetWithExif } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newExif({ assetId: assetWithExif.id, make: 'assetWithExif' });
    const { asset: assetDelayedExif } = await ctx.newAsset({ ownerId: auth.user.id });
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    const { asset: newerAsset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newExif({ assetId: newerAsset.id, make: 'newerAsset' });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetWithExif.id });
    await wait(2);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: assetDelayedExif.id });
    await wait(2);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: newerAsset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.AlbumAssetExifsV1]);
    expect(response).toEqual([
      updateSyncAck,
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          assetId: assetWithExif.id,
        }),
        type: SyncEntityType.AlbumAssetExifCreateV1,
      },
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          assetId: newerAsset.id,
        }),
        type: SyncEntityType.AlbumAssetExifCreateV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);

    // update the asset
    const assetRepository = ctx.get(AssetRepository);
    await assetRepository.upsertExif({
      exif: updateLockedColumns({
        assetId: assetDelayedExif.id,
        city: 'Delayed Exif',
      }),
      lockedPropertiesBehavior: 'append',
    });

    await expect(ctx.syncStream(auth, [SyncRequestType.AlbumAssetExifsV1])).resolves.toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          assetId: assetDelayedExif.id,
          city: 'Delayed Exif',
        }),
        type: SyncEntityType.AlbumAssetExifUpdateV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });
});

import { Kysely } from 'kysely';
import { SyncEntityType, SyncRequestType } from 'src/enum.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { DB } from 'src/schema/index.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB, wait } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

const updateSyncAck = {
  ack: expect.stringContaining(SyncEntityType.AlbumAssetUpdateV2),
  data: {},
  type: SyncEntityType.SyncAckV1,
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SyncRequestType.AlbumAssetsV2, () => {
  it('should detect and sync the first album asset', async () => {
    const originalFileName = 'firstAsset';
    const checksum = '1115vHcVkZzNp3Q9G+FEA0nu6zUbGb4Tj4UOXkN0wRA=';
    const thumbhash = '2225vHcVkZzNp3Q9G+FEA0nu6zUbGb4Tj4UOXkN0wRA=';
    const date = new Date().toISOString();

    const { auth, ctx } = await setup();
    const { asset } = await ctx.newAsset({
      originalFileName,
      ownerId: auth.user.id,
      checksum: Buffer.from(checksum, 'base64'),
      thumbhash: Buffer.from(thumbhash, 'base64'),
      fileCreatedAt: date,
      fileModifiedAt: date,
      localDateTime: date,
      createdAt: date,
      deletedAt: null,
      duration: 600_000,
      livePhotoVideoId: null,
      stackId: null,
      libraryId: null,
      width: 1920,
      height: 1080,
    });
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.AlbumAssetsV2]);
    expect(response).toEqual([
      updateSyncAck,
      {
        ack: expect.any(String),
        data: {
          id: asset.id,
          originalFileName,
          ownerId: asset.ownerId,
          thumbhash,
          checksum,
          deletedAt: asset.deletedAt,
          fileCreatedAt: asset.fileCreatedAt,
          fileModifiedAt: asset.fileModifiedAt,
          createdAt: asset.createdAt,
          isFavorite: asset.isFavorite,
          localDateTime: asset.localDateTime,
          type: asset.type,
          visibility: asset.visibility,
          duration: asset.duration,
          livePhotoVideoId: asset.livePhotoVideoId,
          stackId: asset.stackId,
          libraryId: asset.libraryId,
          width: asset.width,
          height: asset.height,
          isEdited: asset.isEdited,
        },
        type: SyncEntityType.AlbumAssetCreateV2,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AlbumAssetsV2]);
  });

  it('should sync album asset for own user', async () => {
    const { auth, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    await expect(ctx.syncStream(auth, [SyncRequestType.AssetsV2])).resolves.toEqual([
      expect.objectContaining({ type: SyncEntityType.AssetV2 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
    await expect(ctx.syncStream(auth, [SyncRequestType.AlbumAssetsV2])).resolves.toEqual([
      expect.objectContaining({ type: SyncEntityType.SyncAckV1 }),
      expect.objectContaining({ type: SyncEntityType.AlbumAssetCreateV2 }),
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  it('should sync asset updates for an album', async () => {
    const { auth, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, originalFileName: 'before' });
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    await wait(2);
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.AlbumAssetsV2]);
    expect(response).toEqual([
      updateSyncAck,
      {
        ack: expect.any(String),
        data: expect.objectContaining({ id: asset.id, originalFileName: 'before' }),
        type: SyncEntityType.AlbumAssetCreateV2,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);

    const assetRepository = ctx.get(AssetRepository);
    await assetRepository.update({ id: asset.id, originalFileName: 'after' });

    const updateResponse = await ctx.syncStream(auth, [SyncRequestType.AlbumAssetsV2]);
    expect(updateResponse).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({ id: asset.id, originalFileName: 'after' }),
        type: SyncEntityType.AlbumAssetUpdateV2,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  it('should sync isFavorite for album assets owned by the requesting user', async () => {
    const { auth, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id, isFavorite: true });
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.AlbumAssetsV2]);
    expect(response).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({ id: asset.id, isFavorite: true }),
          type: SyncEntityType.AlbumAssetCreateV2,
        }),
      ]),
    );
  });
});

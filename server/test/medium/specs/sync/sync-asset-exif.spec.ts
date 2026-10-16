import { Kysely } from 'kysely';
import { SyncEntityType, SyncRequestType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user, session } = await ctx.newSyncAuthUser();
  return { auth, user, session, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(SyncRequestType.AssetExifsV1, () => {
  it('should detect and sync the first asset exif', async () => {
    const { auth, ctx } = await setup();
    const { asset } = await ctx.newAsset({ ownerId: auth.user.id });
    await ctx.newExif({ assetId: asset.id, make: 'Canon' });

    const response = await ctx.syncStream(auth, [SyncRequestType.AssetExifsV1]);
    expect(response).toEqual([
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
        type: SyncEntityType.AssetExifV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AssetExifsV1]);
  });
});

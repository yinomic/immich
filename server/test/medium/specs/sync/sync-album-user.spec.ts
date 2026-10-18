import { Kysely } from 'kysely';
import { AlbumUserRole, SyncEntityType, SyncRequestType } from 'src/enum.js';
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

describe(SyncRequestType.AlbumUsersV1, () => {
  it('should sync an album user with the correct properties', async () => {
    const { auth, ctx } = await setup();
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });

    await expect(ctx.syncStream(auth, [SyncRequestType.AlbumUsersV1])).resolves.toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          albumId: album.id,
          role: AlbumUserRole.Owner,
          userId: auth.user.id,
        }),
        type: SyncEntityType.AlbumUserV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);
  });

  describe('owner', () => {
    it('should detect and sync the album owner', async () => {
      const { auth, ctx } = await setup();
      const { album } = await ctx.newAlbum({ ownerId: auth.user.id });

      const response = await ctx.syncStream(auth, [SyncRequestType.AlbumUsersV1]);
      expect(response).toEqual([
        {
          ack: expect.any(String),
          data: expect.objectContaining({
            albumId: album.id,
            role: AlbumUserRole.Owner,
            userId: auth.user.id,
          }),
          type: SyncEntityType.AlbumUserV1,
        },
        expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
      ]);

      await ctx.syncAckAll(auth, response);
      await ctx.assertSyncIsComplete(auth, [SyncRequestType.AlbumUsersV1]);
    });
  });
});

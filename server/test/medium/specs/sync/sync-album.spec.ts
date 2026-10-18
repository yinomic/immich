import { Kysely } from 'kysely';
import { SyncEntityType, SyncRequestType } from 'src/enum.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
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

describe(SyncRequestType.AlbumsV1, () => {
  it('should sync an album with the correct properties', async () => {
    const { auth, ctx } = await setup();
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.AlbumsV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          id: album.id,
          name: album.albumName,
        }),
        type: SyncEntityType.AlbumV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AlbumsV1]);
  });

  it('should detect and sync a new album', async () => {
    const { auth, ctx } = await setup();
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.AlbumsV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          id: album.id,
        }),
        type: SyncEntityType.AlbumV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, response);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AlbumsV1]);
  });

  it('should detect and sync an album delete', async () => {
    const { auth, ctx } = await setup();
    const albumRepo = ctx.get(AlbumRepository);
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });

    const response = await ctx.syncStream(auth, [SyncRequestType.AlbumsV1]);
    expect(response).toEqual([
      {
        ack: expect.any(String),
        data: expect.objectContaining({
          id: album.id,
        }),
        type: SyncEntityType.AlbumV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await albumRepo.delete(album.id);

    const newResponse = await ctx.syncStream(auth, [SyncRequestType.AlbumsV1]);
    expect(newResponse).toEqual([
      {
        ack: expect.any(String),
        data: {
          albumId: album.id,
        },
        type: SyncEntityType.AlbumDeleteV1,
      },
      expect.objectContaining({ type: SyncEntityType.SyncCompleteV1 }),
    ]);

    await ctx.syncAckAll(auth, newResponse);
    await ctx.assertSyncIsComplete(auth, [SyncRequestType.AlbumsV1]);
  });
});

import {
  addAssetsToAlbum,
  AlbumResponseDto,
  AlbumUserRole,
  AssetMediaResponseDto,
  AssetOrder,
  LoginResponseDto,
} from '@immich/sdk';
import { createUserDto } from 'src/fixtures.js';
import { app, asBearerAuth, utils } from 'src/utils.js';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

const user1AlbumA = 'user1AlbumA';
const user1AlbumB = 'user1AlbumB';
const user1AlbumC = 'user1AlbumC';
const user1AlbumD = 'user1AlbumD';
const user4DeletedAsset = 'user4DeletedAsset';
const user4Empty = 'user4Empty';

describe('/albums', () => {
  let admin: LoginResponseDto;
  let user1: LoginResponseDto;
  let user1Asset1: AssetMediaResponseDto;
  let user1Asset2: AssetMediaResponseDto;
  let user4Asset1: AssetMediaResponseDto;
  let user1Albums: AlbumResponseDto[];
  let deletedAssetAlbum: AlbumResponseDto;
  let user4: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();

    admin = await utils.adminSetup();

    [user1, user4] = await Promise.all([
      utils.userSetup(admin.accessToken, createUserDto.user1),
      utils.userSetup(admin.accessToken, createUserDto.user4),
    ]);

    [user1Asset1, user1Asset2, user4Asset1] = await Promise.all([
      utils.createAsset(user1.accessToken, { isFavorite: true }),
      utils.createAsset(user1.accessToken),
      utils.createAsset(user4.accessToken),
    ]);

    [user1Albums, deletedAssetAlbum] = await Promise.all([
      Promise.all([
        utils.createAlbum(user1.accessToken, {
          albumName: user1AlbumA,
          assetIds: [user1Asset1.id],
        }),
        utils.createAlbum(user1.accessToken, {
          albumName: user1AlbumB,
          assetIds: [user1Asset1.id],
        }),
        utils.createAlbum(user1.accessToken, {
          albumName: user1AlbumC,
          assetIds: [user1Asset1.id, user1Asset2.id],
        }),
        utils.createAlbum(user1.accessToken, {
          albumName: user1AlbumD,
          assetIds: [user1Asset1.id],
        }),
      ]),
      utils.createAlbum(user4.accessToken, { albumName: user4DeletedAsset }),
      utils.createAlbum(user4.accessToken, { albumName: user4Empty }),
    ]);

    await addAssetsToAlbum(
      { id: deletedAssetAlbum.id, bulkIdsDto: { ids: [user4Asset1.id] } },
      { headers: asBearerAuth(user4.accessToken) },
    );

    await utils.deleteAssets(user4.accessToken, [user4Asset1.id]);
  });

  describe('GET /albums', () => {
    it('should return the album collection', async () => {
      const { status, body } = await request(app).get('/albums').set('Authorization', `Bearer ${user1.accessToken}`);
      expect(status).toBe(200);
      expect(body).toHaveLength(4);
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            albumName: user1AlbumA,
            albumUsers: expect.arrayContaining([
              { role: AlbumUserRole.Owner, user: expect.objectContaining({ id: user1.userId }) },
            ]),
          }),
          expect.objectContaining({
            albumName: user1AlbumB,
            albumUsers: expect.arrayContaining([
              { role: AlbumUserRole.Owner, user: expect.objectContaining({ id: user1.userId }) },
            ]),
          }),
          expect.objectContaining({
            albumName: user1AlbumC,
            albumUsers: expect.arrayContaining([
              { role: AlbumUserRole.Owner, user: expect.objectContaining({ id: user1.userId }) },
            ]),
          }),
          expect.objectContaining({
            albumName: user1AlbumD,
            albumUsers: expect.arrayContaining([
              { role: AlbumUserRole.Owner, user: expect.objectContaining({ id: user1.userId }) },
            ]),
          }),
        ]),
      );
    });

    it('should return only owned albums when filtered by isOwned=true', async () => {
      const { status, body } = await request(app)
        .get('/albums?isOwned=true')
        .set('Authorization', `Bearer ${user1.accessToken}`);
      expect(status).toBe(200);
      expect(body).toHaveLength(4);
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ albumName: user1AlbumA }),
          expect.objectContaining({ albumName: user1AlbumB }),
          expect.objectContaining({ albumName: user1AlbumC }),
          expect.objectContaining({ albumName: user1AlbumD }),
        ]),
      );
    });

    it('should return the album collection filtered by assetId', async () => {
      const { status, body } = await request(app)
        .get(`/albums?assetId=${user1Asset2.id}`)
        .set('Authorization', `Bearer ${user1.accessToken}`);
      expect(status).toBe(200);
      expect(body).toHaveLength(1);
    });

    it('should return empty albums and albums where all assets are deleted', async () => {
      const { status, body } = await request(app).get('/albums').set('Authorization', `Bearer ${user4.accessToken}`);
      expect(status).toBe(200);
      expect(body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            albumName: user4DeletedAsset,
            albumUsers: expect.arrayContaining([
              { role: AlbumUserRole.Owner, user: expect.objectContaining({ id: user4.userId }) },
            ]),
          }),
          expect.objectContaining({
            albumName: user4Empty,
            albumUsers: expect.arrayContaining([
              { role: AlbumUserRole.Owner, user: expect.objectContaining({ id: user4.userId }) },
            ]),
          }),
        ]),
      );
    });
  });

  describe('GET /albums/:id', () => {
    it('should return album info for own album', async () => {
      const { status, body } = await request(app)
        .get(`/albums/${user1Albums[0].id}`)
        .set('Authorization', `Bearer ${user1.accessToken}`);

      expect(status).toBe(200);
      expect(body).toEqual({
        ...user1Albums[0],
        lastModifiedAssetTimestamp: expect.any(String),
        startDate: expect.any(String),
        endDate: expect.any(String),
        albumUsers: expect.any(Array),
      });
    });

    it('should return album info', async () => {
      const { status, body } = await request(app)
        .get(`/albums/${user1Albums[0].id}`)
        .set('Authorization', `Bearer ${user1.accessToken}`);

      expect(status).toBe(200);
      expect(body).toEqual({
        ...user1Albums[0],
        assetCount: 1,
        lastModifiedAssetTimestamp: expect.any(String),
        endDate: expect.any(String),
        startDate: expect.any(String),
        albumUsers: expect.any(Array),
      });
    });

    it('should not count trashed assets', async () => {
      await utils.deleteAssets(user1.accessToken, [user1Asset2.id]);

      const { status, body } = await request(app)
        .get(`/albums/${user1Albums[2].id}`)
        .set('Authorization', `Bearer ${user1.accessToken}`);

      expect(status).toBe(200);
      expect(body).toEqual(
        expect.objectContaining({
          assetCount: 1,
          lastModifiedAssetTimestamp: expect.any(String),
          endDate: expect.any(String),
          startDate: expect.any(String),
          albumUsers: expect.any(Array),
        }),
      );
    });
  });

  describe('GET /albums/statistics', () => {
    it('should return total count of albums the user has access to', async () => {
      const { status, body } = await request(app)
        .get('/albums/statistics')
        .set('Authorization', `Bearer ${user1.accessToken}`);

      expect(status).toBe(200);
      expect(body).toEqual({ owned: 4 });
    });
  });

  describe('POST /albums', () => {
    it('should create an album', async () => {
      const { status, body } = await request(app)
        .post('/albums')
        .send({ albumName: 'New album' })
        .set('Authorization', `Bearer ${user1.accessToken}`);
      expect(status).toBe(201);
      expect(body).toEqual({
        id: expect.any(String),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        albumName: 'New album',
        description: '',
        albumThumbnailAssetId: null,
        albumUsers: [{ role: AlbumUserRole.Owner, user: expect.objectContaining({ id: user1.userId }) }],
        assetCount: 0,
        order: AssetOrder.Desc,
      });
    });
  });

  describe('PUT /albums/:id/assets', () => {
    it('should be able to add own asset to own album', async () => {
      const asset = await utils.createAsset(user1.accessToken);
      const { status, body } = await request(app)
        .put(`/albums/${user1Albums[0].id}/assets`)
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({ ids: [asset.id] });

      expect(status).toBe(200);
      expect(body).toEqual([expect.objectContaining({ id: asset.id, success: true })]);
    });

    it('should add duplicate assets only once', async () => {
      const asset = await utils.createAsset(user1.accessToken);
      const { status, body } = await request(app)
        .put(`/albums/${user1Albums[0].id}/assets`)
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({ ids: [asset.id, asset.id] });

      expect(status).toBe(200);
      expect(body).toEqual([
        expect.objectContaining({ id: asset.id, success: true }),
        expect.objectContaining({ id: asset.id, success: false, error: 'duplicate' }),
      ]);
    });
  });

  describe('PATCH /albums/:id', () => {
    it('should update an album', async () => {
      const album = await utils.createAlbum(user1.accessToken, {
        albumName: 'New album',
      });
      const { status, body } = await request(app)
        .patch(`/albums/${album.id}`)
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({
          albumName: 'New album name',
          description: 'An album description',
        });
      expect(status).toBe(200);
      expect(body).toEqual({
        ...album,
        updatedAt: expect.any(String),
        albumName: 'New album name',
        description: 'An album description',
      });
    });
  });

  describe('DELETE /albums/:id/assets', () => {
    it('should be able to remove own asset from own album', async () => {
      const { status, body } = await request(app)
        .delete(`/albums/${user1Albums[0].id}/assets`)
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({ ids: [user1Asset1.id] });

      expect(status).toBe(200);
      expect(body).toEqual([expect.objectContaining({ id: user1Asset1.id, success: true })]);
    });

    it('should remove duplicate assets only once', async () => {
      const { status, body } = await request(app)
        .delete(`/albums/${user1Albums[1].id}/assets`)
        .set('Authorization', `Bearer ${user1.accessToken}`)
        .send({ ids: [user1Asset1.id, user1Asset1.id] });

      expect(status).toBe(200);
      expect(body).toEqual([
        expect.objectContaining({ id: user1Asset1.id, success: true }),
        expect.objectContaining({ id: user1Asset1.id, success: false, error: 'not_found' }),
      ]);
    });
  });
});

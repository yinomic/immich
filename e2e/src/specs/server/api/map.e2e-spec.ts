import { AssetVisibility, LoginResponseDto } from '@immich/sdk';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Socket } from 'socket.io-client';
import { app, testAssetDir, utils } from 'src/utils.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('/map', () => {
  let websocket: Socket;
  let admin: LoginResponseDto;
  let adminArchivedAssetId: string;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup({ onboarding: false });

    websocket = await utils.connectWebsocket(admin.accessToken);

    const adminFiles = ['formats/heic/IMG_2682.heic', 'metadata/gps-position/thompson-springs.jpg'];
    const adminArchivedFile = 'metadata/dates/datetimeoriginal-gps.jpg';
    utils.resetEvents();
    const uploadFile = async (accessToken: string, input: string) => {
      const filepath = join(testAssetDir, input);
      const { id } = await utils.createAsset(accessToken, {
        assetData: { bytes: await readFile(filepath), filename: basename(filepath) },
      });
      await utils.waitForWebsocketEvent({ event: 'assetUpload', id });
      return id;
    };
    await Promise.all(adminFiles.map((f) => uploadFile(admin.accessToken, f)));
    adminArchivedAssetId = await uploadFile(admin.accessToken, adminArchivedFile);

    await utils.archiveAssets(admin.accessToken, [adminArchivedAssetId]);
  });

  afterAll(() => {
    utils.disconnectWebsocket(websocket);
  });

  describe('GET /map/markers', () => {
    it('should get map markers for all non-archived assets', async () => {
      const { status, body } = await request(app)
        .get('/map/markers')
        .query({ visibility: AssetVisibility.Timeline })
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body).toHaveLength(2);
      expect(body).toEqual([
        {
          city: 'Palisade',
          country: 'United States',
          id: expect.any(String),
          lat: expect.closeTo(39.115),
          lon: expect.closeTo(-108.400968),
          state: 'Colorado',
        },
        {
          city: 'Ralston',
          country: 'United States',
          id: expect.any(String),
          lat: expect.closeTo(41.2203),
          lon: expect.closeTo(-96.071625),
          state: 'Nebraska',
        },
      ]);
    });

    it('should include own archived asset locations', async () => {
      const { status, body } = await request(app)
        .get('/map/markers')
        .query({ isArchived: true })
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body.map((m: { id: string }) => m.id)).toContain(adminArchivedAssetId);
    });

    it('should get all map markers', async () => {
      const { status, body } = await request(app)
        .get('/map/markers')
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(status).toBe(200);
      expect(body).toEqual([
        {
          city: 'Palisade',
          country: 'United States',
          id: expect.any(String),
          lat: expect.closeTo(39.115),
          lon: expect.closeTo(-108.400968),
          state: 'Colorado',
        },
        {
          city: 'Ralston',
          country: 'United States',
          id: expect.any(String),
          lat: expect.closeTo(41.2203),
          lon: expect.closeTo(-96.071625),
          state: 'Nebraska',
        },
      ]);
    });
  });

  describe('GET /map/reverse-geocode', () => {
    const reverseGeocodeTestCases = [
      {
        name: 'Vaucluse',
        lat: -33.85897705866313,
        lon: 151.27849073027048,
        results: [{ city: 'Vaucluse', state: 'New South Wales', country: 'Australia' }],
      },
      {
        name: 'Ravenhall',
        lat: -37.76573239917475,
        lon: 144.7524531648833,
        results: [{ city: 'Ravenhall', state: 'Victoria', country: 'Australia' }],
      },
      {
        name: 'Scarborough',
        lat: -31.894346156789997,
        lon: 115.75761710390464,
        results: [{ city: 'Scarborough', state: 'Western Australia', country: 'Australia' }],
      },
    ];

    it.each(reverseGeocodeTestCases)(`should resolve to $name`, async ({ lat, lon, results }) => {
      const { status, body } = await request(app)
        .get(`/map/reverse-geocode?lat=${lat}&lon=${lon}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(status).toBe(200);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(results.length);
      expect(body).toEqual(results);
    });
  });
});

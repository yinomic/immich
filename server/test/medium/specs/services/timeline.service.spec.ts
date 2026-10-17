import { Kysely } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { DB } from 'src/schema/index.js';
import { TimelineService } from 'src/services/timeline.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(TimelineService, {
    database: db || defaultDatabase,
    real: [AssetRepository, AccessRepository],
    mock: [LoggingRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(TimelineService.name, () => {
  describe('getTimeBuckets', () => {
    it('should get time buckets by month', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const auth = factory.auth({ user });
      const dates = [new Date('1970-01-01'), new Date('1970-02-10'), new Date('1970-02-11'), new Date('1970-02-11')];
      for (const localDateTime of dates) {
        const { asset } = await ctx.newAsset({ ownerId: user.id, localDateTime });
        await ctx.newExif({ assetId: asset.id, make: 'Canon' });
      }

      const response = sut.getTimeBuckets(auth, {});
      await expect(response).resolves.toEqual([
        { count: 3, timeBucket: '1970-02-01' },
        { count: 1, timeBucket: '1970-01-01' },
      ]);
    });
  });

  describe('getTimeBucket', () => {
    it('should return time bucket', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        localDateTime: new Date('1970-02-12'),
        deletedAt: new Date(),
      });
      await ctx.newExif({ assetId: asset.id, make: 'Canon' });
      const auth = factory.auth({ user: { id: user.id } });
      const rawResponse = await sut.getTimeBucket(auth, { timeBucket: '1970-02-01', isTrashed: true });
      const response = JSON.parse(rawResponse);
      expect(response).toEqual(expect.objectContaining({ isTrashed: [true] }));
    });

    it('should handle a bucket without any assets', async () => {
      const { sut } = setup();
      const rawResponse = await sut.getTimeBucket(factory.auth(), { timeBucket: '1970-02-01' });
      const response = JSON.parse(rawResponse);
      expect(response).toEqual({
        city: [],
        country: [],
        createdAt: [],
        duration: [],
        id: [],
        visibility: [],
        isFavorite: [],
        isImage: [],
        isTrashed: [],
        livePhotoVideoId: [],
        fileCreatedAt: [],
        localOffsetHours: [],
        ownerId: [],
        projectionType: [],
        ratio: [],
        status: [],
        thumbhash: [],
      });
    });

    it('should handle 5 digit years', async () => {
      const { sut } = setup();
      const rawResponse = await sut.getTimeBucket(factory.auth(), { timeBucket: '012345-01-01' });
      const response = JSON.parse(rawResponse);
      expect(response).toEqual(expect.objectContaining({ id: [] }));
    });
  });
});

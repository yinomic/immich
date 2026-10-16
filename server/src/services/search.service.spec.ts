import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, vitest } from 'vitest';
import { mapAsset } from 'src/dtos/asset-response.dto.js';
import { SearchSuggestionType } from 'src/dtos/search.dto.js';
import { AssetVisibility } from 'src/enum.js';
import { SearchService } from 'src/services/search.service.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { getForAsset } from 'test/mappers.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

vitest.useFakeTimers();

describe(SearchService.name, () => {
  let sut: SearchService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(SearchService));
  });

  it('should work', () => {
    expect(sut).toBeDefined();
  });

  describe('searchPlaces', () => {
    it('should search places', async () => {
      mocks.search.searchPlaces.mockResolvedValue([
        {
          id: 42,
          name: 'my place',
          latitude: 420,
          longitude: 69,
          admin1Code: null,
          admin1Name: null,
          admin2Code: null,
          admin2Name: null,
          alternateNames: null,
          countryCode: 'US',
          modificationDate: new Date(),
        },
      ]);

      await sut.searchPlaces({ name: 'place' });
      expect(mocks.search.searchPlaces).toHaveBeenCalledWith('place');
    });
  });

  describe('getExploreData', () => {
    it('should get recent assets and assets by city and tag', async () => {
      const auth = AuthFactory.create();
      const asset = AssetFactory.from()
        .exif({ latitude: 42, longitude: 69, city: 'city', state: 'state', country: 'country' })
        .build();
      mocks.asset.getAssetIdByCity.mockResolvedValue({
        fieldName: 'exifInfo.city',
        items: [{ value: 'city', data: asset.id }],
      });
      mocks.asset.getRecentlyCreatedAssetIds.mockResolvedValue({
        fieldName: 'createdAt',
        items: [{ value: asset.createdAt, data: asset.id }],
      });
      mocks.asset.getByIdsWithAllRelationsButStacks.mockResolvedValue([asset as never]);
      const expectedResponse = [
        { fieldName: 'exifInfo.city', items: [{ value: 'city', data: mapAsset(getForAsset(asset)) }] },
        {
          fieldName: 'createdAt',
          items: [{ value: asset.createdAt.toISOString(), data: mapAsset(getForAsset(asset)) }],
        },
      ];

      const result = await sut.getExploreData(auth);

      expect(result).toEqual(expectedResponse);
    });
  });

  describe('getSearchSuggestions', () => {
    it('should return search suggestions for country', async () => {
      mocks.search.getCountries.mockResolvedValue(['USA']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.COUNTRY }),
      ).resolves.toEqual(['USA']);
      expect(mocks.search.getCountries).toHaveBeenCalledWith([authStub.user1.user.id]);
    });

    it('should return search suggestions for country (including null)', async () => {
      mocks.search.getCountries.mockResolvedValue(['USA']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.COUNTRY }),
      ).resolves.toEqual(['USA', null]);
      expect(mocks.search.getCountries).toHaveBeenCalledWith([authStub.user1.user.id]);
    });

    it('should return search suggestions for state', async () => {
      mocks.search.getStates.mockResolvedValue(['California']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.STATE }),
      ).resolves.toEqual(['California']);
      expect(mocks.search.getStates).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for state (including null)', async () => {
      mocks.search.getStates.mockResolvedValue(['California']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.STATE }),
      ).resolves.toEqual(['California', null]);
      expect(mocks.search.getStates).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for city', async () => {
      mocks.search.getCities.mockResolvedValue(['Denver']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CITY }),
      ).resolves.toEqual(['Denver']);
      expect(mocks.search.getCities).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for city (including null)', async () => {
      mocks.search.getCities.mockResolvedValue(['Denver']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CITY }),
      ).resolves.toEqual(['Denver', null]);
      expect(mocks.search.getCities).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera make', async () => {
      mocks.search.getCameraMakes.mockResolvedValue(['Nikon']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CAMERA_MAKE }),
      ).resolves.toEqual(['Nikon']);
      expect(mocks.search.getCameraMakes).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera make (including null)', async () => {
      mocks.search.getCameraMakes.mockResolvedValue(['Nikon']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CAMERA_MAKE }),
      ).resolves.toEqual(['Nikon', null]);
      expect(mocks.search.getCameraMakes).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera model', async () => {
      mocks.search.getCameraModels.mockResolvedValue(['Fujifilm X100VI']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CAMERA_MODEL }),
      ).resolves.toEqual(['Fujifilm X100VI']);
      expect(mocks.search.getCameraModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera model (including null)', async () => {
      mocks.search.getCameraModels.mockResolvedValue(['Fujifilm X100VI']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CAMERA_MODEL }),
      ).resolves.toEqual(['Fujifilm X100VI', null]);
      expect(mocks.search.getCameraModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera lens model', async () => {
      mocks.search.getCameraLensModels.mockResolvedValue(['10-24mm']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: false, type: SearchSuggestionType.CAMERA_LENS_MODEL }),
      ).resolves.toEqual(['10-24mm']);
      expect(mocks.search.getCameraLensModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });

    it('should return search suggestions for camera lens model (including null)', async () => {
      mocks.search.getCameraLensModels.mockResolvedValue(['10-24mm']);

      await expect(
        sut.getSearchSuggestions(authStub.user1, { includeNull: true, type: SearchSuggestionType.CAMERA_LENS_MODEL }),
      ).resolves.toEqual(['10-24mm', null]);
      expect(mocks.search.getCameraLensModels).toHaveBeenCalledWith([authStub.user1.user.id], expect.anything());
    });
  });

  describe('new shape routing', () => {
    it('should route a filter request to the V3 search and a flat request to the legacy search', async () => {
      const auth = AuthFactory.create();

      mocks.search.searchMetadataV3.mockResolvedValue({ hasNextPage: false, items: [] });
      await sut.searchMetadata(auth, { size: 250, filter: {} });
      expect(mocks.search.searchMetadataV3).toHaveBeenCalled();
      expect(mocks.search.searchMetadata).not.toHaveBeenCalled();

      mocks.search.searchMetadata.mockResolvedValue({ hasNextPage: false, items: [] });
      await sut.searchMetadata(auth, { size: 250, city: 'Oslo' });
      expect(mocks.search.searchMetadata).toHaveBeenCalled();
    });

    it('should route statistics, random, and smart filter requests to their V3 search', async () => {
      const auth = AuthFactory.create();

      mocks.search.searchStatisticsV3.mockResolvedValue({ total: 0 });
      await expect(sut.searchStatistics(auth, { filter: {} })).resolves.toEqual({ total: 0 });

      mocks.search.searchRandomV3.mockResolvedValue([]);
      await expect(sut.searchRandom(auth, { size: 250, filter: {} })).resolves.toEqual([]);

      mocks.search.searchSmartV3ByIds.mockResolvedValue([]);
      mocks.embedding.isEnabled.mockReturnValue(true);
      mocks.embedding.embedText.mockResolvedValue([1, 2, 3]);
      mocks.vectorStore.search.mockResolvedValue([]);
      await sut.searchSmart(auth, { size: 100, filter: {}, query: 'test' });
      expect(mocks.search.searchSmartV3ByIds).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ lockedOwnerId: expect.any(String) }),
        [],
      );
    });

    it('should reject an invalid cursor', async () => {
      await expect(sut.searchMetadata(AuthFactory.create(), { size: 250, cursor: '???' })).rejects.toThrowError(
        new BadRequestException('Invalid cursor'),
      );
    });

    it('should reject an unelevated session whose filter could match locked assets', async () => {
      const filter = { visibility: { in: [AssetVisibility.Locked, AssetVisibility.Timeline] } };
      await expect(sut.searchMetadata(AuthFactory.create(), { size: 250, filter })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('searchSmart', () => {
    beforeEach(() => {
      mocks.embedding.isEnabled.mockReturnValue(true);
      mocks.embedding.getModelName.mockReturnValue('mock-embedding');
      mocks.embedding.embedText.mockResolvedValue([1, 2, 3]);
    });

    it('should raise a BadRequestException if cloud search is disabled', async () => {
      mocks.embedding.isEnabled.mockReturnValue(false);

      await expect(sut.searchSmart(authStub.user1, { size: 100, query: 'test' })).rejects.toThrowError(
        new BadRequestException('Smart search is not enabled'),
      );

      expect(mocks.embedding.embedText).not.toHaveBeenCalled();
    });

    it('should rank the candidates returned by the vector store', async () => {
      mocks.vectorStore.search.mockResolvedValue([
        { assetId: 'asset-b', distance: 0.1 },
        { assetId: 'asset-a', distance: 0.2 },
      ]);
      mocks.search.searchSmartByIds.mockResolvedValue([
        AssetFactory.create({ id: 'asset-a' }),
        AssetFactory.create({ id: 'asset-b' }),
      ] as never);

      const response = await sut.searchSmart(authStub.user1, { size: 100, query: 'test' });

      expect(mocks.embedding.embedText).toHaveBeenCalledWith('test');
      expect(mocks.search.searchSmartByIds).toHaveBeenCalledWith(
        expect.objectContaining({ assetIds: ['asset-b', 'asset-a'], userIds: [authStub.user1.user.id] }),
      );
      expect(response.assets.items.map((asset: { id: string }) => asset.id)).toEqual(['asset-b', 'asset-a']);
    });

    it('should cache text embeddings for repeated queries', async () => {
      mocks.vectorStore.search.mockResolvedValue([]);
      mocks.search.searchSmartByIds.mockResolvedValue([]);

      await sut.searchSmart(authStub.user1, { size: 100, query: 'baby' });
      await sut.searchSmart(authStub.user1, { size: 100, query: 'baby' });

      expect(mocks.embedding.embedText).toHaveBeenCalledTimes(1);
    });

    it('should reuse the stored vector when searching by asset', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-id']));
      mocks.vectorStore.get.mockResolvedValue([9, 9, 9]);
      mocks.vectorStore.search.mockResolvedValue([]);
      mocks.search.searchSmartByIds.mockResolvedValue([]);

      await sut.searchSmart(authStub.user1, { size: 100, queryAssetId: 'asset-id' });

      expect(mocks.embedding.embedText).not.toHaveBeenCalled();
      expect(mocks.vectorStore.get).toHaveBeenCalledWith('asset-id');
      expect(mocks.vectorStore.search).toHaveBeenCalledWith([9, 9, 9], expect.objectContaining({ topK: 400 }));
    });

    it('should re-embed the original when the store cannot return a vector', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-id']));
      mocks.vectorStore.get.mockResolvedValue(undefined);
      mocks.assetJob.getForClipEncoding.mockResolvedValue(AssetFactory.create({ id: 'asset-id' }));
      mocks.storage.readFile.mockResolvedValue(Buffer.from('original'));
      mocks.embedding.embedImage.mockResolvedValue([7, 7, 7]);
      mocks.vectorStore.search.mockResolvedValue([]);
      mocks.search.searchSmartByIds.mockResolvedValue([]);

      await sut.searchSmart(authStub.user1, { size: 100, queryAssetId: 'asset-id' });

      expect(mocks.embedding.embedImage).toHaveBeenCalledWith({
        data: Buffer.from('original'),
        mimeType: 'image/jpeg',
      });
      expect(mocks.vectorStore.search).toHaveBeenCalledWith([7, 7, 7], expect.anything());
    });

    it('should reject an asset without a stored vector', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set(['asset-id']));
      mocks.vectorStore.get.mockResolvedValue(undefined);
      mocks.assetJob.getForClipEncoding.mockResolvedValue(void 0);

      await expect(sut.searchSmart(authStub.user1, { size: 100, queryAssetId: 'asset-id' })).rejects.toThrowError(
        new BadRequestException('Asset asset-id has no embedding'),
      );
    });
  });
});

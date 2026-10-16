import { BadRequestException, Injectable } from '@nestjs/common';
import { LRUMap } from 'mnemonist';
import { AssetMapOptions, AssetResponseDto, MapAsset, mapAsset } from 'src/dtos/asset-response.dto.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import {
  LargeAssetSearchDto,
  MetadataSearchDto,
  PlacesResponseDto,
  RandomSearchDto,
  SearchFilter,
  SearchPlacesDto,
  SearchResponseDto,
  SearchStatisticsResponseDto,
  SearchSuggestionRequestDto,
  SearchSuggestionType,
  SmartSearchDto,
  StatisticsSearchDto,
  isFullyAlbumConfined,
  isNewShapeRequest,
  mapPlaces,
} from 'src/dtos/search.dto.js';
import { AssetOrder, AssetVisibility, Permission } from 'src/enum.js';
import { AssetSearchScope } from 'src/repositories/search.repository.js';
import { BaseService } from 'src/services/base.service.js';
import { requireElevatedPermission } from 'src/utils/access.js';
import { getMyPartnerIds } from 'src/utils/asset.util.js';
import { mimeTypes } from 'src/utils/mime-types.js';
import { decodeSearchCursor, encodeSearchCursor } from 'src/utils/search-cursor.js';
import { applyLockedVisibilityPolicy, collectFilterIds } from 'src/utils/search-filter.js';

/**
 * The vector store returns a ranked id list; the relational query returns rows in
 * arbitrary order. Re-apply the ranking, then page over it.
 */
const pageByRank = <T extends { id: string }>(rows: T[], rankedIds: string[], page: number, size: number) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ranked = rankedIds.map((id) => byId.get(id)).filter((row): row is T => row !== undefined);
  const start = (page - 1) * size;

  return {
    items: ranked.slice(start, start + size),
    hasNextPage: ranked.length > start + size,
  };
};

/**
 * How many vector hits to ask for per requested result. The relational filters
 * run afterwards, so we need slack; the cap keeps the SQL `in (...)` sane.
 */
const VECTOR_OVERFETCH = 4;
const MAX_VECTOR_CANDIDATES = 1000;

@Injectable()
export class SearchService extends BaseService {
  private embeddingCache = new LRUMap<string, number[]>(100);

  async searchPlaces(dto: SearchPlacesDto): Promise<PlacesResponseDto[]> {
    const places = await this.searchRepository.searchPlaces(dto.name);
    return places.map((place) => mapPlaces(place));
  }

  async getExploreData(auth: AuthDto) {
    const options = { maxFields: 12, minAssetsPerField: 5 };

    const cities = await this.assetRepository.getAssetIdByCity(auth.user.id, options);
    const cityAssets = await this.assetRepository.getByIdsWithAllRelationsButStacks(
      cities.items.map(({ data }) => data),
      auth.user.id,
    );
    const cityItems = cityAssets.map((asset) => ({ value: asset.exifInfo!.city!, data: mapAsset(asset, { auth }) }));

    const recents = await this.assetRepository.getRecentlyCreatedAssetIds(auth.user.id, options.maxFields);
    const recentAssets = await this.assetRepository.getByIdsWithAllRelationsButStacks(
      recents.items.map((item) => item.data),
      auth.user.id,
    );
    const recentItems = recentAssets.map((asset) => ({
      value: asset.createdAt.toISOString(),
      data: mapAsset(asset, { auth }),
    }));

    return [
      { fieldName: cities.fieldName, items: cityItems },
      { fieldName: recents.fieldName, items: recentItems },
    ];
  }

  async searchMetadata(auth: AuthDto, dto: MetadataSearchDto): Promise<SearchResponseDto> {
    if (isNewShapeRequest(dto)) {
      return this.searchMetadataV3(auth, dto);
    }

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    let checksum: Buffer | undefined;
    if (dto.checksum) {
      const encoding = dto.checksum.length === 28 ? 'base64' : 'hex';
      checksum = Buffer.from(dto.checksum, encoding);
    }

    let userIds: string[] | undefined;

    if (dto.albumIds && dto.albumIds.length > 0) {
      await this.requireAccess({ auth, ids: dto.albumIds, permission: Permission.AlbumRead });
    } else if (auth.sharedLink) {
      throw new BadRequestException('Shared link access is only allowed in combination with an albumIds filter');
    } else {
      userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    }

    const page = dto.page ?? 1;
    const size = dto.size;
    const { hasNextPage, items } = await this.searchRepository.searchMetadata(
      { page, size },
      {
        ...dto,
        checksum,
        visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
        userIds,
        viewingUserId: auth.user.id,
        orderDirection: dto.order ?? AssetOrder.Desc,
      },
    );

    return this.mapResponse(items, { auth }, { nextPage: hasNextPage ? (page + 1).toString() : null });
  }

  async searchStatistics(auth: AuthDto, dto: StatisticsSearchDto): Promise<SearchStatisticsResponseDto> {
    if (isNewShapeRequest(dto)) {
      return this.searchStatisticsV3(auth, dto);
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    return await this.searchRepository.searchStatistics({
      ...dto,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
  }

  async searchRandom(auth: AuthDto, dto: RandomSearchDto): Promise<AssetResponseDto[]> {
    if (isNewShapeRequest(dto)) {
      return this.searchRandomV3(auth, dto);
    }

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    const items = await this.searchRepository.searchRandom(dto.size, {
      ...dto,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async searchLargeAssets(auth: AuthDto, dto: LargeAssetSearchDto): Promise<AssetResponseDto[]> {
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    const items = await this.searchRepository.searchLargeAssets(dto.size, {
      ...dto,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async searchSmart(auth: AuthDto, dto: SmartSearchDto): Promise<SearchResponseDto> {
    if (isNewShapeRequest(dto)) {
      return this.searchSmartV3(auth, dto);
    }

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    if (!this.embeddingRepository.isEnabled()) {
      throw new BadRequestException('Smart search is not enabled');
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    const page = dto.page ?? 1;
    const size = dto.size;
    const candidates = await this.getVectorCandidates(auth, dto, page, size);

    const rows = await this.searchRepository.searchSmartByIds({
      ...dto,
      assetIds: candidates.ids,
      userIds,
      viewingUserId: auth.user.id,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
    });

    const { items, hasNextPage } = pageByRank(rows, candidates.ids, page, size);
    return this.mapResponse(items, { auth }, { nextPage: hasNextPage ? (page + 1).toString() : null });
  }

  async getAssetsByCity(auth: AuthDto): Promise<AssetResponseDto[]> {
    const userIds = await this.getUserIdsToSearch(auth);
    const assets = await this.searchRepository.getAssetsByCity(userIds);
    return assets.map((asset) => mapAsset(asset));
  }

  async getSearchSuggestions(auth: AuthDto, dto: SearchSuggestionRequestDto) {
    const userIds = await this.getUserIdsToSearch(auth);
    const suggestions = await this.getSuggestions(userIds, dto);
    if (dto.includeNull) {
      suggestions.push(null);
    }
    return suggestions;
  }

  private getSuggestions(userIds: string[], dto: SearchSuggestionRequestDto): Promise<Array<string | null>> {
    switch (dto.type) {
      case SearchSuggestionType.COUNTRY: {
        return this.searchRepository.getCountries(userIds);
      }
      case SearchSuggestionType.STATE: {
        return this.searchRepository.getStates(userIds, dto);
      }
      case SearchSuggestionType.CITY: {
        return this.searchRepository.getCities(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_MAKE: {
        return this.searchRepository.getCameraMakes(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_MODEL: {
        return this.searchRepository.getCameraModels(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_LENS_MODEL: {
        return this.searchRepository.getCameraLensModels(userIds, dto);
      }
      default: {
        return Promise.resolve([]);
      }
    }
  }

  private async searchMetadataV3(auth: AuthDto, dto: MetadataSearchDto): Promise<SearchResponseDto> {
    const { filter, scope } = await this.resolveSearchScopeV3(auth, dto);

    const { offset } = decodeSearchCursor(dto.cursor);
    const size = dto.size;
    const { hasNextPage, items } = await this.searchRepository.searchMetadataV3(
      { take: size, skip: offset },
      {
        filter,
        withExif: dto.withExif,
        withPeople: dto.withPeople,
        withStacked: dto.withStacked,
        order: dto.orderBy,
      },
      scope,
    );

    return this.mapResponse(items, { auth }, { nextCursor: hasNextPage ? encodeSearchCursor(offset + size) : null });
  }

  private async searchStatisticsV3(auth: AuthDto, dto: StatisticsSearchDto): Promise<SearchStatisticsResponseDto> {
    const { filter, scope } = await this.resolveSearchScopeV3(auth, dto);
    return this.searchRepository.searchStatisticsV3({ filter }, scope);
  }

  private async searchRandomV3(auth: AuthDto, dto: RandomSearchDto): Promise<AssetResponseDto[]> {
    const { filter, scope } = await this.resolveSearchScopeV3(auth, dto);
    const items = await this.searchRepository.searchRandomV3(
      dto.size,
      {
        filter,
        withExif: dto.withExif,
        withPeople: dto.withPeople,
        withStacked: dto.withStacked,
      },
      scope,
    );
    return items.map((item) => mapAsset(item, { auth }));
  }

  private async searchSmartV3(auth: AuthDto, dto: SmartSearchDto): Promise<SearchResponseDto> {
    if (!this.embeddingRepository.isEnabled()) {
      throw new BadRequestException('Smart search is not enabled');
    }

    const [{ filter, scope }, candidates] = await Promise.all([
      this.resolveSearchScopeV3(auth, dto),
      this.getVectorCandidates(auth, dto, 1, dto.size),
    ]);

    const rows = await this.searchRepository.searchSmartV3ByIds(
      { filter, withExif: dto.withExif },
      scope,
      candidates.ids,
    );

    // no cursor until a rank-aware pagination strategy for smart search is decided
    const { items } = pageByRank(rows, candidates.ids, 1, dto.size);
    return this.mapResponse(items, { auth });
  }

  private async resolveSearchScopeV3(
    auth: AuthDto,
    dto: { filter?: SearchFilter },
  ): Promise<{ filter: SearchFilter; scope: AssetSearchScope }> {
    const filter = dto.filter ?? {};
    const effectiveFilter = applyLockedVisibilityPolicy(auth, filter);

    const fullyConfined = isFullyAlbumConfined(filter);
    // a shared link visitor does not have a universe, so there every branch must be confined
    if (auth.sharedLink && !fullyConfined) {
      throw new BadRequestException('Shared link access is only allowed in combination with an albumIds filter');
    }

    const albumIds = collectFilterIds(filter, 'albumIds');
    const [userIds] = await Promise.all([
      // a fully confined filter searches albums only, so the unused universe can skip the partner lookup
      fullyConfined ? [auth.user.id] : this.getUserIdsToSearch(auth),
      albumIds.length > 0 ? this.requireAccess({ auth, ids: albumIds, permission: Permission.AlbumRead }) : undefined,
    ]);

    return { filter: effectiveFilter, scope: { userIds, lockedOwnerId: auth.user.id, viewingUserId: auth.user.id } };
  }

  /**
   * Ask the vector store for the nearest assets. Over-fetching keeps recall
   * acceptable because the relational filters (visibility, trash, dates...) are
   * applied afterwards in SQL and may drop some candidates.
   */
  private async getVectorCandidates(
    auth: AuthDto,
    dto: SmartSearchDto,
    page: number,
    size: number,
  ): Promise<{ ids: string[] }> {
    const embedding = await this.resolveEmbedding(auth, dto);
    const topK = Math.min(page * size * VECTOR_OVERFETCH, MAX_VECTOR_CANDIDATES);
    const matches = await this.vectorStoreRepository.search(embedding, { topK });
    return { ids: matches.map((match) => match.assetId) };
  }

  private async resolveEmbedding(auth: AuthDto, dto: SmartSearchDto): Promise<number[]> {
    if (dto.query) {
      const key = this.embeddingRepository.getModelName() + dto.query;
      let embedding = this.embeddingCache.get(key);
      if (!embedding) {
        embedding = await this.embeddingRepository.embedText(dto.query);
        this.embeddingCache.set(key, embedding);
      }
      return embedding;
    }

    if (dto.queryAssetId) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.queryAssetId] });
      const stored = await this.vectorStoreRepository.get(dto.queryAssetId);
      if (stored) {
        return stored;
      }

      // cloud stores (e.g. VikingDB) cannot hand back a stored vector, so
      // re-embed the original image instead
      const asset = await this.assetJobRepository.getForClipEncoding(dto.queryAssetId);
      if (!asset) {
        throw new BadRequestException(`Asset ${dto.queryAssetId} has no embedding`);
      }

      const data = await this.storageRepository.readFile(asset.originalPath);
      return this.embeddingRepository.embedImage({ data, mimeType: mimeTypes.lookup(asset.originalPath) });
    }

    throw new BadRequestException('Either `query` or `queryAssetId` must be set');
  }

  private async getUserIdsToSearch(auth: AuthDto, visibility?: AssetVisibility): Promise<string[]> {
    // Locked assets are personal. Never include partner IDs, regardless of A's elevated session.
    if (visibility === AssetVisibility.Locked) {
      return [auth.user.id];
    }
    const partnerIds = await getMyPartnerIds({
      userId: auth.user.id,
      repository: this.partnerRepository,
      timelineEnabled: true,
    });
    return [auth.user.id, ...partnerIds];
  }

  private mapResponse(
    assets: MapAsset[],
    options: AssetMapOptions,
    page: { nextPage?: string | null; nextCursor?: string | null } = {},
  ): SearchResponseDto {
    return {
      albums: { total: 0, count: 0, items: [], facets: [] },
      assets: {
        total: assets.length,
        count: assets.length,
        items: assets.map((asset) => mapAsset(asset, options)),
        facets: [],
        nextPage: page.nextPage ?? null,
        nextCursor: page.nextCursor ?? null,
      },
    };
  }
}

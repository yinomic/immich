import { ShallowDehydrateObject } from 'kysely';
import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import type { MaybeDehydrated } from 'src/types.js';
import { AlbumUser } from 'src/database.js';
import { HistoryBuilder } from 'src/decorators.js';
import { BulkIdErrorReasonSchema } from 'src/dtos/asset-ids.response.dto.js';
import { MapAsset } from 'src/dtos/asset-response.dto.js';
import { UserResponseSchema, mapUser } from 'src/dtos/user.dto.js';
import { AlbumUserRoleSchema, AssetOrder, AssetOrderSchema } from 'src/enum.js';
import { asDateTimeString } from 'src/utils/date.js';
import { stringToBool } from 'src/validation.js';

const CreateAlbumSchema = z
  .object({
    albumName: z.string().describe('Album name'),
    // TODO: drop the empty-string-to-null transform in v4 (clients should send null)
    description: z
      .string()
      .nullable()
      .transform((value) => (value === '' ? null : value))
      .optional()
      .describe('Album description')
      .meta({
        ...new HistoryBuilder()
          .added('v1')
          .updated(
            'v3',
            'Sending an empty string is deprecated; send null instead. Empty strings will no longer be coerced to null in v4.',
          )
          .getExtensions(),
      }),
    assetIds: z.array(z.uuidv4()).optional().describe('Initial asset IDs'),
  })
  .meta({ id: 'CreateAlbumDto' });

const AlbumsAddAssetsSchema = z
  .object({
    albumIds: z.array(z.uuidv4()).describe('Album IDs'),
    assetIds: z.array(z.uuidv4()).describe('Asset IDs'),
  })
  .meta({ id: 'AlbumsAddAssetsDto' });

const AlbumsAddAssetsResponseSchema = z
  .object({
    success: z.boolean().describe('Operation success'),
    error: BulkIdErrorReasonSchema.optional(),
  })
  .meta({ id: 'AlbumsAddAssetsResponseDto' });

const UpdateAlbumSchema = z
  .object({
    albumName: z.string().optional().describe('Album name'),
    // TODO: drop the empty-string-to-null transform in v4 (clients should send null)
    description: z
      .string()
      .nullable()
      .transform((value) => (value === '' ? null : value))
      .optional()
      .describe('Album description')
      .meta({
        ...new HistoryBuilder()
          .added('v1')
          .updated(
            'v3',
            'Sending an empty string is deprecated; send null instead. Empty strings will no longer be coerced to null in v4.',
          )
          .getExtensions(),
      }),
    albumThumbnailAssetId: z.uuidv4().optional().describe('Album thumbnail asset ID'),
    order: AssetOrderSchema.optional(),
  })
  .meta({ id: 'UpdateAlbumDto' });

const GetAlbumsSchema = z
  .object({
    id: z.uuidv4().optional().describe('Album ID'),
    name: z.string().optional().describe('Album name (exact match)'),
    isOwned: stringToBool
      .optional()
      .describe('Filter by ownership: true = only owned, false = only shared-with-me, undefined = no filter'),
    isShared: stringToBool
      .optional()
      .describe('Filter by shared status: true = only shared, false = not shared, undefined = no filter'),
    assetId: z.uuidv4().optional().describe('Filter albums containing this asset ID (ignores other parameters)'),
  })
  .meta({ id: 'GetAlbumsDto' });

const AlbumStatisticsResponseSchema = z
  .object({
    owned: z.int().min(0).describe('Number of owned albums'),
  })
  .meta({ id: 'AlbumStatisticsResponseDto' });

const AlbumUserResponseSchema = z
  .object({
    user: UserResponseSchema,
    role: AlbumUserRoleSchema,
  })
  .meta({ id: 'AlbumUserResponseDto' });

export const AlbumResponseSchema = z
  .object({
    id: z.uuidv4().describe('Album ID'),
    albumName: z.string().describe('Album name'),
    description: z
      .string()
      .describe('Album description')
      .meta({
        ...new HistoryBuilder()
          .added('v1')
          .updated(
            'v3',
            'An empty string is returned instead of null for backwards compatibility; null will be returned in v4.',
          )
          .getExtensions(),
      }),
    // TODO: use `isoDatetimeToDate` when using `ZodSerializerDto` on the controllers.
    createdAt: z.string().meta({ format: 'date-time' }).describe('Creation date'),
    // TODO: use `isoDatetimeToDate` when using `ZodSerializerDto` on the controllers.
    updatedAt: z.string().meta({ format: 'date-time' }).describe('Last update date'),
    albumThumbnailAssetId: z.uuidv4().nullable().describe('Thumbnail asset ID'),
    albumUsers: z
      .array(AlbumUserResponseSchema)
      .min(1)
      .describe(
        'First entry is always the album owner. Second entry is the auth user, if it differs from the owner. The rest are ordered alphabetically.',
      ),
    assetCount: z.int().min(0).describe('Number of assets'),
    // TODO: use `isoDatetimeToDate` when using `ZodSerializerDto` on the controllers.
    lastModifiedAssetTimestamp: z
      .string()
      .meta({ format: 'date-time' })
      .optional()
      .describe('Last modified asset timestamp'),
    // TODO: use `isoDatetimeToDate` when using `ZodSerializerDto` on the controllers.
    startDate: z
      .string()
      .meta({ format: 'date-time' })
      .optional()
      .describe('UTC representation of (local) start date (earliest asset)'),
    // TODO: use `isoDatetimeToDate` when using `ZodSerializerDto` on the controllers.
    endDate: z
      .string()
      .meta({ format: 'date-time' })
      .optional()
      .describe('UTC representation of (local) end date (latest asset)'),
    order: AssetOrderSchema.optional(),
  })
  .meta({ id: 'AlbumResponseDto' });

export class CreateAlbumDto extends createZodDto(CreateAlbumSchema) {}
export class AlbumsAddAssetsDto extends createZodDto(AlbumsAddAssetsSchema) {}
export class AlbumsAddAssetsResponseDto extends createZodDto(AlbumsAddAssetsResponseSchema) {}
export class UpdateAlbumDto extends createZodDto(UpdateAlbumSchema) {}
export class GetAlbumsDto extends createZodDto(GetAlbumsSchema) {}
export class AlbumStatisticsResponseDto extends createZodDto(AlbumStatisticsResponseSchema) {}
export class AlbumResponseDto extends createZodDto(AlbumResponseSchema) {}
class AlbumUserResponseDto extends createZodDto(AlbumUserResponseSchema) {}

export type MapAlbumDto = {
  albumUsers?: AlbumUser[];
  assets?: ShallowDehydrateObject<MapAsset>[];
  albumName: string;
  description: string | null;
  albumThumbnailAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  id: string;
  order: AssetOrder;
};

export const mapAlbum = (entity: MaybeDehydrated<MapAlbumDto>): AlbumResponseDto => {
  const albumUsers: AlbumUserResponseDto[] = [];

  if (entity.albumUsers) {
    for (const albumUser of entity.albumUsers) {
      const user = mapUser(albumUser.user);
      albumUsers.push({
        user,
        role: albumUser.role,
      });
    }
  }

  const assets = entity.assets || [];

  let startDate = assets.at(0)?.localDateTime;
  let endDate = assets.at(-1)?.localDateTime;
  // Swap dates if start date is greater than end date.
  if (startDate && endDate && startDate > endDate) {
    [startDate, endDate] = [endDate, startDate];
  }

  return {
    albumName: entity.albumName,
    // TODO: return null instead of '' in v4
    description: entity.description ?? '',
    albumThumbnailAssetId: entity.albumThumbnailAssetId,
    createdAt: asDateTimeString(entity.createdAt),
    updatedAt: asDateTimeString(entity.updatedAt),
    id: entity.id,
    albumUsers,
    startDate: asDateTimeString(startDate),
    endDate: asDateTimeString(endDate),
    assetCount: entity.assets?.length || 0,
    order: entity.order,
  };
};

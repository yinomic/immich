import { registerEnum } from '@immich/sql-tools';
import { AlbumUserRole, AssetStatus, AssetVisibility, ChecksumAlgorithm, VideoCodec } from 'src/enum.js';

export const album_user_role_enum = registerEnum({
  name: 'album_user_role_enum',
  // 'editor' and 'viewer' are legacy values from before album collaboration was
  // removed. They stay in the type because PostgreSQL cannot drop enum values in
  // place and recreating the type would invalidate postgres.js's cached type
  // information for the running process. The API only ever writes 'owner'.
  values: [AlbumUserRole.Owner, 'editor', 'viewer'],
});

export const assets_status_enum = registerEnum({
  name: 'assets_status_enum',
  values: Object.values(AssetStatus),
});

export const asset_visibility_enum = registerEnum({
  name: 'asset_visibility_enum',
  values: Object.values(AssetVisibility),
});

export const asset_checksum_algorithm_enum = registerEnum({
  name: 'asset_checksum_algorithm_enum',
  values: Object.values(ChecksumAlgorithm),
});

export const video_stream_variant_codec_enum = registerEnum({
  name: 'video_stream_variant_codec_enum',
  values: [VideoCodec.Av1, VideoCodec.Hevc, VideoCodec.H264],
});

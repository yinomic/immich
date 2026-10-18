import { faker } from '@faker-js/faker';
import {
  AlbumUserRole,
  AssetOrder,
  UserAvatarColor,
  type AlbumResponseDto,
  type AlbumUserResponseDto,
} from '@immich/sdk';
import { Sync } from 'factory.ts';

const owner = (): AlbumUserResponseDto => ({
  role: AlbumUserRole.Owner,
  user: {
    id: faker.string.uuid(),
    email: faker.internet.email(),
    name: faker.person.fullName(),
    profileImagePath: '',
    avatarColor: UserAvatarColor.Primary,
    profileChangedAt: faker.date.past().toISOString(),
  },
});

export const albumFactory = Sync.makeFactory<AlbumResponseDto>({
  albumName: Sync.each(() => faker.commerce.product()),
  description: '',
  albumThumbnailAssetId: null,
  assetCount: Sync.each((index) => index % 5),
  createdAt: Sync.each(() => faker.date.past().toISOString()),
  updatedAt: Sync.each(() => faker.date.past().toISOString()),
  id: Sync.each(() => faker.string.uuid()),
  albumUsers: Sync.each(() => [owner()]),
  order: AssetOrder.Desc,
});

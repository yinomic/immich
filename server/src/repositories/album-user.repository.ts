import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import type { Insertable, Kysely } from 'kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { DB } from 'src/schema/index.js';
import { AlbumUserTable } from 'src/schema/tables/album-user.table.js';

export type AlbumPermissionId = {
  albumId: string;
  userId: string;
};

@Injectable()
export class AlbumUserRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [{ userId: DummyValue.UUID, albumId: DummyValue.UUID }] })
  create(albumUser: Insertable<AlbumUserTable>) {
    return this.db
      .insertInto('album_user')
      .values(albumUser)
      .returning(['userId', 'albumId', 'role'])
      .executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [{ userId: DummyValue.UUID, albumId: DummyValue.UUID }] })
  async delete({ userId, albumId }: AlbumPermissionId): Promise<void> {
    await this.db.deleteFrom('album_user').where('userId', '=', userId).where('albumId', '=', albumId).execute();
  }
}

import { Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { ChunkedSet, DummyValue, GenerateSql } from 'src/decorators.js';
import { AlbumUserRole, AssetVisibility } from 'src/enum.js';
import { DB } from 'src/schema/index.js';

class AlbumAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkOwnerAccess(userId: string, albumIds: Set<string>) {
    if (albumIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('album')
      .select('album.id')
      .where('album.id', 'in', [...albumIds])
      .innerJoin('album_user', (join) =>
        join
          .onRef('album.id', '=', 'album_user.albumId')
          .on('album_user.role', '=', sql.lit(AlbumUserRole.Owner))
          .on('album_user.userId', '=', userId),
      )
      .where('album.deletedAt', 'is', null)
      .execute()
      .then((albums) => new Set(albums.map((album) => album.id)));
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkSharedAlbumAccess(userId: string, albumIds: Set<string>, access: AlbumUserRole) {
    if (albumIds.size === 0) {
      return new Set<string>();
    }

    const accessRole =
      access === AlbumUserRole.Editor ? [AlbumUserRole.Editor] : [AlbumUserRole.Editor, AlbumUserRole.Viewer];

    return this.db
      .selectFrom('album')
      .select('album.id')
      .innerJoin('album_user', 'album_user.albumId', 'album.id')
      .innerJoin('user', (join) => join.onRef('user.id', '=', 'album_user.userId').on('user.deletedAt', 'is', null))
      .where('album.id', 'in', [...albumIds])
      .where('album.deletedAt', 'is', null)
      .where('user.id', '=', userId)
      .where('album_user.role', 'in', [...accessRole])
      .execute()
      .then((albums) => new Set(albums.map((album) => album.id)));
  }
}

class AssetAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkAlbumAccess(userId: string, assetIds: Set<string>) {
    if (assetIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .with('target', (qb) => qb.selectNoFrom(sql`array[${sql.join([...assetIds])}]::uuid[]`.as('ids')))
      .selectFrom('album')
      .innerJoin('album_asset as albumAssets', 'album.id', 'albumAssets.albumId')
      .innerJoin('asset', (join) =>
        join.onRef('asset.id', '=', 'albumAssets.assetId').on('asset.deletedAt', 'is', null),
      )
      .leftJoin('album_user as albumUsers', 'albumUsers.albumId', 'album.id')
      .leftJoin('user', (join) => join.onRef('user.id', '=', 'albumUsers.userId').on('user.deletedAt', 'is', null))
      .crossJoin('target')
      .select(['asset.id', 'asset.livePhotoVideoId'])
      .where((eb) =>
        eb.or([
          eb('asset.id', '=', sql<string>`any(target.ids)`),
          eb('asset.livePhotoVideoId', '=', sql<string>`any(target.ids)`),
        ]),
      )
      .where('user.id', '=', userId)
      .where('album.deletedAt', 'is', null)
      .execute()
      .then((assets) => {
        const allowedIds = new Set<string>();
        for (const asset of assets) {
          if (asset.id && assetIds.has(asset.id)) {
            allowedIds.add(asset.id);
          }
          if (asset.livePhotoVideoId && assetIds.has(asset.livePhotoVideoId)) {
            allowedIds.add(asset.livePhotoVideoId);
          }
        }
        return allowedIds;
      });
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkOwnerAccess(userId: string, assetIds: Set<string>, hasElevatedPermission: boolean | undefined) {
    if (assetIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('asset')
      .select('asset.id')
      .where('asset.id', 'in', [...assetIds])
      .where('asset.ownerId', '=', userId)
      .$if(!hasElevatedPermission, (eb) => eb.where('asset.visibility', '!=', AssetVisibility.Locked))
      .execute()
      .then((assets) => new Set(assets.map((asset) => asset.id)));
  }
}

class AssetFileAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkOwnerAccess(userId: string, fileIds: Set<string>, hasElevatedPermission: boolean | undefined) {
    if (fileIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('asset_file')
      .select('asset_file.id')
      .innerJoin('asset', 'asset.id', 'asset_file.assetId')
      .$if(!hasElevatedPermission, (eb) => eb.where('asset.visibility', '!=', AssetVisibility.Locked))
      .where('asset.ownerId', '=', userId)
      .where('asset_file.id', 'in', [...fileIds])
      .execute()
      .then((files) => new Set(files.map(({ id }) => id)));
  }
}

class AuthDeviceAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkOwnerAccess(userId: string, deviceIds: Set<string>) {
    if (deviceIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('session')
      .select('session.id')
      .where('session.userId', '=', userId)
      .where('session.id', 'in', [...deviceIds])
      .execute()
      .then((tokens) => new Set(tokens.map((token) => token.id)));
  }
}

class NotificationAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkOwnerAccess(userId: string, notificationIds: Set<string>) {
    if (notificationIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('notification')
      .select('notification.id')
      .where('notification.id', 'in', [...notificationIds])
      .where('notification.userId', '=', userId)
      .execute()
      .then((stacks) => new Set(stacks.map((stack) => stack.id)));
  }
}

class SessionAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkOwnerAccess(userId: string, sessionIds: Set<string>) {
    if (sessionIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('session')
      .select('session.id')
      .where('session.id', 'in', [...sessionIds])
      .where('session.userId', '=', userId)
      .execute()
      .then((sessions) => new Set(sessions.map((session) => session.id)));
  }
}
class StackAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkOwnerAccess(userId: string, stackIds: Set<string>) {
    if (stackIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('stack')
      .select('stack.id')
      .where('stack.id', 'in', [...stackIds])
      .where('stack.ownerId', '=', userId)
      .execute()
      .then((stacks) => new Set(stacks.map((stack) => stack.id)));
  }
}

class TimelineAccess {
  constructor(private db: Kysely<DB>) {}
}

class MemoryAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkOwnerAccess(userId: string, memoryIds: Set<string>) {
    if (memoryIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('memory')
      .select('memory.id')
      .where('memory.id', 'in', [...memoryIds])
      .where('memory.ownerId', '=', userId)
      .where('memory.deletedAt', 'is', null)
      .execute()
      .then((memories) => new Set(memories.map((memory) => memory.id)));
  }
}

class TagAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkOwnerAccess(userId: string, tagIds: Set<string>) {
    if (tagIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('tag')
      .select('tag.id')
      .where('tag.id', 'in', [...tagIds])
      .where('tag.userId', '=', userId)
      .execute()
      .then((tags) => new Set(tags.map((tag) => tag.id)));
  }
}

class WorkflowAccess {
  constructor(private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkOwnerAccess(userId: string, workflowIds: Set<string>) {
    if (workflowIds.size === 0) {
      return new Set<string>();
    }

    return this.db
      .selectFrom('workflow')
      .select('workflow.id')
      .where('workflow.id', 'in', [...workflowIds])
      .where('workflow.ownerId', '=', userId)
      .execute()
      .then((workflows) => new Set(workflows.map((workflow) => workflow.id)));
  }
}

@Injectable()
export class AccessRepository {
  album: AlbumAccess;
  asset: AssetAccess;
  assetFile: AssetFileAccess;
  authDevice: AuthDeviceAccess;
  memory: MemoryAccess;
  notification: NotificationAccess;
  session: SessionAccess;
  stack: StackAccess;
  tag: TagAccess;
  timeline: TimelineAccess;
  workflow: WorkflowAccess;

  constructor(@InjectKysely() db: Kysely<DB>) {
    this.album = new AlbumAccess(db);
    this.asset = new AssetAccess(db);
    this.assetFile = new AssetFileAccess(db);
    this.authDevice = new AuthDeviceAccess(db);
    this.memory = new MemoryAccess(db);
    this.notification = new NotificationAccess(db);
    this.session = new SessionAccess(db);
    this.stack = new StackAccess(db);
    this.tag = new TagAccess(db);
    this.timeline = new TimelineAccess(db);
    this.workflow = new WorkflowAccess(db);
  }
}

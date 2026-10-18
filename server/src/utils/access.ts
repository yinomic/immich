import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { Permission } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';

export type GrantedRequest = {
  requested: Permission[];
  current: Permission[];
};

export const isGranted = ({ requested, current }: GrantedRequest) => {
  if (current.includes(Permission.All)) {
    return true;
  }

  return new Set(current).isSupersetOf(new Set(requested));
};

export const areSetsEqual = <T>(setA: Set<T>, setB: Set<T>): boolean => {
  return setA.size === setB.size && setA.isSupersetOf(setB);
};

export type AccessRequest = {
  auth: AuthDto;
  permission: Permission;
  ids: Set<string> | string[];
};

type OtherAccessRequest = { auth: AuthDto; permission: Permission; ids: Set<string> };

export const requireUploadAccess = (auth: AuthDto | null): AuthDto => {
  if (!auth) {
    throw new UnauthorizedException();
  }
  return auth;
};

export const requireAccess = async (access: AccessRepository, request: AccessRequest) => {
  const allowedIds = await checkAccess(access, request);
  if (!areSetsEqual(new Set(request.ids), allowedIds)) {
    throw new BadRequestException(`Not found or no ${request.permission} access`);
  }
};

export const checkAccess = async (
  access: AccessRepository,
  { ids, auth, permission }: AccessRequest,
): Promise<Set<string>> => {
  const idSet = Array.isArray(ids) ? new Set(ids) : ids;
  if (idSet.size === 0) {
    return new Set<string>();
  }

  // NOTE (family fork): shared links are gone, so access is always personal
  return checkOtherAccess(access, { auth, permission, ids: idSet });
};

const checkOtherAccess = async (access: AccessRepository, request: OtherAccessRequest): Promise<Set<string>> => {
  const { auth, permission, ids } = request;

  switch (permission) {
    case Permission.AssetRead: {
      const isOwner = await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
      const isAlbum = await access.asset.checkAlbumAccess(auth.user.id, ids.difference(isOwner));
      return isOwner.union(isAlbum);
    }

    case Permission.AssetShare: {
      return access.asset.checkOwnerAccess(auth.user.id, ids, false);
    }

    case Permission.AssetFileDownload: {
      return access.assetFile.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    case Permission.AssetView: {
      const isOwner = await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
      const isAlbum = await access.asset.checkAlbumAccess(auth.user.id, ids.difference(isOwner));
      return isOwner.union(isAlbum);
    }

    case Permission.AssetDownload: {
      const isOwner = await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
      const isAlbum = await access.asset.checkAlbumAccess(auth.user.id, ids.difference(isOwner));
      return isOwner.union(isAlbum);
    }

    case Permission.AssetUpdate: {
      return await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    case Permission.AssetDelete: {
      return await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    case Permission.AssetCopy: {
      return await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    case Permission.AssetEditGet: {
      return await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    case Permission.AssetEditCreate: {
      return await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    case Permission.AssetEditDelete: {
      return await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    case Permission.AssetFileRead:
    case Permission.AssetFileDelete: {
      return await access.assetFile.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    // a single account owns every album, so album access is ownership only
    case Permission.AlbumRead:
    case Permission.AlbumAssetCreate:
    case Permission.AlbumUpdate:
    case Permission.AlbumDelete:
    case Permission.AlbumDownload:
    case Permission.AlbumAssetDelete: {
      return access.album.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.AssetUpload: {
      return ids.has(auth.user.id) ? new Set([auth.user.id]) : new Set<string>();
    }

    case Permission.ArchiveRead: {
      return ids.has(auth.user.id) ? new Set([auth.user.id]) : new Set();
    }

    case Permission.AuthDeviceDelete: {
      return await access.authDevice.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.NotificationRead:
    case Permission.NotificationUpdate:
    case Permission.NotificationDelete: {
      return access.notification.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.TagAsset:
    case Permission.TagRead:
    case Permission.TagUpdate:
    case Permission.TagDelete: {
      return await access.tag.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.TimelineRead: {
      return ids.has(auth.user.id) ? new Set([auth.user.id]) : new Set<string>();
    }

    case Permission.TimelineDownload: {
      return ids.has(auth.user.id) ? new Set([auth.user.id]) : new Set();
    }

    case Permission.MemoryRead: {
      return access.memory.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.MemoryUpdate: {
      return access.memory.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.MemoryDelete: {
      return access.memory.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.SessionRead:
    case Permission.SessionUpdate:
    case Permission.SessionDelete:
    case Permission.SessionLock: {
      return access.session.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.StackRead: {
      return access.stack.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.StackUpdate: {
      return access.stack.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.StackDelete: {
      return access.stack.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.WorkflowRead:
    case Permission.WorkflowUpdate:
    case Permission.WorkflowDelete:
    case Permission.WorkflowLogs: {
      return access.workflow.checkOwnerAccess(auth.user.id, ids);
    }

    default: {
      return new Set<string>();
    }
  }
};

export const requireElevatedPermission = (auth: AuthDto) => {
  if (!auth.session?.hasElevatedPermission) {
    throw new UnauthorizedException('Elevated permission is required');
  }
};

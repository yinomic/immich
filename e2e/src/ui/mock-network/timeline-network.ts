import { AssetResponseDto } from '@immich/sdk';
import { BrowserContext, Page, Request, Route } from '@playwright/test';
import { basename } from 'node:path';
import {
  Changes,
  getAlbum,
  getAsset,
  getTimeBucket,
  getTimeBuckets,
  randomPreview,
  randomThumbnail,
  TimelineData,
} from 'src/ui/generators/timeline';
import { sleep } from 'src/ui/specs/timeline/utils.js';

// Minimal valid H.264 MP4 (8x8px, 1 frame) that browsers can decode to get videoWidth/videoHeight
const MINIMAL_MP4_BASE64 =
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAr9tZGF0AAACoAYF//+c' +
  '3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDEyNSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMg' +
  'LSBDb3B5bGVmdCAyMDAzLTIwMTIgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwg' +
  'LSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMg' +
  'bWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5n' +
  'ZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEg' +
  'ZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz02IGxvb2thaGVhZF90aHJl' +
  'YWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJh' +
  'eV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2Fk' +
  'YXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtl' +
  'eWludD0yNTAga2V5aW50X21pbj0yNCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9v' +
  'a2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBt' +
  'YXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA9liIQAV/0TAAYdeBTX' +
  'zg8AAALvbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAACoAAQAAAQAAAAAAAAAAAAAAAAEAAAAA' +
  'AAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAA' +
  'Ahl0cmFrAAAAXHRraGQAAAAPAAAAAAAAAAAAAAABAAAAAAAAACoAAAAAAAAAAAAAAAAAAAAAAAEAAAAA' +
  'AAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAgAAAAIAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAA' +
  'AAEAAAAqAAAAAAABAAAAAAGRbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAAgBVxAAAAAAA' +
  'LWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABPG1pbmYAAAAUdm1oZAAA' +
  'AAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPxzdGJsAAAAmHN0' +
  'c2QAAAAAAAAAAQAAAIhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAgACABIAAAASAAAAAAAAAAB' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMmF2Y0MBZAAK/+EAGWdkAAqs' +
  '2V+WXAWyAAADAAIAAAMAYB4kSywBAAZo6+PLIsAAAAAYc3R0cwAAAAAAAAABAAAAAQAAAgAAAAAcc3Rz' +
  'YwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAACtwAAAAEAAAAUc3RjbwAAAAAAAAABAAAA' +
  'MAAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWls' +
  'c3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNTQuNjMuMTA0';

export const MINIMAL_MP4_BUFFER = Buffer.from(MINIMAL_MP4_BASE64, 'base64');

export class TimelineTestContext {
  slowBucket = false;
  adminId = '';
}

export const setupTimelineMockApiRoutes = async (
  context: BrowserContext,
  timelineRestData: TimelineData,
  changes: Changes,
  testContext: TimelineTestContext,
) => {
  await context.route('**/api/timeline**', async (route, request) => {
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === '/api/timeline/buckets') {
      const albumId = url.searchParams.get('albumId') || undefined;
      const isTrashed = url.searchParams.get('isTrashed') ? url.searchParams.get('isTrashed') === 'true' : undefined;
      const isFavorite = url.searchParams.get('isFavorite') ? url.searchParams.get('isFavorite') === 'true' : undefined;
      const isArchived = url.searchParams.get('visibility')
        ? url.searchParams.get('visibility') === 'archive'
        : undefined;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: getTimeBuckets(timelineRestData, isTrashed, isArchived, isFavorite, albumId, changes),
      });
    }
    if (pathname === '/api/timeline/bucket') {
      const timeBucket = url.searchParams.get('timeBucket');
      if (!timeBucket) {
        return route.continue();
      }
      const isTrashed = url.searchParams.get('isTrashed') ? url.searchParams.get('isTrashed') === 'true' : undefined;
      const isArchived = url.searchParams.get('visibility')
        ? url.searchParams.get('visibility') === 'archive'
        : undefined;
      const isFavorite = url.searchParams.get('isFavorite') ? url.searchParams.get('isFavorite') === 'true' : undefined;
      const albumId = url.searchParams.get('albumId') || undefined;
      const assets = getTimeBucket(timelineRestData, timeBucket, isTrashed, isArchived, isFavorite, albumId, changes);
      if (testContext.slowBucket) {
        await sleep(5000);
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: assets,
      });
    }
    return route.continue();
  });

  await context.route('**/api/assets/*', async (route, request) => {
    if (request.method() === 'GET') {
      const url = new URL(request.url());
      const pathname = url.pathname;
      const assetId = basename(pathname);
      let asset = getAsset(timelineRestData, assetId);
      if (changes.assetDeletions.includes(asset!.id)) {
        asset = {
          ...asset,
          isTrashed: true,
        } as AssetResponseDto;
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: asset,
      });
    }
    await route.fallback();
  });

  await context.route('**/api/assets', async (route, request) => {
    if (request.method() === 'DELETE') {
      return route.fulfill({
        status: 204,
      });
    }
    await route.fallback();
  });

  await context.route('**/api/assets/*/thumbnail?size=*', async (route, request) => {
    const pattern = /\/api\/assets\/(?<assetId>[^/]+)\/thumbnail\?size=(?<size>preview|thumbnail)/;
    const match = request.url().match(pattern);
    if (!match?.groups) {
      throw new Error(`Invalid URL for thumbnail endpoint: ${request.url()}`);
    }

    if (match.groups.size === 'preview') {
      if (!route.request().serviceWorker()) {
        return route.continue();
      }
      const asset = getAsset(timelineRestData, match.groups.assetId);
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'image/jpeg', ETag: 'abc123', 'Cache-Control': 'public, max-age=3600' },
        body: await randomPreview(
          match.groups.assetId,
          (asset?.exifInfo?.exifImageWidth ?? 0) / (asset?.exifInfo?.exifImageHeight ?? 1),
        ),
      });
    }
    if (match.groups.size === 'thumbnail') {
      if (!route.request().serviceWorker()) {
        return route.continue();
      }
      const asset = getAsset(timelineRestData, match.groups.assetId);
      return route.fulfill({
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
        body: await randomThumbnail(
          match.groups.assetId,
          (asset?.exifInfo?.exifImageWidth ?? 0) / (asset?.exifInfo?.exifImageHeight ?? 1),
        ),
      });
    }
    return route.continue();
  });

  await context.route('**/api/assets/*/video/playback*', async (route) => {
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'video/mp4' },
      body: MINIMAL_MP4_BUFFER,
    });
  });

  await context.route('**/api/albums/**', async (route, request) => {
    const albumsMatch = request.url().match(/\/api\/albums\/(?<albumId>[^/?]+)/);
    if (albumsMatch) {
      const album = getAlbum(timelineRestData, testContext.adminId, albumsMatch.groups?.albumId, changes);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: album,
      });
    }
    return route.fallback();
  });

  await context.route('**/api/albums**', async (route, request) => {
    const allAlbums = request.url().match(/\/api\/albums\?assetId=(?<assetId>[^&]+)/);
    if (allAlbums) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: [],
      });
    }
    return route.fallback();
  });
};

export const pageRoutePromise = async (
  page: Page,
  route: string,
  callback: (route: Route, request: Request) => Promise<void>,
) => {
  let resolveRequest: ((value: unknown | PromiseLike<unknown>) => void) | undefined;
  const deleteRequest = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  await page.route(route, async (route, request) => {
    await callback(route, request);
    const requestJson = request.postDataJSON();
    resolveRequest?.(requestJson);
  });
  return deleteRequest;
};

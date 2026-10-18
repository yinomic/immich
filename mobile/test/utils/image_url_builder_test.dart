import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart';

void main() {
  const endpoint = 'http://localhost:3000';

  setUpAll(() async {
    final db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await StoreService.I.put(StoreKey.serverEndpoint, endpoint);
  });

  group('getOriginalUrlForRemoteId', () {
    test('points at the original endpoint and honours the edited flag', () {
      expect(getOriginalUrlForRemoteId('asset-1'), '$endpoint/assets/asset-1/original?edited=true');
      expect(getOriginalUrlForRemoteId('asset-1', edited: false), '$endpoint/assets/asset-1/original?edited=false');
    });
  });

  group('getThumbnailUrlForRemoteId', () {
    test('defaults to the thumbnail size', () {
      expect(
        getThumbnailUrlForRemoteId('asset-1'),
        '$endpoint/assets/asset-1/thumbnail?size=${AssetMediaSize.thumbnail}&edited=true',
      );
    });

    test('appends the thumbhash as a cache buster when provided', () {
      final url = getThumbnailUrlForRemoteId('asset-1', thumbhash: 'abc');
      expect(url, endsWith('&c=abc'));
    });
  });

  group('getPlaybackUrlForRemoteId', () {
    test('points at the playback endpoint', () {
      expect(getPlaybackUrlForRemoteId('asset-1'), '$endpoint/assets/asset-1/video/playback?');
    });
  });
}

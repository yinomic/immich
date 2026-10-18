import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/remote_album/album_option.widget.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  group('DriftRemoteAlbumOption', () {
    testWidgets('shows kebab menu icon button', (tester) async {
      await tester.pumpConsumerWidget(const RemoteAlbumOption());

      expect(find.byIcon(Icons.more_vert_rounded), findsOneWidget);
    });

    testWidgets('opens menu when icon button is tapped', (tester) async {
      await tester.pumpConsumerWidget(RemoteAlbumOption(onEditAlbum: () {}));

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.edit), findsOneWidget);
    });

    testWidgets('shows edit album option when onEditAlbum is provided', (tester) async {
      bool editCalled = false;

      await tester.pumpConsumerWidget(RemoteAlbumOption(onEditAlbum: () => editCalled = true));

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.edit), findsOneWidget);

      await tester.tap(find.byIcon(Icons.edit));
      await tester.pumpAndSettle();

      expect(editCalled, isTrue);
    });

    testWidgets('hides edit album option when onEditAlbum is null', (tester) async {
      await tester.pumpConsumerWidget(RemoteAlbumOption(onAddPhotos: () {}));

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.edit), findsNothing);
    });

    testWidgets('shows add photos option when onAddPhotos is provided', (tester) async {
      bool addPhotosCalled = false;

      await tester.pumpConsumerWidget(RemoteAlbumOption(onAddPhotos: () => addPhotosCalled = true));

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.add_a_photo), findsOneWidget);

      await tester.tap(find.byIcon(Icons.add_a_photo));
      await tester.pumpAndSettle();

      expect(addPhotosCalled, isTrue);
    });

    testWidgets('hides add photos option when onAddPhotos is null', (tester) async {
      await tester.pumpConsumerWidget(RemoteAlbumOption(onEditAlbum: () {}));

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.add_a_photo), findsNothing);
    });

    testWidgets('shows toggle album order option when onToggleAlbumOrder is provided', (tester) async {
      bool toggleOrderCalled = false;

      await tester.pumpConsumerWidget(RemoteAlbumOption(onToggleAlbumOrder: () => toggleOrderCalled = true));

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.swap_vert_rounded), findsOneWidget);

      await tester.tap(find.byIcon(Icons.swap_vert_rounded));
      await tester.pumpAndSettle();

      expect(toggleOrderCalled, isTrue);
    });

    testWidgets('hides toggle album order option when onToggleAlbumOrder is null', (tester) async {
      await tester.pumpConsumerWidget(RemoteAlbumOption(onEditAlbum: () {}));

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.swap_vert_rounded), findsNothing);
    });

    testWidgets('shows delete album option when onDeleteAlbum is provided', (tester) async {
      bool deleteAlbumCalled = false;

      await tester.pumpConsumerWidget(RemoteAlbumOption(onDeleteAlbum: () => deleteAlbumCalled = true));

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.delete), findsOneWidget);

      await tester.tap(find.byIcon(Icons.delete));
      await tester.pumpAndSettle();

      expect(deleteAlbumCalled, isTrue);
    });

    testWidgets('hides delete album option when onDeleteAlbum is null', (tester) async {
      await tester.pumpConsumerWidget(RemoteAlbumOption(onEditAlbum: () {}));

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.delete), findsNothing);
    });

    testWidgets('separates delete option with divider', (tester) async {
      await tester.pumpConsumerWidget(RemoteAlbumOption(onEditAlbum: () {}, onDeleteAlbum: () {}));

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byType(Divider), findsOneWidget);
    });

    testWidgets('shows all options when all callbacks are provided', (tester) async {
      await tester.pumpConsumerWidget(
        RemoteAlbumOption(onEditAlbum: () {}, onAddPhotos: () {}, onToggleAlbumOrder: () {}, onDeleteAlbum: () {}),
      );

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.edit), findsOneWidget);
      expect(find.byIcon(Icons.add_a_photo), findsOneWidget);
      expect(find.byIcon(Icons.swap_vert_rounded), findsOneWidget);
      expect(find.byIcon(Icons.delete), findsOneWidget);
      expect(find.byType(Divider), findsOneWidget);
    });

    testWidgets('shows no options when all callbacks are null', (tester) async {
      await tester.pumpConsumerWidget(const RemoteAlbumOption());

      await tester.tap(find.byIcon(Icons.more_vert_rounded));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.edit), findsNothing);
      expect(find.byIcon(Icons.add_a_photo), findsNothing);
      expect(find.byIcon(Icons.swap_vert_rounded), findsNothing);
      expect(find.byIcon(Icons.delete), findsNothing);
    });

    testWidgets('uses custom icon color when provided', (tester) async {
      const customColor = Colors.red;

      await tester.pumpConsumerWidget(const RemoteAlbumOption(iconColor: customColor));

      final iconButton = tester.widget<IconButton>(find.byType(IconButton));
      final icon = iconButton.icon as Icon;

      expect(icon.color, equals(customColor));
    });

    testWidgets('uses default white color when iconColor is null', (tester) async {
      await tester.pumpConsumerWidget(const RemoteAlbumOption());

      final iconButton = tester.widget<IconButton>(find.byType(IconButton));
      final icon = iconButton.icon as Icon;

      expect(icon.color, equals(Colors.white));
    });

    testWidgets('applies icon shadows when provided', (tester) async {
      final shadows = [const Shadow(offset: Offset(0, 2), blurRadius: 5, color: Colors.black)];

      await tester.pumpConsumerWidget(RemoteAlbumOption(iconShadows: shadows));

      final iconButton = tester.widget<IconButton>(find.byType(IconButton));
      final icon = iconButton.icon as Icon;

      expect(icon.shadows, equals(shadows));
    });
  });
}

import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/build_context_extensions.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/presentation/widgets/action_buttons/base_action_button.widget.dart';

class RemoteAlbumOption extends StatelessWidget {
  const RemoteAlbumOption({
    super.key,
    this.onAddPhotos,
    this.onDeleteAlbum,
    this.onToggleAlbumOrder,
    this.onEditAlbum,
    this.iconColor,
    this.iconShadows,
  });

  final VoidCallback? onAddPhotos;
  final VoidCallback? onDeleteAlbum;
  final VoidCallback? onToggleAlbumOrder;
  final VoidCallback? onEditAlbum;
  final Color? iconColor;
  final List<Shadow>? iconShadows;

  @override
  Widget build(BuildContext context) {
    final theme = context.themeData;
    final menuChildren = <Widget>[];

    if (onEditAlbum != null) {
      menuChildren.add(
        BaseActionButton(label: context.t.edit_album, iconData: Icons.edit, onPressed: onEditAlbum, menuItem: true),
      );
    }

    if (onAddPhotos != null) {
      menuChildren.add(
        BaseActionButton(
          label: context.t.add_photos,
          iconData: Icons.add_a_photo,
          onPressed: onAddPhotos,
          menuItem: true,
        ),
      );
    }

    if (onToggleAlbumOrder != null) {
      menuChildren.add(
        BaseActionButton(
          label: context.t.change_display_order,
          iconData: Icons.swap_vert_rounded,
          onPressed: onToggleAlbumOrder,
          menuItem: true,
        ),
      );
    }

    if (onDeleteAlbum != null) {
      menuChildren.add(const Divider(height: 1));
      menuChildren.add(
        BaseActionButton(
          label: context.t.delete_album,
          iconData: Icons.delete,
          iconColor: context.isDarkTheme ? Colors.red[400] : Colors.red[800],
          onPressed: onDeleteAlbum,
          menuItem: true,
        ),
      );
    }

    return MenuAnchor(
      consumeOutsideTap: true,
      style: MenuStyle(
        backgroundColor: WidgetStatePropertyAll(theme.scaffoldBackgroundColor),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.grey),
        elevation: const WidgetStatePropertyAll(4),
        shape: const WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.all(Radius.circular(12))),
        ),
        padding: const WidgetStatePropertyAll(EdgeInsets.symmetric(vertical: 6)),
      ),
      menuChildren: [
        ConstrainedBox(
          constraints: const BoxConstraints(minWidth: 150),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: menuChildren,
          ),
        ),
      ],
      builder: (context, controller, child) {
        return IconButton(
          icon: Icon(Icons.more_vert_rounded, color: iconColor ?? Colors.white, shadows: iconShadows),
          onPressed: () => controller.isOpen ? controller.close() : controller.open(),
        );
      },
    );
  }
}

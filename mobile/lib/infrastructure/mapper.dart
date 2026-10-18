import 'package:immich_mobile/data/db/main/table/user/user.drift.dart';
import 'package:immich_mobile/domain/models/user.model.dart';

User mapToUser(UserEntityData data) => User(
  id: data.id,
  name: data.name,
  email: data.email,
  hasProfileImage: data.hasProfileImage,
  profileChangedAt: data.profileChangedAt,
  avatarColor: data.avatarColor,
);

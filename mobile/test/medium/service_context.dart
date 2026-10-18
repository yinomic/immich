import 'package:immich_mobile/infrastructure/repositories/user.repository.dart';

import 'repository_context.dart';

class MediumServiceContext extends MediumRepositoryContext {
  late final UserRepository userRepository = UserRepository(db);
}

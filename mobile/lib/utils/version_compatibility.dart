import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/utils/semver.dart';

String? getVersionCompatibilityMessage({required SemVer serverVersion, required SemVer appVersion}) {
  // Add latest compat info up top

  // NOTE (family fork): ServerInfoNotifier carries 0.0.0 around until
  // GET /api/server/version succeeds. Do not turn that placeholder into an
  // accusation that the server is out of date -- say what actually happened.
  if (serverVersion.major == 0) {
    return StaticTranslations.instance.unable_to_check_version;
  }

  // ensure mobile app major version is not behind server major version
  if (appVersion.major < serverVersion.major) {
    return 'Your mobile app version is not compatible with the server! Please update your mobile app to the latest version.';
  }

  // ensure mobile app major version is not ahead of server major version by more than 1 major version
  if (appVersion.major > serverVersion.major + 1) {
    return 'Your server version is not compatible with the mobile app! Please update your server to the latest version.';
  }

  return null;
}

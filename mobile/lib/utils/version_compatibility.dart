import 'package:immich_mobile/utils/semver.dart';

String? getVersionCompatibilityMessage({required SemVer serverVersion, required SemVer appVersion}) {
  // Add latest compat info up top

  // NOTE (family fork): a server version we could not read is carried around as
  // 0.0.0 by ServerInfoNotifier, which used to make the app accuse a perfectly
  // current server of being out of date. Say nothing instead of guessing.
  if (serverVersion.major == 0) {
    return null;
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

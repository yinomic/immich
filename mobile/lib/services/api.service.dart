import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/network.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/utils/debug_print.dart';
import 'package:immich_mobile/utils/url_helper.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart';

class ApiService {
  final ApiClient _apiClient = ApiClient(basePath: '');

  late UsersApi usersApi;
  late AuthenticationApi authenticationApi;
  late AuthenticationApi oAuthApi;
  late AlbumsApi albumsApi;
  late AssetsApi assetsApi;
  late SearchApi searchApi;
  late ServerApi serverInfoApi;
  // ignore: unused-code
  late MapApi mapApi;
  late SyncApi syncApi;
  // ignore: unused-code
  late SystemConfigApi systemConfigApi;
  // ignore: unused-code
  late DownloadApi downloadApi;
  late TrashApi trashApi;
  late StacksApi stacksApi;
  late ViewsApi viewApi;
  // ignore: unused-code
  late MemoriesApi memoriesApi;
  late SessionsApi sessionsApi;
  late TagsApi tagsApi;

  ApiService() {
    // The below line ensures that the api clients are initialized when the service is instantiated
    // This is required to avoid late initialization errors when the clients are access before the endpoint is resolved
    setEndpoint('');
  }
  final _log = Logger("ApiService");

  Future<void> updateHeaders() async {
    await NetworkRepository.setHeaders(getRequestHeaders(), getServerUrls());
    _apiClient.client = NetworkRepository.client;
  }

  void setEndpoint(String endpoint) {
    _apiClient.basePath = endpoint;
    _apiClient.client = NetworkRepository.client;
    usersApi = UsersApi(_apiClient);
    authenticationApi = AuthenticationApi(_apiClient);
    oAuthApi = AuthenticationApi(_apiClient);
    albumsApi = AlbumsApi(_apiClient);
    assetsApi = AssetsApi(_apiClient);
    serverInfoApi = ServerApi(_apiClient);
    searchApi = SearchApi(_apiClient);
    mapApi = MapApi(_apiClient);
    syncApi = SyncApi(_apiClient);
    systemConfigApi = SystemConfigApi(_apiClient);
    downloadApi = DownloadApi(_apiClient);
    trashApi = TrashApi(_apiClient);
    stacksApi = StacksApi(_apiClient);
    viewApi = ViewsApi(_apiClient);
    memoriesApi = MemoriesApi(_apiClient);
    sessionsApi = SessionsApi(_apiClient);
    tagsApi = TagsApi(_apiClient);
  }

  Future<String> resolveAndSetEndpoint(String serverUrl) async {
    final endpoint = await resolveEndpoint(serverUrl);
    setEndpoint(endpoint);

    // Save in local database for next startup
    await Store.put(StoreKey.serverEndpoint, endpoint);
    return endpoint;
  }

  /// Takes a server URL and attempts to resolve the API endpoint.
  ///
  /// Input: [schema://]host[:port][/path]
  ///  schema - optional (default: https)
  ///  host   - required
  ///  port   - optional (default: based on schema)
  ///  path   - optional
  Future<String> resolveEndpoint(String serverUrl) async {
    String url = normalizeServerUrl(serverUrl);

    // Check for /.well-known/immich
    final wellKnownEndpoint = await _getWellKnownEndpoint(url);
    if (wellKnownEndpoint.isNotEmpty) {
      url = normalizeServerUrl(wellKnownEndpoint);
    }

    // The availability probe talks to <url>/api, so the endpoint that gets used
    // afterwards has to be the same one; returning the bare domain sent every
    // later request to <domain>/auth/login instead of <domain>/api/auth/login.
    final apiUrl = toApiBaseUrl(url);

    if (!await _isEndpointAvailable(url)) {
      throw ApiException(503, "Server is not reachable");
    }

    return apiUrl;
  }

  Future<bool> _isEndpointAvailable(String serverUrl) async {
    final endpoint = toApiBaseUrl(serverUrl);

    try {
      setEndpoint(endpoint);
      await serverInfoApi.pingServer().timeout(const Duration(seconds: 5));
    } on TimeoutException catch (_) {
      return false;
    } on SocketException catch (_) {
      return false;
    } catch (error, stackTrace) {
      _log.severe("Error while checking server availability", error, stackTrace);
      return false;
    }
    return true;
  }

  Future<String> _getWellKnownEndpoint(String baseUrl) async {
    try {
      final res = await NetworkRepository.client
          .get(Uri.parse("$baseUrl/.well-known/immich"))
          .timeout(const Duration(seconds: 5));

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final endpoint = data['api']['endpoint'].toString();

        if (endpoint.startsWith('/')) {
          // Full URL is relative to base
          return "$baseUrl$endpoint";
        }
        return endpoint;
      }
    } catch (e) {
      dPrint(() => "Could not locate /.well-known/immich at $baseUrl");
    }

    return "";
  }

  /// HTTP header values have to be printable ASCII. Some Android builds report
  /// a device model with non-ASCII characters (for example "小米 14"), and a
  /// value like that makes *every* later request fail locally with
  /// "FormatException: Invalid HTTP header field value" before it is even sent.
  static String _headerSafe(String value) {
    final cleaned = value.replaceAll(RegExp(r'[^\x20-\x7E]'), '').trim();
    return cleaned.isEmpty ? 'Unknown' : cleaned;
  }

  Future<void> setDeviceInfoHeader() async {
    final DeviceInfoPlugin deviceInfoPlugin = DeviceInfoPlugin();

    if (Platform.isIOS) {
      final iosInfo = await deviceInfoPlugin.iosInfo;
      final model = _headerSafe(iosInfo.utsname.machine);
      authenticationApi.apiClient.addDefaultHeader('deviceModel', model);
      authenticationApi.apiClient.addDefaultHeader('deviceType', 'iOS');
      _log.info('Reported device: iOS $model');
    } else if (Platform.isAndroid) {
      final androidInfo = await deviceInfoPlugin.androidInfo;
      final model = _headerSafe(androidInfo.model);
      authenticationApi.apiClient.addDefaultHeader('deviceModel', model);
      authenticationApi.apiClient.addDefaultHeader('deviceType', 'Android');
      _log.info('Reported device: Android $model (raw "${androidInfo.model}")');
    } else {
      authenticationApi.apiClient.addDefaultHeader('deviceModel', 'Unknown');
      authenticationApi.apiClient.addDefaultHeader('deviceType', 'Unknown');
    }
  }

  static List<String> getServerUrls() {
    final urls = <String>[];
    final serverEndpoint = Store.tryGet(StoreKey.serverEndpoint);
    if (serverEndpoint != null && serverEndpoint.isNotEmpty) {
      urls.add(serverEndpoint);
    }
    final network = SettingsRepository.instance.appConfig.network;
    final localEndpoint = network.localEndpoint;
    if (localEndpoint != null && localEndpoint.isNotEmpty) {
      urls.add(localEndpoint);
    }
    for (final url in network.externalEndpointList) {
      if (url.isNotEmpty) {
        urls.add(url);
      }
    }
    return urls;
  }

  static Map<String, String> getRequestHeaders() {
    return SettingsRepository.instance.appConfig.network.customHeaders;
  }

  ApiClient get apiClient => _apiClient;
}

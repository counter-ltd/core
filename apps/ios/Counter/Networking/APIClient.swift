/**
 The central HTTP client for all Counter API calls.

 Every call goes through `request(_:)` which handles JSON encoding/decoding,
 auth header injection, and the 401 -> refresh -> retry cycle. The return type
 is `APIResult<T>` which never throws, so callers just switch on success/error.

 `APIClient` is an actor to serialise access to mutable state (the base URL
 and the reference to `TokenRefreshActor`). URLSession calls are still fully
 concurrent inside the actor because they suspend on the network, not a lock.
 */

import Foundation

actor APIClient {

    // MARK: - Configuration

    /// Production base URL. Overridden in debug builds via the DEBUG_API_URL
    /// environment variable so you can point at localhost without rebuilding.
    static var baseURL: URL {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["DEBUG_API_URL"],
           let url = URL(string: override) {
            return url
        }
        #endif
        return URL(string: "https://api.counter.ltd")!
    }

    private let session: URLSession
    private let authStore: AuthStore
    private let refreshActor: TokenRefreshActor

    init(authStore: AuthStore) {
        self.authStore = authStore
        self.refreshActor = TokenRefreshActor(authStore: authStore)
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config)
    }

    // MARK: - Main request entry point

    /// Executes an API call, returning a typed result. Never throws.
    ///
    /// On a 401 the client attempts a token refresh exactly once and retries
    /// the original request. If the refresh fails it clears the session and
    /// returns the 401 error so the UI can redirect to login.
    func request<T: Decodable & Sendable>(_ endpoint: Endpoint) async -> APIResult<T> {
        let result: APIResult<T> = await perform(endpoint)

        // Retry once after a successful token refresh.
        if result.errorStatus == 401, endpoint.requiresAuth {
            let refreshed = await refreshActor.refresh()
            guard refreshed else { return result }
            return await perform(endpoint)
        }

        return result
    }

    /// Variant for endpoints that return no body (204 No Content).
    func requestEmpty(_ endpoint: Endpoint) async -> APIResult<Empty> {
        await request(endpoint)
    }

    // MARK: - Internal

    private func perform<T: Decodable & Sendable>(_ endpoint: Endpoint) async -> APIResult<T> {
        guard var components = URLComponents(
            url: Self.baseURL.appendingPathComponent(endpoint.path),
            resolvingAgainstBaseURL: false
        ) else {
            return .networkError(.unexpectedStatus(0))
        }

        if !endpoint.queryItems.isEmpty {
            components.queryItems = endpoint.queryItems
        }

        guard let url = components.url else {
            return .networkError(.unexpectedStatus(0))
        }

        var req = URLRequest(url: url)
        req.httpMethod = endpoint.method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Counter-iOS/1.0", forHTTPHeaderField: "User-Agent")

        // Always send the token when available — public endpoints use it for
        // viewer context (isFollowing, isSelf) when present. requiresAuth only
        // gates the 401-retry path, not token injection.
        if let token = authStore.accessToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body = endpoint.bodyData {
            req.httpBody = body
        }

        let data: Data
        let response: URLResponse

        do {
            (data, response) = try await session.data(for: req)
        } catch let urlError as URLError where urlError.code == .notConnectedToInternet
                                              || urlError.code == .networkConnectionLost {
            return .networkError(.unreachable)
        } catch {
            return .networkError(.unknown(error))
        }

        guard let http = response as? HTTPURLResponse else {
            return .networkError(.unexpectedStatus(0))
        }

        // 204 No Content: nothing to decode.
        if http.statusCode == 204 {
            if let empty = Empty() as? T {
                return .success(empty)
            }
        }

        // 4xx / 5xx: try to parse the error envelope.
        guard (200..<300).contains(http.statusCode) else {
            if let apiError = parseAPIError(data: data, status: http.statusCode) {
                return .apiError(apiError)
            }
            return .networkError(.unexpectedStatus(http.statusCode))
        }

        do {
            let decoded = try Self.decoder.decode(T.self, from: data)
            return .success(decoded)
        } catch {
            return .networkError(.decodingFailed(error))
        }
    }

    // MARK: - JSON decoder

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        // The API returns camelCase, so no key strategy needed.
        // Custom date decoding handles fractional-second ISO 8601.
        d.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            if let date = parseISO(string) { return date }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot parse date: \(string)"
            )
        }
        return d
    }()
}

// MARK: - Empty response sentinel

/// Placeholder for 204 No Content responses so the generic stays satisfied.
struct Empty: Decodable, Sendable {
    init?() {}
    init(from decoder: Decoder) throws {}
}

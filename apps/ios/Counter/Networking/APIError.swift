/**
 API and network error types.

 `APIError` is what the server returns in its `{ error: { code, message } }`
 envelope. `NetworkError` covers transport-level failures (no connection,
 bad JSON, unexpected status codes) and wraps them in the same result type
 so callers only handle one error type.
 */

import Foundation

// MARK: - Server error

/// A structured error returned by the Counter API.
struct APIError: Error, Decodable, Sendable {
    let status: Int
    let code: String
    let message: String
}

// MARK: - Network / client error

/// Transport-level failure or unexpected response shape.
enum NetworkError: Error, Sendable {
    /// No internet connection or DNS failure.
    case unreachable
    /// The server returned a non-2xx status with no parseable error body.
    case unexpectedStatus(Int)
    /// Response body couldn't be decoded into the expected type.
    case decodingFailed(Error)
    /// Something truly unexpected happened.
    case unknown(Error)
}

// MARK: - Unified result

/// The result type returned by every `APIClient` call. Never throws.
enum APIResult<T: Sendable>: Sendable {
    case success(T)
    /// A structured error from the server (4xx, 5xx with JSON body).
    case apiError(APIError)
    /// A transport-level or decoding failure.
    case networkError(NetworkError)

    var value: T? {
        if case .success(let v) = self { return v }
        return nil
    }

    /// The HTTP status from a server error, or nil for network errors.
    var errorStatus: Int? {
        if case .apiError(let e) = self { return e.status }
        return nil
    }

    /// User-facing error string, safe to show in an alert.
    var errorMessage: String {
        switch self {
        case .success:
            return ""
        case .apiError(let e):
            return e.message
        case .networkError(let e):
            switch e {
            case .unreachable:
                return "No internet connection."
            case .unexpectedStatus(let s):
                return "Unexpected response (\(s))."
            case .decodingFailed(let e):
                return e.localizedDescription
            case .unknown(let e):
                return e.localizedDescription
            }
        }
    }
}

// MARK: - Server error envelope

/// The raw JSON wrapper the API sends: `{ "error": { "code": "...", "message": "..." } }`.
private struct ErrorEnvelope: Decodable {
    struct Inner: Decodable {
        let code: String
        let message: String
    }
    let error: Inner
}

/// Tries to parse a server error body. Returns nil if the body isn't the
/// expected envelope (e.g. an HTML error page from a proxy).
func parseAPIError(data: Data, status: Int) -> APIError? {
    guard let envelope = try? JSONDecoder().decode(ErrorEnvelope.self, from: data) else {
        return nil
    }
    return APIError(status: status, code: envelope.error.code, message: envelope.error.message)
}

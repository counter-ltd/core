/**
 Auth request and response models.

 These mirror the types in packages/types/src/auth.ts. The access token is
 short-lived (~1 hour); the refresh token is long-lived (~7 days) and stored
 only in the Keychain, never passed to SwiftUI state.
 */

// MARK: - Responses

struct TokenPair: Decodable, Sendable {
    let accessToken: String
    let refreshToken: String
    /// Seconds until the access token expires.
    let expiresIn: Int
}

struct AuthResponse: Decodable, Sendable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int
    let user: PrivateUser
}

// MARK: - Requests

struct LoginInput: Encodable, Sendable {
    /// Username or email address.
    let identifier: String
    let password: String
}

struct RegisterInput: Encodable, Sendable {
    let username: String
    let email: String
    let password: String
    let displayName: String?
}

struct RefreshInput: Encodable, Sendable {
    let refreshToken: String
}

struct LogoutInput: Encodable, Sendable {
    let refreshToken: String?
}

/// Body for POST /auth/password: set or change the signed-in user's password.
struct SetPasswordInput: Encodable, Sendable {
    /// Omitted entirely when the account has no password yet. The API's schema
    /// treats the field as optional-or-absent, so a null would fail validation;
    /// encode the key only when there's a value.
    let currentPassword: String?
    let newPassword: String

    enum CodingKeys: String, CodingKey {
        case currentPassword, newPassword
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(newPassword, forKey: .newPassword)
        if let currentPassword { try c.encode(currentPassword, forKey: .currentPassword) }
    }
}

// MARK: - OAuth

/// The two OAuth providers Counter supports.
enum OAuthProvider: String, Codable, CaseIterable, Sendable {
    case github
    case discord

    var displayName: String {
        switch self {
        case .github: return "GitHub"
        case .discord: return "Discord"
        }
    }
}

/// Connected provider account info, returned by GET /auth/:provider/me.
struct OAuthConnectedAccount: Decodable, Sendable {
    let provider: OAuthProvider
    let providerUsername: String?
    let providerEmail: String?
    let connectedAt: String
}

/// Response from POST /auth/:provider/connect/prepare.
struct OAuthConnectPrepareResponse: Decodable, Sendable {
    let authUrl: String
}

/// Body for POST /auth/:provider/connect/prepare.
struct OAuthConnectPrepareInput: Encodable, Sendable {
    let mobile: Bool
}

/// Body for POST /auth/session/exchange.
struct OAuthSessionExchangeInput: Encodable, Sendable {
    let code: String
}

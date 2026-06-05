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

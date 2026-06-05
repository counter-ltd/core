/**
 User models: public profiles and the private self-profile.

 Mirrors packages/types/src/user.ts. `PublicUser` is what you see on other
 people's profiles; `PrivateUser` adds email and is only returned for the
 authenticated user's own account.
 */

// MARK: - Public profile

struct PublicUser: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let username: String
    let displayName: String?
    let bio: String?
    let avatarUrl: String?
    /// True if the user has verified their email (earns a ✦ badge).
    let verified: Bool
    let createdAt: String
    let counts: UserCounts
    let signals: [TrustBadge]?
    /// Populated when the request is authenticated.
    let viewer: ViewerRelationship?
    /// Online status and last-seen; nil when disabled or not visible to this viewer.
    let presence: UserPresence?
}

/// Online status visible to a viewer, subject to the profile owner's settings.
struct UserPresence: Decodable, Hashable, Sendable {
    let isOnline: Bool
    /// ISO 8601 timestamp of the last heartbeat; nil when lastSeen is hidden.
    let lastSeenAt: String?
}

struct UserCounts: Decodable, Hashable, Sendable {
    let posts: Int
    let followers: Int
    let following: Int
}

struct ViewerRelationship: Decodable, Hashable, Sendable {
    let isFollowing: Bool
    let isSelf: Bool
}

struct TrustBadge: Decodable, Hashable, Sendable {
    let kind: String
    let label: String
    let detail: String?
    let href: String?
}

// MARK: - Private profile (own account only)

struct PrivateUser: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let username: String
    let displayName: String?
    let bio: String?
    let avatarUrl: String?
    let verified: Bool
    let email: String
    let createdAt: String
    let counts: UserCounts
    let signals: [TrustBadge]?
    let viewer: ViewerRelationship?
    let presenceSettings: PresenceSettings
}

// MARK: - Update request

struct UpdateProfileInput: Encodable, Sendable {
    let displayName: String?
    let bio: String?
    let avatarUrl: String?
}

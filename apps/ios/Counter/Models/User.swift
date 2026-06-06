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
    /// The platform key (e.g. "github", "discord") for icon rendering; nil for non-platform badges.
    let platform: String?
}

// MARK: - Platform integrations (badges)

/// A linked external account as returned by GET /integrations/me.
struct Integration: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let platform: String
    /// The username on the linked platform.
    let username: String?
    let url: String?
    let verified: Bool
    /// Whether the user has chosen to show this badge on their public profile.
    let displayed: Bool
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
    /// False for OAuth-only accounts that have never set a password. Drives the
    /// "set a password" vs "change password" copy in security settings.
    let hasPassword: Bool
    let createdAt: String
    let counts: UserCounts
    let signals: [TrustBadge]?
    let viewer: ViewerRelationship?
    let presenceSettings: PresenceSettings
    /// The groups this account holds. Empty for a normal user.
    let groups: [GroupSummary]
    /// Effective admin permissions (the union across `groups`), as raw keys so an
    /// unknown one from a newer server build can't break decoding.
    let permissions: [String]
    /// Moderation state. 'active' for anyone who can reach the app.
    let status: String

    /// True when the account holds any admin permission, so the UI can decide
    /// whether to surface the panel entry without inspecting individual keys.
    var isAdmin: Bool { !permissions.isEmpty }

    /// True when the account holds a specific permission.
    func can(_ p: Permission) -> Bool { permissions.contains(p.rawValue) }
}

// MARK: - Update requests

/// Body for PATCH /integrations/:id.
struct PatchIntegrationInput: Encodable, Sendable {
    let displayed: Bool
}

/// How a profile save should treat the avatar. `keep` omits the field entirely
/// so an untouched avatar survives the save; `set`/`clear` map to an object id
/// or an explicit null, matching the API's partial `avatarObjectId`.
enum AvatarChange: Sendable {
    case keep
    case set(String)
    case clear
}

struct UpdateProfileInput: Encodable, Sendable {
    let displayName: String?
    let bio: String?
    let avatar: AvatarChange

    enum CodingKeys: String, CodingKey {
        case displayName, bio, avatarObjectId
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(displayName, forKey: .displayName)
        try c.encode(bio, forKey: .bio)
        // Only touch the avatar when the user actually changed it: encoding the
        // key (even as null) tells the API to set it, which would wipe an
        // unchanged avatar on every profile save.
        switch avatar {
        case .keep:
            break
        case .set(let objectId):
            try c.encode(objectId, forKey: .avatarObjectId)
        case .clear:
            try c.encodeNil(forKey: .avatarObjectId)
        }
    }
}

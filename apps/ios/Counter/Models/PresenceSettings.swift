/**
 Presence settings: online status and last-seen toggles, visibility options,
 and the heartbeat interval.

 Mirrors PresenceSettings in packages/types/src/user.ts. Both features are
 off by default. Each has its own visibility that controls who can see it.
 The heartbeat interval drives how often the client calls POST /users/me/heartbeat
 and how long the server waits before marking you offline.
 */

// MARK: - Settings model

struct PresenceSettings: Codable, Hashable, Sendable {
    var onlineStatusEnabled: Bool
    var onlineStatusVisibility: PresenceVisibility
    var lastSeenEnabled: Bool
    var lastSeenVisibility: PresenceVisibility
    /// Seconds between heartbeat calls; also the server's online-detection window.
    var heartbeatIntervalSeconds: Int

    /// Safe defaults that match the server's column defaults: everything off.
    static let defaultSettings = PresenceSettings(
        onlineStatusEnabled: false,
        onlineStatusVisibility: .everyone,
        lastSeenEnabled: false,
        lastSeenVisibility: .everyone,
        heartbeatIntervalSeconds: 300
    )
}

// MARK: - Visibility

/// Who can see a presence field. Mirrors PRESENCE.VISIBILITY_OPTIONS in constants.ts.
enum PresenceVisibility: String, Codable, CaseIterable, Sendable {
    case everyone
    case followers
    case mutualFollowers

    var label: String {
        switch self {
        case .everyone: return "Everyone"
        case .followers: return "Followers"
        case .mutualFollowers: return "Followers I follow"
        }
    }
}

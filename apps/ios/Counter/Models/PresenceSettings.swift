/**
 Presence and messaging-privacy settings.

 Mirrors PresenceSettings in packages/types/src/user.ts. Both presence features
 are off by default. Each has its own visibility that controls who can see it.
 The heartbeat interval drives how often the client calls POST /users/me/heartbeat
 and how long the server waits before marking you offline.

 `messagingPrivacy` controls who can start a new conversation. It defaults to
 everyone. When set to followers, anyone outside that group can still send one
 message request that the user can accept or decline.
 */

// MARK: - Settings model

struct PresenceSettings: Codable, Hashable, Sendable {
    var onlineStatusEnabled: Bool
    var onlineStatusVisibility: PresenceVisibility
    var lastSeenEnabled: Bool
    var lastSeenVisibility: PresenceVisibility
    /// Seconds between heartbeat calls; also the server's online-detection window.
    var heartbeatIntervalSeconds: Int
    /// Controls who can start a new direct-message conversation.
    var messagingPrivacy: MessagingPrivacy
    /// When on, this user's typing is shown to whoever they're chatting with.
    var typingIndicatorsEnabled: Bool

    /// Safe defaults: presence off, and typing off until the real value loads so
    /// we never imply typing is broadcast when we can't confirm it. The server's
    /// own default for typing is on.
    static let defaultSettings = PresenceSettings(
        onlineStatusEnabled: false,
        onlineStatusVisibility: .everyone,
        lastSeenEnabled: false,
        lastSeenVisibility: .everyone,
        heartbeatIntervalSeconds: 300,
        messagingPrivacy: .everyone,
        typingIndicatorsEnabled: false
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

// MARK: - Messaging privacy

/// Who can start a direct-message conversation. Mirrors MESSAGING.PRIVACY_OPTIONS in constants.ts.
enum MessagingPrivacy: String, Codable, CaseIterable, Sendable {
    case everyone
    case followers
    case nobody

    var label: String {
        switch self {
        case .everyone:  return "Everyone"
        case .followers: return "My followers only"
        case .nobody:    return "No one"
        }
    }

    var footerText: String {
        switch self {
        case .everyone:
            return "Anyone can message you directly."
        case .followers:
            return "Only your followers can message you directly. Everyone else can send one message request, which you can accept or decline."
        case .nobody:
            return "No one can message you or send you requests."
        }
    }
}

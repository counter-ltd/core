/**
 Notification model for the activity inbox.

 Named `AppNotification` to avoid shadowing `Foundation.Notification`.
 Mirrors packages/types/src/social.ts.
 */

// MARK: - Notification

struct AppNotification: Decodable, Identifiable, Sendable {
    let id: String
    let type: NotificationType
    /// The user who performed the action (liked, reposted, followed, etc.).
    let actor: PublicUser
    /// The post involved, if any. Nil for follows and messages.
    let post: Post?
    /// The conversation involved. Set only for `message`, so a tap opens the thread.
    let conversation: ConversationRef?
    let read: Bool
    let createdAt: String
}

/// Just enough of a conversation to deep-link a message notification: its id and
/// the partner (the other participant). Mirrors ConversationRef in social.ts.
struct ConversationRef: Decodable, Sendable {
    let id: String
    let partner: PublicUser
}

enum NotificationType: String, Decodable, Sendable {
    case like
    case repost
    case reply
    case follow
    case mention
    case message
}

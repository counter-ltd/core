/**
 Direct message models: individual messages and conversation previews.

 Mirrors packages/types/src/messages.ts. Conversations are identified by the
 pair of participants (stored in lexicographic order server-side, so there's
 exactly one conversation per pair). The inbox shows `Conversation` previews;
 opening one loads `DirectMessage` items.

 A conversation can be in one of two states: active (normal two-way chat) or
 request (sender waiting for recipient to accept before either side can send more).
 */

// MARK: - Inbox

/// Whether a conversation is a normal exchange or a pending message request.
enum ConversationStatus: String, Decodable, Sendable {
    case active
    case request
}

/// One conversation as shown in the inbox list.
struct Conversation: Decodable, Identifiable, Sendable {
    let id: String
    /// The other participant from the viewer's perspective.
    let partner: PublicUser
    let lastMessage: DirectMessage?
    let unreadCount: Int
    let lastMessageAt: String
    let status: ConversationStatus
    /// True when the viewer is the recipient of a pending request (can accept or decline).
    let isInboundRequest: Bool
}

/// Lightweight status for a single conversation thread, returned by GET /messages/:username/info.
struct ConversationInfo: Decodable, Sendable {
    /// Nil when no conversation exists between these two users yet.
    let status: ConversationStatus?
    /// True when the viewer is the recipient of a pending request.
    let isInboundRequest: Bool
}

// MARK: - Thread

/// Whether a message entry is a real message or a system event.
enum MessageKind: String, Decodable, Sendable {
    case message
    /// Recorded automatically when the viewer screenshots the thread.
    case screenshot
    /// Inserted when a participant clears their chat history (per-user).
    case cleared
    /// Inserted when a participant deletes the conversation (per-user).
    case deleted
    /// Marks the start of a Tunnel Talk session in the conversation thread.
    case tunnelStarted = "tunnel_started"
    /// Marks the end of a Tunnel Talk session in the conversation thread.
    case tunnelEnded = "tunnel_ended"
}

struct DirectMessage: Decodable, Identifiable, Sendable {
    let id: String
    let sender: PublicUser
    /**
     When true, `body` is the raw ciphertext from the server (v2: single-device
     or v3: multi-device format). The client finds the copy for its device and
     decrypts locally. When false the server already returned plaintext.
     Empty string for `screenshot` entries.
     */
    let body: String
    let read: Bool
    /// True when body holds E2EE ciphertext that the client must decrypt.
    let encrypted: Bool
    let kind: MessageKind
    /// Non-nil for `tunnelStarted` and `tunnelEnded` messages. Links the marker
    /// to a `TunnelSession` so the thread view can look up and display the transcript.
    let tunnelSessionId: String?
    let createdAt: String
}

// MARK: - Send request

struct SendMessageInput: Encodable, Sendable {
    let body: String
}

// MARK: - Device key types

/// One registered P-256 key for a specific device. A user can have many.
struct DeviceKeyEntry: Decodable, Sendable {
    /// Stable UUID generated on the device; used to find the matching copy when decrypting.
    let deviceId: String
    /// SPKI base64-encoded P-256 public key.
    let publicKey: String
}

/// Response shape for GET /users/:username/public-key and GET /auth/keys.
struct UserDeviceKeysResponse: Decodable, Sendable {
    let keys: [DeviceKeyEntry]
}

// MARK: - Tunnel Talk

/// A Tunnel Talk P2P session between two users.
struct TunnelSession: Decodable, Identifiable, Sendable {
    let id: String
    let conversationId: String
    let initiator: PublicUser
    let participant: PublicUser
    /// Lifecycle state. Flows: pending -> active -> ended, or pending -> declined.
    let status: TunnelSessionStatus
    /// Whether the initiator has opted in to saving the transcript.
    let initiatorConsent: Bool
    /// Whether the participant has opted in to saving the transcript.
    let participantConsent: Bool
    /// When the WebRTC data channel opened. Nil until both peers connect.
    let startedAt: String?
    /// When either peer ended the session. Nil while active.
    let endedAt: String?
    let createdAt: String
}

enum TunnelSessionStatus: String, Decodable, Sendable {
    case pending
    case active
    case ended
    case declined
}

/// One message from an uploaded Tunnel Talk transcript.
struct TunnelMessage: Decodable, Identifiable, Sendable {
    let id: String
    let sender: PublicUser
    /// E2EE ciphertext in v2 or v3 format, same as DirectMessage.body.
    let body: String
    /// When the message was sent P2P, not when it was uploaded.
    let sentAt: String
}

/// A session with its uploaded transcript, used to render inline blocks in the thread.
struct TunnelSessionWithTranscript: Decodable, Identifiable, Sendable {
    let id: String
    let conversationId: String
    let initiator: PublicUser
    let participant: PublicUser
    let status: TunnelSessionStatus
    let initiatorConsent: Bool
    let participantConsent: Bool
    let startedAt: String?
    let endedAt: String?
    let createdAt: String
    /// Transcript messages in chronological order. Empty when nothing was saved.
    let messages: [TunnelMessage]
}

/// Body for uploading a Tunnel Talk transcript after the session ends.
struct UploadTranscriptInput: Encodable, Sendable {
    let messages: [TranscriptEntry]
}

/// One entry in a transcript upload batch.
struct TranscriptEntry: Encodable, Sendable {
    let body: String
    /// ISO 8601 timestamp from when the message was sent P2P.
    let sentAt: String
}

/// Response from GET /tunnel/turn-credentials.
struct TurnCredentials: Decodable, Sendable {
    let urls: [String]
    let username: String
    let credential: String
}

// MARK: - Key registration

/// Body for POST /auth/keys.
struct RegisterPublicKeyInput: Encodable, Sendable {
    let deviceId: String
    let publicKey: String
}

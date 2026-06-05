/**
 Direct message models: individual messages and conversation previews.

 Mirrors packages/types/src/messages.ts. Conversations are identified by the
 pair of participants (stored in lexicographic order server-side, so there's
 exactly one conversation per pair). The inbox shows `Conversation` previews;
 opening one loads `DirectMessage` items.
 */

// MARK: - Inbox

/// One conversation as shown in the inbox list.
struct Conversation: Decodable, Identifiable, Sendable {
    let id: String
    /// The other participant from the viewer's perspective.
    let partner: PublicUser
    let lastMessage: DirectMessage?
    let unreadCount: Int
    let lastMessageAt: String
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

// MARK: - Key registration

/// Body for POST /auth/keys.
struct RegisterPublicKeyInput: Encodable, Sendable {
    let deviceId: String
    let publicKey: String
}

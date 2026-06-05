/**
 Per-type notification toggles, push-device registration, and the device list
 returned by GET /devices.

 Mirrors NotificationPreferences, registerDeviceSchema, and DeviceRecord in
 packages/types/src/social.ts. Each toggle is on by default server-side, so a
 value of true means "send me this type" across the inbox and push.
 */

// MARK: - Preferences

struct NotificationPreferences: Codable, Sendable {
    var like: Bool
    var repost: Bool
    var reply: Bool
    var follow: Bool
    var mention: Bool
    var message: Bool

    /// All types on, the default a fresh account gets and the fallback when the
    /// fetch fails so the settings screen still renders sensible toggles.
    static let allOn = NotificationPreferences(
        like: true, repost: true, reply: true, follow: true, mention: true, message: true
    )
}

// MARK: - Device registration

struct RegisterDeviceInput: Encodable, Sendable {
    /// Opaque APNs device token, hex-encoded.
    let token: String
    /// Always "ios" from this client; the API validates against DEVICE_PLATFORMS.
    let platform: String
    /// Human-readable label shown in the Privacy settings panel.
    let name: String?
}

/// Response from POST /devices. The id lets the client cache which device is
/// "this device" so the Privacy panel can highlight it.
struct RegisterDeviceResponse: Decodable, Sendable {
    let ok: Bool
    let id: String
}

// MARK: - Device list

/// One registered device from GET /devices. The raw APNs token is not included
/// in this response; deletions go through the device id instead.
struct DeviceRecord: Identifiable, Decodable, Sendable {
    let id: String
    let platform: String
    /// Nil for devices registered before the name field was added.
    let name: String?
    let createdAt: String
    let lastSeenAt: String
}

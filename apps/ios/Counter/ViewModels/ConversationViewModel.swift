/**
 View model for a single E2EE conversation thread.

 Loads messages newest-first from the API, reverses them for display, and
 decrypts any `encrypted == true` bodies using the local P-256 private key.
 Outgoing messages are encrypted for every registered device on both sides
 (v3 format) before the send request leaves the device.

 On first load the view model sets up the local key pair: if none exists in
 the Keychain a new one is generated and registered with POST /auth/keys so
 other users can encrypt messages for this account. Own device keys are also
 fetched so the sender's other devices receive copies of sent messages.
 */

import Foundation
import CryptoKit
import Observation

@Observable
final class ConversationViewModel {

    private(set) var messages: [DirectMessage] = []
    private(set) var isLoading: Bool = false
    private(set) var isSending: Bool = false
    private(set) var hasMore: Bool = true
    var draftBody: String = ""
    var errorMessage: String?

    /// nil = not yet fetched; empty array = partner has no registered devices.
    private(set) var partnerDeviceKeys: [DeviceKeyEntry]?
    /// Partner's public profile, loaded alongside messages for presence data.
    private(set) var partnerProfile: PublicUser?

    /// The authenticated user's own registered device keys, fetched from /auth/keys.
    private(set) var myDeviceKeys: [DeviceKeyEntry] = []

    /// True when at least one party has no registered device keys, so messages
    /// fall back to server-side AES encryption instead of on-device E2EE.
    var isServerEncryptedFallback: Bool {
        (partnerDeviceKeys ?? []).isEmpty || myDeviceKeys.isEmpty
    }

    /// True when E2EE is active but only this device is registered. Other
    /// Counter sessions the user opens won't receive copies until they register.
    var hasSingleDeviceWarning: Bool {
        !isServerEncryptedFallback && myDeviceKeys.count <= 1
    }

    private var cursor: String?
    let partnerUsername: String
    private let env: AppEnvironment

    /// The UUID identifying this device, set after key setup. Used by the UI to
    /// label the current device in the encryption popover.
    private(set) var currentDeviceId: String?

    // Cached after Keychain load so we don't pay the round-trip per send.
    private var cachedPrivateKey: P256.KeyAgreement.PrivateKey?
    private var cachedPublicKeyB64: String?

    init(partnerUsername: String, env: AppEnvironment) {
        self.partnerUsername = partnerUsername
        self.env = env
    }

    // MARK: - Load

    func loadInitial() async {
        isLoading = true
        defer { isLoading = false }
        cursor = nil

        // All five run concurrently: Keychain access and the four network fetches.
        let setupTask = Task { await self.setupLocalKeyPair() }
        async let msgResult: APIResult<Page<DirectMessage>> = env.apiClient.request(
            .conversation(username: partnerUsername)
        )
        async let partnerKeyResult: APIResult<UserDeviceKeysResponse> = env.apiClient.request(
            .userPublicKey(username: partnerUsername)
        )
        async let myKeyResult: APIResult<UserDeviceKeysResponse> = env.apiClient.request(
            .authDeviceKeys
        )
        // Partner profile gives us presence data for the conversation header.
        async let profileResult: APIResult<PublicUser> = env.apiClient.request(
            .userProfile(username: partnerUsername)
        )

        let (msgs, partnerKey, myKey, profile) = await (msgResult, partnerKeyResult, myKeyResult, profileResult)
        await setupTask.value

        if case .success(let resp) = partnerKey {
            partnerDeviceKeys = resp.keys
        }
        if case .success(let resp) = myKey {
            myDeviceKeys = resp.keys
        }
        if case .success(let user) = profile {
            partnerProfile = user
        }

        // If GET /auth/keys returned before setupLocalKeyPair finished
        // registering, the current device won't be in myDeviceKeys yet.
        // Add it directly so the send path can include it immediately.
        if let did = currentDeviceId, let pub = cachedPublicKeyB64,
           !myDeviceKeys.contains(where: { $0.deviceId == did }) {
            myDeviceKeys.append(DeviceKeyEntry(deviceId: did, publicKey: pub))
        }

        if case .success(let page) = msgs {
            let decrypted = decryptAll(page.data)
            messages = decrypted.reversed()
            cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        } else {
            errorMessage = msgs.errorMessage
        }
    }

    func loadOlder() async {
        guard hasMore, !isLoading, let cursor else { return }
        isLoading = true
        defer { isLoading = false }

        let result: APIResult<Page<DirectMessage>> = await env.apiClient.request(
            .conversation(username: partnerUsername, after: cursor)
        )
        if case .success(let page) = result {
            let decrypted = decryptAll(page.data)
            messages.insert(contentsOf: decrypted.reversed(), at: 0)
            self.cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        }
    }

    // MARK: - Send

    func send() async {
        let body = draftBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !isSending else { return }

        isSending = true
        defer { isSending = false }
        draftBody = ""

        let messageBody: String
        let targets = partnerDeviceKeys ?? []

        if targets.isEmpty {
            // Fallback path: partner has no device keys. Send plaintext so the
            // server can encrypt it with AES before storing. Both sides see a
            // notice in the UI. Plaintext is never written to the database.
            messageBody = body
        } else {
            // E2EE path: encrypt for every registered device on both sides.
            // Always include the current device in the sender list even if the
            // server data hasn't reflected the registration yet.
            var senderKeys = myDeviceKeys
            if let did = currentDeviceId, let pub = cachedPublicKeyB64 {
                let currentDevice = DeviceKeyEntry(deviceId: did, publicKey: pub)
                if !senderKeys.contains(where: { $0.deviceId == did }) {
                    senderKeys.insert(currentDevice, at: 0)
                }
            }
            do {
                messageBody = try E2EEService.shared.encryptForDevices(
                    plaintext: body,
                    recipientKeys: targets,
                    senderKeys: senderKeys
                )
            } catch {
                draftBody = body
                errorMessage = "Encryption failed — please try again."
                return
            }
        }

        let result: APIResult<DirectMessage> = await env.apiClient.request(
            .sendMessage(username: partnerUsername, body: messageBody)
        )
        switch result {
        case .success(let msg):
            messages.append(msg)
        case .apiError(let e):
            draftBody = body
            errorMessage = e.message
        case .networkError:
            draftBody = body
            errorMessage = result.errorMessage
        }
    }

    // MARK: - Mark read

    /// Fires `POST /messages/:username/read` to acknowledge the partner's messages.
    func markRead() async {
        _ = await env.apiClient.requestEmpty(.markConversationRead(username: partnerUsername))
    }

    // MARK: - Clear / delete

    /// Clears the caller's view of the conversation. The server stamps a clearedAt
    /// timestamp and returns the 'cleared' system message as the new thread start.
    func clearChat() async {
        let result: APIResult<DirectMessage> = await env.apiClient.request(
            .clearConversation(username: partnerUsername)
        )
        if case .success(let event) = result {
            // Replace the thread with just the cleared event; the server will
            // filter older messages from future loads too.
            messages = [event]
        }
    }

    /// Stamps a deletedAt for this user; the conversation disappears from their
    /// inbox. The caller is responsible for dismissing the view after this returns.
    func deleteChat() async {
        _ = await env.apiClient.requestEmpty(.deleteConversation(username: partnerUsername))
    }

    // MARK: - Private

    private func setupLocalKeyPair() async {
        do {
            let (key, deviceId, isNew) = try E2EEService.shared.loadOrGenerateKeyPair()
            cachedPrivateKey = key
            currentDeviceId = deviceId
            cachedPublicKeyB64 = E2EEService.shared.exportPublicKey(key)
            if isNew {
                // Fire and forget: registration failure is non-fatal for sending
                // (we can encrypt for others), but means others can't encrypt for
                // us until the key is registered on the next successful load.
                _ = await env.apiClient.requestEmpty(
                    .registerPublicKey(deviceId: deviceId, publicKey: cachedPublicKeyB64!)
                )
            }
        } catch {
            // Key setup failures are non-fatal for reading; send will surface
            // a clear error if attempted without a loaded key.
        }
    }

    // MARK: - Screenshot

    /// Reports a screenshot to the server so both parties see it in the transcript.
    /// Fire-and-forget from the view; failures are silently dropped because the
    /// screenshot already happened whether or not the network call succeeds.
    func reportScreenshot() async {
        let result: APIResult<DirectMessage> = await env.apiClient.request(
            .reportScreenshot(username: partnerUsername)
        )
        if case .success(let event) = result {
            messages.append(event)
        }
    }

    // MARK: - Private

    private func decryptAll(_ batch: [DirectMessage]) -> [DirectMessage] {
        guard let pk = cachedPrivateKey, let did = currentDeviceId else { return batch }
        return batch.map { msg in
            // Screenshot events have no body to decrypt.
            guard msg.encrypted else { return msg }
            do {
                let plain = try E2EEService.shared.decrypt(
                    ciphertext: msg.body,
                    privateKey: pk,
                    myDeviceId: did
                )
                return DirectMessage(
                    id: msg.id, sender: msg.sender, body: plain,
                    read: msg.read, encrypted: false, kind: msg.kind, createdAt: msg.createdAt
                )
            } catch {
                return DirectMessage(
                    id: msg.id, sender: msg.sender,
                    body: "[Encrypted with a previous key]",
                    read: msg.read, encrypted: false, kind: msg.kind, createdAt: msg.createdAt
                )
            }
        }
    }
}

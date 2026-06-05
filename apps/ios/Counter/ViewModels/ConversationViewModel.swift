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
    /// Request state for this thread. Nil until the first load completes.
    private(set) var convInfo: ConversationInfo?

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

    // MARK: - Tunnel Talk state

    /// The Tunnel Talk session the user accepted or initiated, if any is active.
    private(set) var activeTunnelSession: TunnelSession?
    /// A pending incoming invite from the partner, if one arrived during polling.
    private(set) var pendingTunnelInvite: TunnelSession?
    /// Tunnel session records keyed by session ID, used to render thread markers
    /// and inline transcripts. Populated from the extended GET /messages/:username response.
    private(set) var tunnelSessions: [String: TunnelSessionWithTranscript] = [:]

    // MARK: - Live channel state

    /// True while the partner is actively typing. Driven only by the live
    /// socket and never persisted.
    private(set) var partnerTyping = false

    /// Whether the partner currently has this thread open, learned live. Falls
    /// back to the profile's presence snapshot until the socket reports in.
    private var partnerOnlineLive: Bool?

    /// Live-aware online flag for the header dot and the Tunnel Talk affordance.
    var partnerIsOnline: Bool {
        partnerOnlineLive ?? (partnerProfile?.presence?.isOnline ?? false)
    }

    private var live: ConversationLiveClient?
    private var typingClearTask: Task<Void, Never>?
    private var typingIdleTask: Task<Void, Never>?
    private var sentTyping = false

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

        // All six run concurrently: Keychain access and the five network fetches.
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
        // Conversation info tells us whether this thread is a pending request.
        async let infoResult: APIResult<ConversationInfo> = env.apiClient.request(
            .conversationInfo(username: partnerUsername)
        )

        let (msgs, partnerKey, myKey, profile, info) = await (msgResult, partnerKeyResult, myKeyResult, profileResult, infoResult)
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
        if case .success(let i) = info {
            convInfo = i
        }

        // If GET /auth/keys returned before setupLocalKeyPair finished registering,
        // or if the original registration failed silently, this device won't be in
        // myDeviceKeys. Add it locally so the send path includes it immediately, and
        // register it so the server's list stays current for all senders.
        if let did = currentDeviceId, let pub = cachedPublicKeyB64,
           !myDeviceKeys.contains(where: { $0.deviceId == did }) {
            myDeviceKeys.append(DeviceKeyEntry(deviceId: did, publicKey: pub))
            Task {
                _ = await env.apiClient.requestEmpty(
                    .registerPublicKey(deviceId: did, publicKey: pub)
                )
            }
        }

        if case .success(let page) = msgs {
            let decrypted = decryptAll(page.data)
            messages = decrypted.reversed()
            cursor = page.nextCursor
            hasMore = page.nextCursor != nil
            tunnelSessions = page.tunnelSessions ?? [:]
        } else {
            errorMessage = msgs.errorMessage
        }

        // Catch an invite that already exists, once. One that arrives while the
        // thread is open comes over the live socket instead, so there's no poll.
        await checkPendingInvite()
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
        // Sending means we've stopped typing; clear the partner's bubble now.
        stopTyping()

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

    // MARK: - Message request

    /// Accepts an inbound message request, activating the conversation.
    func acceptRequest() async {
        let result = await env.apiClient.requestEmpty(.acceptRequest(username: partnerUsername))
        if case .success = result {
            // Reflect the state change locally so the UI updates without a full reload.
            convInfo = ConversationInfo(status: .active, isInboundRequest: false)
        } else {
            errorMessage = result.errorMessage
        }
    }

    /// Declines an inbound message request by deleting the conversation.
    /// The caller is responsible for dismissing the view after this returns.
    func declineRequest() async {
        _ = await env.apiClient.requestEmpty(.deleteConversation(username: partnerUsername))
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

    // MARK: - Tunnel Talk

    /// Accepts an incoming Tunnel Talk invite, flipping the session to active on
    /// the server, and marks it as the active session so the view can open it.
    func acceptTunnel(session: TunnelSession) async {
        let result = await env.apiClient.requestEmpty(.tunnelAccept(sessionId: session.id))
        if case .success = result {
            pendingTunnelInvite = nil
            activeTunnelSession = session
        }
    }

    /// Declines an incoming Tunnel Talk invite.
    func declineTunnel(session: TunnelSession) async {
        _ = await env.apiClient.requestEmpty(.tunnelDecline(sessionId: session.id))
        pendingTunnelInvite = nil
    }

    /// Clears the active session reference after the TunnelTalkView closes.
    func clearActiveTunnel() {
        activeTunnelSession = nil
    }

    deinit {
        live?.close()
        typingClearTask?.cancel()
        typingIdleTask?.cancel()
    }

    // MARK: - Live channel

    /// Open the live socket for this thread. The token is passed in from the
    /// view because the auth store is main-actor isolated there. Safe to call
    /// repeatedly; the guard keeps a single connection.
    func startLive(token: String) {
        guard live == nil, !token.isEmpty else { return }
        let client = ConversationLiveClient(username: partnerUsername, token: token)
        client.onMessage = { [weak self] msg in self?.receiveLive(msg) }
        client.onTyping = { [weak self] on in self?.setPartnerTyping(on) }
        client.onPresence = { [weak self] online in
            self?.partnerOnlineLive = online
            // A partner who left the thread can't still be typing in it.
            if !online { self?.partnerTyping = false }
        }
        client.onTunnelInvite = { [weak self] session in
            guard let self, self.pendingTunnelInvite == nil, self.activeTunnelSession == nil else { return }
            self.pendingTunnelInvite = session
        }
        live = client
        client.connect()
    }

    /// Tear down the live socket and any pending typing timers.
    func stopLive() {
        live?.close()
        live = nil
        typingClearTask?.cancel()
        typingIdleTask?.cancel()
        sentTyping = false
    }

    /// Call whenever the draft changes so the partner sees a typing bubble.
    /// Throttled to one "started" per burst, with a short idle timer that sends
    /// "stopped" so the bubble clears on a pause.
    func handleTypingInput() {
        guard let live else { return }
        if draftBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            stopTyping()
            return
        }
        if !sentTyping {
            sentTyping = true
            live.setTyping(true)
        }
        typingIdleTask?.cancel()
        typingIdleTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            self?.stopTyping()
        }
    }

    /// Tell the partner we've stopped typing, if we'd said we were.
    func stopTyping() {
        typingIdleTask?.cancel()
        typingIdleTask = nil
        if sentTyping {
            sentTyping = false
            live?.setTyping(false)
        }
    }

    private func receiveLive(_ msg: DirectMessage) {
        // Skip anything already on screen: our own send appends optimistically,
        // and the partner's copy can also arrive over the socket.
        guard !messages.contains(where: { $0.id == msg.id }) else { return }
        messages.append(contentsOf: decryptAll([msg]))
    }

    private func setPartnerTyping(_ on: Bool) {
        partnerTyping = on
        typingClearTask?.cancel()
        // Force the bubble off if the partner's "stopped" is lost (app killed
        // mid-type).
        if on {
            typingClearTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(6))
                self?.partnerTyping = false
            }
        }
    }

    /// One-shot check for an invite that already existed when the thread opened.
    /// Live invites that arrive afterward come over the socket (see startLive).
    private func checkPendingInvite() async {
        guard pendingTunnelInvite == nil, activeTunnelSession == nil else { return }
        struct PendingResponse: Decodable {
            let pending: Bool
            let session: TunnelSession?
        }
        let result: APIResult<PendingResponse> = await env.apiClient.request(.tunnelPending(username: partnerUsername))
        if case .success(let resp) = result, resp.pending, let session = resp.session {
            pendingTunnelInvite = session
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
                    read: msg.read, encrypted: false, kind: msg.kind,
                    tunnelSessionId: msg.tunnelSessionId, createdAt: msg.createdAt
                )
            } catch {
                return DirectMessage(
                    id: msg.id, sender: msg.sender,
                    body: "[Encrypted with a previous key]",
                    read: msg.read, encrypted: false, kind: msg.kind,
                    tunnelSessionId: msg.tunnelSessionId, createdAt: msg.createdAt
                )
            }
        }
    }
}

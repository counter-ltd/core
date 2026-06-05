/**
 View model for a Tunnel Talk peer-to-peer session.

 Manages the signaling WebSocket (URLSessionWebSocketTask) that relays SDP and
 ICE candidates through the server-side Durable Object during connection setup.
 Once the WebRTC data channel opens, signaling is no longer needed and the
 WebSocket is closed.

 The actual P2P message transport depends on a WebRTC library (Google WebRTC
 for iOS or equivalent). Wire up a concrete TunnelWebRTCPeer implementation
 and assign it to `peer` before calling `connect(asInitiator:)`.

 Transcript buffering: when both parties consent, received and sent messages
 are appended to buffers that the caller uploads after the session ends via
 `POST /tunnel/:sessionId/transcript`.
 */

import Foundation
import Observation
import WebRTC

// MARK: - Message model

/// A decrypted Tunnel Talk message displayed in the session UI.
struct TunnelChatMessage: Identifiable, Sendable {
    let id: String         // tempId from the data channel
    let body: String
    let mine: Bool
    let sentAt: Date
}

// MARK: - WebRTC protocol

/**
 Abstract interface for the WebRTC peer connection.

 Implement this with the Google WebRTC SDK (or equivalent) and assign an
 instance to `TunnelTalkViewModel.peer` before connecting. The protocol
 keeps the view model compilable and testable without the external dependency.
 */
protocol TunnelWebRTCPeer: AnyObject {
    /// Called by the peer when a signaling message must be sent to the remote side.
    var onSignal: ((Data) -> Void)? { get set }
    /// Called when the data channel opens and P2P is established.
    var onConnected: (() -> Void)? { get set }
    /// Called when the data channel or ICE connection closes.
    var onDisconnected: (() -> Void)? { get set }
    /// Called for each decrypted message received from the remote peer.
    var onMessage: ((TunnelChatMessage) -> Void)? { get set }
    /// Called when the remote peer sends a consent change.
    var onConsent: ((Bool) -> Void)? { get set }
    /// Called when the remote peer sends an end signal.
    var onEnd: (() -> Void)? { get set }

    /// Create the data channel and an SDP offer (initiator side). The offer is
    /// delivered to the remote peer via the `onSignal` callback, not returned.
    func createOffer() async throws
    /// Handle a peer signal (offer, answer, or ICE candidate) received from the
    /// signaling channel. The peer parses the JSON and reacts (set remote
    /// description, add candidate, or answer an offer) itself.
    func receiveSignal(_ data: Data) async throws
    /// Encrypt and send a message over the data channel.
    func sendMessage(_ plaintext: String, tempId: String, bufferForTranscript: Bool) async throws
    /// Send the local user's consent state over the data channel.
    func sendConsent(_ value: Bool)
    /// Send an end signal and close the data channel.
    func end()

    /// Transcript entries buffered locally (sent messages) for upload after session ends.
    var sentBuffer: [TranscriptEntry] { get }
}

// MARK: - Signaling control types

/// Just the `type` field, decoded so the view model can split Durable Object
/// control messages (peer_joined / peer_left) from peer signals (offer / answer
/// / ice) without parsing the full payload. Peer signals are forwarded to the
/// WebRTC peer as opaque Data.
private struct SignalingType: Decodable {
    let type: String
}

// MARK: - View model

@Observable
final class TunnelTalkViewModel {

    private(set) var chatMessages: [TunnelChatMessage] = []
    private(set) var myConsent: Bool = false
    private(set) var partnerConsent: Bool = false

    /// Connection status shown in the session header.
    enum ConnectionState { case connecting, connected, ended, error(String) }
    private(set) var connectionState: ConnectionState = .connecting

    var draftBody: String = ""

    /// The WebRTC peer, constructed in connect() once TURN credentials are
    /// fetched. Overridable in tests with a stub conforming to the protocol.
    var peer: TunnelWebRTCPeer?

    let sessionId: String
    private let accessToken: String
    private let isInitiator: Bool
    private let env: AppEnvironment
    private let partnerDeviceKeys: [DeviceKeyEntry]
    private let myDeviceKeys: [DeviceKeyEntry]

    private var signalingTask: URLSessionWebSocketTask?

    init(
        sessionId: String,
        accessToken: String,
        isInitiator: Bool,
        partnerDeviceKeys: [DeviceKeyEntry],
        myDeviceKeys: [DeviceKeyEntry],
        env: AppEnvironment
    ) {
        self.sessionId = sessionId
        self.accessToken = accessToken
        self.isInitiator = isInitiator
        self.partnerDeviceKeys = partnerDeviceKeys
        self.myDeviceKeys = myDeviceKeys
        self.env = env
    }

    // MARK: - Connect

    /**
     Fetch TURN credentials, build the WebRTC peer, then open the signaling
     WebSocket and wire everything together.

     The signaling connection is only needed during connection setup (a few
     seconds). Once the data channel opens, it is closed automatically.
     */
    func connect() async {
        // Fetch fresh TURN credentials per session attempt. Stale credentials
        // cause silent ICE failures, so we never cache them.
        let turnResult: APIResult<TurnCredentials> = await env.apiClient.request(.tunnelTurnCredentials)
        guard case .success(let turn) = turnResult else {
            connectionState = .error("Could not fetch connection credentials")
            return
        }

        var iceServer = RTCIceServer(urlStrings: turn.urls)
        if !turn.username.isEmpty {
            iceServer = RTCIceServer(urlStrings: turn.urls, username: turn.username, credential: turn.credential)
        }

        // Construct the concrete peer now that we have ICE servers. It loads its
        // own key pair from the Keychain (the same key the conversation uses).
        if peer == nil {
            peer = WebRTCPeer(
                iceServers: [iceServer],
                partnerDeviceKeys: partnerDeviceKeys,
                myDeviceKeys: myDeviceKeys
            )
        }

        guard var components = URLComponents(url: APIClient.baseURL, resolvingAgainstBaseURL: false) else {
            connectionState = .error("Invalid API URL")
            return
        }
        // Convert http(s) to ws(s) for the WebSocket upgrade.
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/tunnel/\(sessionId)/signal"
        components.queryItems = [URLQueryItem(name: "token", value: accessToken)]

        guard let wsURL = components.url else {
            connectionState = .error("Could not build signaling URL")
            return
        }

        var request = URLRequest(url: wsURL)
        request.timeoutInterval = 30
        let task = URLSession.shared.webSocketTask(with: request)
        signalingTask = task

        // Wire peer callbacks before opening the socket so no events are missed.
        wireP2P()
        task.resume()
        // Start the receive loop on a background task.
        Task { await receiveLoop(task: task) }
    }

    // MARK: - Send

    func send() async {
        let text = draftBody.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, case .connected = connectionState, let peer else { return }
        draftBody = ""

        let tempId = UUID().uuidString
        chatMessages.append(TunnelChatMessage(id: tempId, body: text, mine: true, sentAt: Date()))

        // Buffer for transcript only when both parties have consented.
        do {
            try await peer.sendMessage(text, tempId: tempId, bufferForTranscript: myConsent && partnerConsent)
        } catch {
            // Encryption or send failure — surface to the user.
            draftBody = text
        }
    }

    // MARK: - Consent

    func toggleConsent() async {
        let next = !myConsent
        myConsent = next
        peer?.sendConsent(next)
        // Mirror to the server so the remote peer's upload is also gated.
        let endpoint: Endpoint = next ? .tunnelConsentOn(sessionId: sessionId) : .tunnelConsentOff(sessionId: sessionId)
        _ = await env.apiClient.requestEmpty(endpoint)
    }

    // MARK: - End

    /**
     End the session from this side: send the end signal, close the peer,
     tell the server, and upload the transcript if the user consented.
     */
    func endSession() async {
        guard case .connected = connectionState else { return }
        connectionState = .ended

        peer?.end()
        signalingTask?.cancel(with: .goingAway, reason: nil)

        _ = await env.apiClient.requestEmpty(.tunnelEnd(sessionId: sessionId))

        if myConsent, let peer, !peer.sentBuffer.isEmpty {
            let input = UploadTranscriptInput(messages: peer.sentBuffer)
            _ = await env.apiClient.requestEmpty(.tunnelTranscript(sessionId: sessionId, input: input))
        }
    }

    // MARK: - Private

    private func wireP2P() {
        guard let peer else { return }

        peer.onConnected = { [weak self] in
            self?.connectionState = .connected
            // Close the signaling channel — no longer needed once data channel is up.
            self?.signalingTask?.cancel(with: .goingAway, reason: nil)
            self?.signalingTask = nil
        }

        peer.onDisconnected = { [weak self] in
            if case .ended = self?.connectionState { return }
            self?.connectionState = .ended
        }

        peer.onMessage = { [weak self] msg in
            self?.chatMessages.append(msg)
        }

        peer.onConsent = { [weak self] value in
            self?.partnerConsent = value
        }

        peer.onEnd = { [weak self] in
            self?.connectionState = .ended
        }

        peer.onSignal = { [weak self] data in
            self?.sendSignal(data)
        }
    }

    private func receiveLoop(task: URLSessionWebSocketTask) async {
        // The offer is created on peer_joined, not here: sending it before the
        // participant is on the signaling channel would lose it, since the DO
        // relays to currently-connected peers only and does not buffer.
        while true {
            do {
                let message = try await task.receive()
                switch message {
                case .data(let data):
                    await handleSignalingData(data)
                case .string(let str):
                    if let data = str.data(using: .utf8) {
                        await handleSignalingData(data)
                    }
                @unknown default:
                    break
                }
            } catch {
                // Socket closed or error — signaling phase is over either way.
                break
            }
        }
    }

    private func handleSignalingData(_ data: Data) async {
        guard let peer else { return }
        guard let parsed = try? JSONDecoder().decode(SignalingType.self, from: data) else { return }

        switch parsed.type {
        case "peer_joined":
            // The remote peer is now on the signaling channel. The initiator
            // creates the offer at this point so it isn't sent into the void.
            if isInitiator {
                try? await peer.createOffer()
            }
        case "peer_left":
            if case .ended = connectionState { return }
            connectionState = .ended
        default:
            // offer, answer, ice — the peer parses and reacts itself.
            try? await peer.receiveSignal(data)
        }
    }

    private func sendSignal(_ data: Data) {
        // The signaling DO's webSocketMessage handler parses string frames. Sending
        // binary frames causes it to call JSON.parse on an empty string and silently
        // drop the message, so the offer/answer/ICE candidates never reach the peer.
        guard let str = String(data: data, encoding: .utf8) else { return }
        signalingTask?.send(.string(str)) { _ in
            // Fire and forget — if signaling fails the connection won't establish.
        }
    }
}

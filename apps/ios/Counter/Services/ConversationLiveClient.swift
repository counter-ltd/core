/**
 WebSocket client for a conversation's live channel (the ConversationHub
 Durable Object on the API).

 One per open thread. It surfaces the three things the thread would otherwise
 only learn by reloading: a new message arriving, the partner typing, and the
 partner opening or closing the thread. Messages still go out through the normal
 REST send call; this socket only carries the typing signal upward, everything
 else flows down.

 It reconnects on drop with capped backoff, since unlike the short-lived Tunnel
 Talk signaling socket this one stays open for as long as the thread is on
 screen. Call `close()` when the view goes away.

 Mirrors apps/web/src/lib/conversation-live.ts and the signaling setup in
 TunnelTalkViewModel.
 */

import Foundation

final class ConversationLiveClient {

    private let username: String
    private let token: String
    private var task: URLSessionWebSocketTask?
    private var retries = 0
    private var closed = false

    /// A new message was pushed (the partner's, or a copy of one sent elsewhere).
    var onMessage: ((DirectMessage) -> Void)?
    /// The partner started or stopped typing.
    var onTyping: ((Bool) -> Void)?
    /// The partner opened or closed this thread.
    var onPresence: ((Bool) -> Void)?
    /// The partner sent a Tunnel Talk invite.
    var onTunnelInvite: ((TunnelSession) -> Void)?

    init(username: String, token: String) {
        self.username = username
        self.token = token
    }

    /// Open the socket and start the receive loop.
    func connect() {
        guard !closed else { return }
        guard var components = URLComponents(url: APIClient.baseURL, resolvingAgainstBaseURL: false) else { return }
        // http(s) to ws(s) for the upgrade; token rides the query because a
        // WebSocket handshake can't carry an Authorization header.
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/messages/\(username)/live"
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components.url else { return }

        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        let t = URLSession.shared.webSocketTask(with: request)
        task = t
        t.resume()
        Task { await receiveLoop(task: t) }
    }

    /// Tell the partner whether we're typing. Dropped silently if the socket
    /// isn't open; the server also ignores it when the user has typing off.
    func setTyping(_ on: Bool) {
        guard let task else { return }
        let payload = "{\"type\":\"typing\",\"on\":\(on ? "true" : "false")}"
        task.send(.string(payload)) { _ in }
    }

    /// Close for good. The hub hibernates once both sides drop.
    func close() {
        closed = true
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private func receiveLoop(task: URLSessionWebSocketTask) async {
        while !closed {
            do {
                let message = try await task.receive()
                switch message {
                case .data(let data):
                    handle(data)
                case .string(let str):
                    if let data = str.data(using: .utf8) { handle(data) }
                @unknown default:
                    break
                }
            } catch {
                // Socket dropped. Reconnect unless we closed on purpose.
                break
            }
        }
        if !closed { scheduleReconnect() }
    }

    private func scheduleReconnect() {
        // Capped exponential backoff. The thread stays usable from its loaded
        // state while disconnected, so there's no rush; just heal on a blip.
        let delay = min(pow(2.0, Double(retries)), 30)
        retries += 1
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            self?.connect()
        }
    }

    private func handle(_ data: Data) {
        guard let envelope = try? JSONDecoder().decode(SignalEnvelope.self, from: data) else { return }
        // Any decodable frame means the connection is alive, so reset backoff.
        retries = 0

        switch envelope.type {
        case "message":
            if let s = try? JSONDecoder().decode(MessageSignal.self, from: data) {
                onMessage?(s.message)
            }
        case "typing":
            if let s = try? JSONDecoder().decode(TypingSignal.self, from: data) {
                onTyping?(s.on)
            }
        case "presence":
            if let s = try? JSONDecoder().decode(PresenceSignal.self, from: data) {
                onPresence?(s.online)
            }
        case "presence_state":
            if let s = try? JSONDecoder().decode(PresenceStateSignal.self, from: data) {
                // A non-empty list means the partner already has the thread open.
                onPresence?(!s.online.isEmpty)
            }
        case "tunnel_invite":
            if let s = try? JSONDecoder().decode(TunnelInviteSignal.self, from: data) {
                onTunnelInvite?(s.session)
            }
        default:
            break
        }
    }

    // MARK: - Wire formats (mirror LiveSignal in packages/types)

    private struct SignalEnvelope: Decodable { let type: String }
    private struct MessageSignal: Decodable { let message: DirectMessage }
    private struct TypingSignal: Decodable { let on: Bool }
    private struct PresenceSignal: Decodable { let online: Bool }
    private struct PresenceStateSignal: Decodable { let online: [String] }
    private struct TunnelInviteSignal: Decodable { let session: TunnelSession }
}

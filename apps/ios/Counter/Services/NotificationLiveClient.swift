/**
 WebSocket client for the per-user live notification feed (the NotificationHub
 Durable Object on the API).

 One per signed-in session, opened at the app root so it spans the whole app. A
 new like, follow, reply, mention, or message arrives here the moment it's
 created, so the tab badges and lists update without a reload and without waiting
 for a background push. The channel is one-way (server to client); the client
 never sends anything up it.

 Reconnects on drop with capped backoff, since it's meant to stay open for the
 session. Mirrors ConversationLiveClient and the web notifications-live client.
 */

import Foundation

final class NotificationLiveClient {

    private let token: String
    private var task: URLSessionWebSocketTask?
    private var retries = 0
    private var closed = false

    /// A new notification was created for this user.
    var onNotification: ((AppNotification) -> Void)?

    init(token: String) {
        self.token = token
    }

    func connect() {
        guard !closed else { return }
        guard var components = URLComponents(url: APIClient.baseURL, resolvingAgainstBaseURL: false) else { return }
        // http(s) to ws(s); token rides the query because a WebSocket handshake
        // can't carry an Authorization header.
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/notifications/live"
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components.url else { return }

        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        let t = URLSession.shared.webSocketTask(with: request)
        task = t
        t.resume()
        Task { await receiveLoop(task: t) }
    }

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
                break
            }
        }
        if !closed { scheduleReconnect() }
    }

    private func scheduleReconnect() {
        let delay = min(pow(2.0, Double(retries)), 30)
        retries += 1
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            self?.connect()
        }
    }

    private func handle(_ data: Data) {
        guard let envelope = try? JSONDecoder().decode(SignalEnvelope.self, from: data) else { return }
        retries = 0
        if envelope.type == "notification",
           let s = try? JSONDecoder().decode(NotificationSignal.self, from: data) {
            onNotification?(s.notification)
        }
    }

    private struct SignalEnvelope: Decodable { let type: String }
    private struct NotificationSignal: Decodable { let notification: AppNotification }
}

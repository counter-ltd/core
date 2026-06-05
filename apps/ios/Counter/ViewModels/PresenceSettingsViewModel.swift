/**
 View model for the presence settings panel in Settings.

 Loads the current online-status and last-seen configuration and saves changes
 back. Saving sends the full settings object so the server always reflects
 exactly what the toggles show.

 Also drives the heartbeat timer: when either presence feature is enabled,
 it starts a repeating task that calls POST /users/me/heartbeat at the
 user's configured interval. The timer stops when both are off.
 */

import Foundation
import Observation

@Observable
final class PresenceSettingsViewModel {

    var settings: PresenceSettings = .defaultSettings
    private(set) var isLoading: Bool = false
    private(set) var isSaving: Bool = false
    var errorMessage: String?

    private let env: AppEnvironment
    /// Held so the running heartbeat task can be cancelled when settings change.
    private var heartbeatTask: Task<Void, Never>?

    init(env: AppEnvironment) {
        self.env = env
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        let result: APIResult<PresenceSettings> = await env.apiClient.request(.presenceSettings)
        if case .success(let loaded) = result {
            settings = loaded
            restartHeartbeatIfNeeded()
        } else {
            errorMessage = result.errorMessage
        }
    }

    func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let result = await env.apiClient.requestEmpty(.updatePresenceSettings(settings))
        if case .success = result {
            restartHeartbeatIfNeeded()
            return
        }
        errorMessage = result.errorMessage
    }

    // MARK: - Heartbeat

    /// Start or stop the heartbeat timer based on the current settings.
    func restartHeartbeatIfNeeded() {
        heartbeatTask?.cancel()
        heartbeatTask = nil

        guard settings.onlineStatusEnabled || settings.lastSeenEnabled else { return }

        let interval = TimeInterval(settings.heartbeatIntervalSeconds)
        heartbeatTask = Task {
            // Send one immediately so the server registers activity right away.
            await sendHeartbeat()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                guard !Task.isCancelled else { break }
                await sendHeartbeat()
            }
        }
    }

    private func sendHeartbeat() async {
        _ = await env.apiClient.requestEmpty(.heartbeat)
    }
}

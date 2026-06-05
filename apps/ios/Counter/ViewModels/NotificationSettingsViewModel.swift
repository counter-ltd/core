/**
 View model for the notification toggles in Settings.

 Loads the current per-type preferences and saves changes back. Saving sends
 the whole set, so the server state always matches exactly what the toggles
 show rather than depending on which ones the user happened to flip.
 */

import Foundation
import Observation

@Observable
final class NotificationSettingsViewModel {

    /// The toggle state bound to the UI. Starts all-on so the screen renders
    /// before the fetch lands, then gets replaced by the server's values.
    var prefs: NotificationPreferences = .allOn
    private(set) var isLoading: Bool = false
    private(set) var isSaving: Bool = false
    var errorMessage: String?

    private let env: AppEnvironment

    init(env: AppEnvironment) {
        self.env = env
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }

        let result: APIResult<NotificationPreferences> =
            await env.apiClient.request(.notificationPreferences)
        if case .success(let loaded) = result {
            prefs = loaded
        } else {
            errorMessage = result.errorMessage
        }
    }

    func save() async {
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let result = await env.apiClient.requestEmpty(.updateNotificationPreferences(prefs))
        if case .success = result { return }
        errorMessage = result.errorMessage
    }
}

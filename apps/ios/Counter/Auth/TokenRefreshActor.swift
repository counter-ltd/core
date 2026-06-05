/**
 Serialises token refresh attempts to prevent duplicate refresh calls.

 The problem this solves: two concurrent requests both receive a 401. Without
 coordination they'd both call `POST /auth/refresh`, but the first rotation
 invalidates the refresh token so the second call fails and the user gets
 logged out.

 This actor collapses concurrent refresh attempts into one in-flight Task.
 The second caller joins the first call's Task and awaits the same result.
 */

import Foundation

actor TokenRefreshActor {

    private weak var authStore: AuthStore?
    /// The in-flight refresh Task, if one is running.
    private var inflight: Task<Bool, Never>?

    init(authStore: AuthStore) {
        self.authStore = authStore
    }

    /// Refreshes the access token. Returns true if a new token pair was stored.
    ///
    /// Concurrent callers automatically join the in-flight task rather than
    /// starting a new one. After the task completes, the next caller starts
    /// a fresh attempt.
    func refresh() async -> Bool {
        if let existing = inflight {
            return await existing.value
        }

        let task = Task<Bool, Never> {
            defer { inflight = nil }
            return await performRefresh()
        }
        inflight = task
        return await task.value
    }

    // MARK: - Internal

    private func performRefresh() async -> Bool {
        guard let authStore else { return false }

        let refreshToken = authStore.refreshToken
        guard let refreshToken else {
            authStore.clearSession()
            return false
        }

        // Direct URLSession call to avoid going back through APIClient
        // (which would recurse back into this actor on another 401).
        guard let url = URL(string: "\(APIClient.baseURL)/auth/refresh") else {
            return false
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONEncoder().encode(RefreshInput(refreshToken: refreshToken))

        guard
            let (data, response) = try? await URLSession.shared.data(for: req),
            let http = response as? HTTPURLResponse,
            http.statusCode == 200,
            let pair = try? JSONDecoder().decode(TokenPair.self, from: data)
        else {
            // Any failure here means the refresh token is expired or revoked.
            authStore.clearSession()
            return false
        }

        authStore.updateTokens(pair)
        return true
    }
}

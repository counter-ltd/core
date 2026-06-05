/**
 Top-level application state passed through the SwiftUI environment.

 `AppEnvironment` owns `AuthStore`, `AccountStore`, and `APIClient` and wires
 them together. Every view that needs to make an API call or read auth state
 reaches for this via `@Environment(AppEnvironment.self)`.

 The restore flow runs once at app launch:
 1. Load tokens from Keychain.
 2. Try `GET /users/me` with the stored access token.
 3. On 401, try `POST /auth/refresh`.
 4. On success, populate `authStore.currentUser`.
 5. On failure, clear the session (forces login screen).
 */

import Foundation
import Observation
import AuthenticationServices
import UIKit

@Observable
final class AppEnvironment {

    let authStore: AuthStore
    let accountStore: AccountStore
    let apiClient: APIClient
    let themeStore: ThemeStore
    /// Carries a tapped push notification's target to the navigation layer.
    let pushRouter = PushRouter()

    /// True while the launch restore is in progress.
    private(set) var isRestoring: Bool = true

    init() {
        let auth = AuthStore()
        self.authStore = auth
        self.accountStore = AccountStore()
        self.apiClient = APIClient(authStore: auth)
        let theme = ThemeStore()
        // Restore the saved palette synchronously so the very first frame
        // already renders in the user's chosen theme, with no flash of default.
        theme.load()
        self.themeStore = theme
    }

    // MARK: - Theme

    /// Loads the first page of the public theme gallery if it hasn't been
    /// fetched yet. Hands the shared client to the store, which owns the state.
    func loadThemeGallery() async {
        await themeStore.loadGalleryIfNeeded(client: apiClient)
    }

    /// Loads the next page of the theme gallery.
    func loadMoreThemes() async {
        await themeStore.loadMore(client: apiClient)
    }

    // MARK: - App launch

    /// Restores the active session from Keychain. Must be called once from
    /// `RootView.task` before showing any authenticated UI.
    func restoreSession() async {
        defer { isRestoring = false }

        accountStore.load()

        // Prefer the account list's active entry over the bare token keys.
        // The account list is the source of truth when multi-account is in use.
        if let active = accountStore.activeAccount {
            let restored = await restoreAccount(active)
            if restored { return }
            // If the active account's tokens are dead, fall through and show login.
            accountStore.remove(id: active.id)
            authStore.clearSession()
            return
        }

        // Fallback for first-run or a version upgrade from before multi-account.
        let (access, refresh) = authStore.loadFromKeychain()
        guard let refresh else { return }

        await restoreWithTokens(access: access, refresh: refresh)
    }

    // MARK: - Account switching

    /// Switches to the account with the given ID, refreshing tokens as needed.
    func switchAccount(to id: String) async {
        guard let account = accountStore.switchTo(id: id) else { return }
        authStore.setTokensForSwitch(access: account.accessToken, refresh: account.refreshToken)
        _ = await restoreAccount(account)
    }

    // MARK: - Login / logout helpers

    /// Called after a successful login or register response.
    func didSignIn(tokens: TokenPair, user: PrivateUser) {
        authStore.storeSession(tokens: tokens, user: user)
        accountStore.upsert(StoredAccount(
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: user.avatarUrl,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken
        ))
    }

    /// Logs out the current account. If other accounts remain, the next one
    /// becomes active.
    func signOut() async {
        guard let user = authStore.currentUser else { return }

        // Deregister this device while the access token is still valid, so the
        // account we're leaving stops pushing to this phone.
        await PushService.shared.removeToken()

        // Fire-and-forget logout; we don't block on the response.
        let refreshToken = authStore.refreshToken
        Task {
            _ = await apiClient.requestEmpty(.logout(refreshToken: refreshToken))
        }

        accountStore.remove(id: user.id)
        authStore.clearSession()

        // Activate the next stored account if one exists.
        if let next = accountStore.activeAccount {
            await switchAccount(to: next.id)
        }
    }

    /// Permanently deletes the current account on the server, then tears down
    /// local state. If other accounts remain, the next one becomes active.
    ///
    /// Unlike `signOut`, this blocks on the API call: a failed delete must not
    /// drop the user's local session, otherwise they'd think the account was
    /// gone when it still exists server-side.
    @discardableResult
    func deleteAccount() async -> Bool {
        guard let user = authStore.currentUser else { return false }

        let result = await apiClient.requestEmpty(.deleteAccount)
        guard case .success = result else { return false }

        accountStore.remove(id: user.id)
        authStore.clearSession()

        if let next = accountStore.activeAccount {
            await switchAccount(to: next.id)
        }
        return true
    }

    // MARK: - OAuth account linking

    // Retained for the duration of the ASWebAuthenticationSession.
    private var oauthContext: OAuthPresentationContext?

    /**
     Open the provider's OAuth consent page and link it to the current account.

     Calls the prepare endpoint (with the Bearer token) to get the auth URL, then
     opens it in an ASWebAuthenticationSession. The callback is caught via the
     counter:// scheme. Returns true if the link completed successfully.
     */
    @discardableResult
    func oauthConnect(provider: OAuthProvider) async -> Bool {
        let result: APIResult<OAuthConnectPrepareResponse> = await apiClient.request(
            .oauthConnectPrepare(provider: provider)
        )
        guard case .success(let prepared) = result,
              let url = URL(string: prepared.authUrl) else { return false }

        do {
            _ = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                let context = OAuthPresentationContext()
                oauthContext = context
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "counter") { url, error in
                    if let error { continuation.resume(throwing: error) }
                    else if let url { continuation.resume(returning: url) }
                }
                session.presentationContextProvider = context
                session.prefersEphemeralWebBrowserSession = false
                session.start()
            }
            return true
        } catch ASWebAuthenticationSessionError.canceledLogin {
            return false
        } catch {
            return false
        }
    }

    // MARK: - Internal

    private func restoreAccount(_ account: StoredAccount) async -> Bool {
        authStore.setTokensForSwitch(access: account.accessToken, refresh: account.refreshToken)
        return await restoreWithTokens(access: account.accessToken, refresh: account.refreshToken)
    }

    @discardableResult
    private func restoreWithTokens(access: String?, refresh: String) async -> Bool {
        // Try the access token first.
        if let access, !access.isEmpty {
            let result: APIResult<PrivateUser> = await apiClient.request(.me)
            if case .success(let user) = result {
                authStore.updateUser(user)
                return true
            }
        }

        // Access token missing or expired: try the refresh token.
        guard let url = URL(string: "\(APIClient.baseURL)/auth/refresh") else { return false }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONEncoder().encode(RefreshInput(refreshToken: refresh))

        guard
            let (data, response) = try? await URLSession.shared.data(for: req),
            let http = response as? HTTPURLResponse,
            http.statusCode == 200,
            let pair = try? JSONDecoder().decode(TokenPair.self, from: data)
        else {
            return false
        }

        authStore.updateTokens(pair)
        accountStore.updateActiveTokens(pair)

        let meResult: APIResult<PrivateUser> = await apiClient.request(.me)
        if case .success(let user) = meResult {
            authStore.updateUser(user)
            return true
        }

        return false
    }
}

// MARK: - OAuthPresentationContext

/// Provides the key window as the presentation anchor for ASWebAuthenticationSession.
///
/// Stored as a strong reference on AppEnvironment because the session holds a
/// weak pointer to its context provider and will crash if it's released early.
private final class OAuthPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? UIWindow()
    }
}

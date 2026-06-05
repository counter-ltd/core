/**
 View model for the login and registration screens.

 Shared between `LoginView` and `RegisterView` since both result in the same
 outcome: a token pair and a user stored in `AppEnvironment`. The `mode` enum
 lets the view swap its form fields without needing two separate view models.
 */

import Foundation
import Observation
import AuthenticationServices

@Observable
final class AuthViewModel {

    enum Mode {
        case login
        case register
    }

    // MARK: - Form state

    var mode: Mode
    var identifier: String = ""
    var username: String = ""
    var email: String = ""
    var password: String = ""
    var displayName: String = ""

    // MARK: - Async state

    private(set) var isLoading: Bool = false
    var errorMessage: String?

    // Internal: exposed so LoginView can pass it through to RegisterView's init.
    let env: AppEnvironment

    /// Called once after a successful sign-in, after the session is stored.
    /// The root login leaves this nil and lets `RootView` swap to the tab bar;
    /// the add-account sheet uses it to dismiss itself, since the app is already
    /// authenticated and `RootView` won't re-render on its own.
    var onAuthenticated: (() -> Void)?

    init(env: AppEnvironment, mode: Mode = .login, onAuthenticated: (() -> Void)? = nil) {
        self.env = env
        self.mode = mode
        self.onAuthenticated = onAuthenticated
    }

    // MARK: - Actions

    func submit() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        switch mode {
        case .login:
            await login()
        case .register:
            await register()
        }
    }

    // MARK: - Internal

    private func login() async {
        let result: APIResult<AuthResponse> = await env.apiClient.request(
            .login(identifier: identifier.trimmingCharacters(in: .whitespaces),
                   password: password)
        )
        handle(result)
    }

    private func register() async {
        let result: APIResult<AuthResponse> = await env.apiClient.request(
            .register(
                username: username.trimmingCharacters(in: .whitespaces).lowercased(),
                email: email.trimmingCharacters(in: .whitespaces).lowercased(),
                password: password,
                displayName: displayName.isEmpty ? nil : displayName.trimmingCharacters(in: .whitespaces)
            )
        )
        handle(result)
    }

    // Retained for the lifetime of the ASWebAuthenticationSession. The session
    // holds a weak reference to its context provider, so we must keep this alive.
    private var webAuthContext: WebAuthContext?

    /// Open the provider's OAuth consent page and sign in (or create an account).
    ///
    /// Uses ASWebAuthenticationSession with the counter:// custom scheme. The API
    /// redirects to counter://auth/callback?code=X after the user approves, which
    /// the session intercepts and returns here for exchange.
    func oauthSignIn(provider: OAuthProvider) async {
        guard let url = URL(string: "\(APIClient.baseURL)/auth/\(provider.rawValue)?mobile=true") else { return }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let callbackURL = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
                let context = WebAuthContext()
                webAuthContext = context
                let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "counter") { url, error in
                    if let error { continuation.resume(throwing: error) }
                    else if let url { continuation.resume(returning: url) }
                }
                session.presentationContextProvider = context
                // Use the shared browser session so GitHub/Discord credentials from
                // Safari carry over; the user doesn't have to log in twice.
                session.prefersEphemeralWebBrowserSession = false
                session.start()
            }

            guard
                let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: true),
                let code = components.queryItems?.first(where: { $0.name == "code" })?.value
            else {
                errorMessage = "Sign-in failed. Please try again."
                return
            }

            let result: APIResult<AuthResponse> = await env.apiClient.request(.oauthExchangeCode(code: code))
            handle(result)
        } catch ASWebAuthenticationSessionError.canceledLogin {
            // User dismissed the sheet — no error message needed.
        } catch {
            errorMessage = "Sign-in failed. Please try again."
        }
    }

    private func handle(_ result: APIResult<AuthResponse>) {
        switch result {
        case .success(let auth):
            env.didSignIn(
                tokens: TokenPair(accessToken: auth.accessToken,
                                  refreshToken: auth.refreshToken,
                                  expiresIn: auth.expiresIn),
                user: auth.user
            )
            onAuthenticated?()
        case .apiError(let e):
            errorMessage = e.message
        case .networkError:
            errorMessage = result.errorMessage
        }
    }
}

// MARK: - WebAuthContext

/// Provides the presentation anchor for ASWebAuthenticationSession.
///
/// Stored as a strong reference on AuthViewModel so the session's weak pointer
/// to its context provider stays valid for the full OAuth round-trip.
private final class WebAuthContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? UIWindow()
    }
}

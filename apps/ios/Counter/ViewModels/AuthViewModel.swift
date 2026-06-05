/**
 View model for the login and registration screens.

 Shared between `LoginView` and `RegisterView` since both result in the same
 outcome: a token pair and a user stored in `AppEnvironment`. The `mode` enum
 lets the view swap its form fields without needing two separate view models.
 */

import Foundation
import Observation

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

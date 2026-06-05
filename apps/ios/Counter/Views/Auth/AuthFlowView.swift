/**
 Navigation container for the login and registration screens.

 A simple `NavigationStack` with a login entry point. The register link
 pushes `RegisterView` onto the stack rather than presenting modally so
 the user can back out.
 */

import SwiftUI

struct AuthFlowView: View {
    @Environment(\.counterTheme) private var theme
    @Environment(AppEnvironment.self) private var env

    /// Called after a successful sign-in. The root usage leaves this nil (RootView
    /// swaps to the tab bar); the add-account sheet passes a dismiss closure.
    var onComplete: (() -> Void)?

    var body: some View {
        NavigationStack {
            LoginView(vm: AuthViewModel(env: env, mode: .login, onAuthenticated: onComplete))
        }
        .background(theme.bg)
    }
}

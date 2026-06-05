/**
 The root view that gates between the main tab interface and the auth flow.

 Waits for `AppEnvironment.isRestoring` to complete before showing either
 `MainTabView` (authenticated) or `AuthFlowView` (unauthenticated). Showing
 a blank view during restore prevents a flash of the login screen on every
 cold start.
 */

import SwiftUI

struct RootView: View {
    @Environment(\.counterTheme) private var theme
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        Group {
            if env.isRestoring {
                // Blank dark screen while we validate stored tokens.
                theme.bg.ignoresSafeArea()
            } else if env.authStore.isAuthenticated {
                MainTabView()
            } else {
                AuthFlowView()
            }
        }
        .task {
            await env.restoreSession()
        }
    }
}

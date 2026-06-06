/**
 App entry point.

 Creates the `AppEnvironment` singleton and injects it into the SwiftUI
 environment for all descendant views. The environment is created once here
 and shared; views must not create their own instances.
 */

import SwiftUI

@main
struct CounterApp: App {

    // Bridges UIKit's remote-notification callbacks into the SwiftUI lifecycle;
    // there's no SwiftUI-native hook for the APNs device token.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    @State private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(env)
                // Reading palette/style/base here (env is @Observable) re-runs
                // body on a theme change, re-injecting the new look app-wide.
                .environment(\.counterTheme, env.themeStore.palette)
                .environment(\.counterStyle, env.themeStore.style)
                // One modifier themes every Text in the app: a monospace
                // "terminal" theme flips the whole UI to mono with no per-view work.
                .fontDesign(env.themeStore.style.fontDesign)
                .preferredColorScheme(env.themeStore.base == .dark ? .dark : .light)
                .task {
                    // Wire up the push environment on launch. No permission
                    // prompt fires here; the user opts in from Privacy > Devices.
                    PushService.shared.wireUp(env: env)
                }
        }
    }
}

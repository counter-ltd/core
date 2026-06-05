/**
 Apple Push Notifications: permission, device-token registration, and tap routing.

 SwiftUI has no app-delegate hooks for remote notifications, so `AppDelegate`
 bridges UIKit's callbacks (installed via `@UIApplicationDelegateAdaptor` in
 `CounterApp`). `PushService` owns the lifecycle: it asks for permission, stores
 the APNs token locally, removes it from the server on sign-out, and routes tapped
 notifications to in-app destinations.

 Device registration is opt-in. The OS token is stored locally as soon as iOS
 provides it, but it is only uploaded to the server when the user explicitly
 registers this device in Settings > Privacy > Devices. This avoids collecting
 a push address without explicit consent.

 The server gates delivery on the user's per-type preferences, so there's no
 client-side filtering here: if a push arrives, the user asked for it.
 */

import SwiftUI
import UIKit
import UserNotifications
import Observation

// MARK: - App delegate bridge

/// Forwards UIKit's remote-notification callbacks to `PushService`.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Set early so notifications tapped from a cold launch still route.
        UNUserNotificationCenter.current().delegate = PushService.shared
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { await PushService.shared.didRegister(deviceToken: deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // A failure here just means no push this run (no entitlement, no network,
        // a simulator). The in-app inbox is unaffected, so we only log it.
        print("[push] remote registration failed: \(error.localizedDescription)")
    }
}

// MARK: - Tap router

/// Holds the destination a tapped notification wants to open until a view picks
/// it up. Observable so `MainTabView` can react and drive its navigation stack.
@Observable
final class PushRouter {
    var pending: AppDestination?
}

// MARK: - Push service

@MainActor
final class PushService: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushService()

    private var env: AppEnvironment?
    // Latest APNs token, hex-encoded. Stored locally as soon as iOS provides it
    // but not uploaded until the user opts in via Settings > Privacy > Devices.
    private var deviceTokenHex: String?
    // Bridges the app-delegate token callback into an async context so
    // requestPermissionAndGetToken() can await the token instead of polling.
    private var pendingTokenContinuation: CheckedContinuation<String?, Never>?

    private override init() {}

    /// Wire up the environment. Call once on launch. Does NOT prompt for
    /// notification permission; the user opts in from Settings > Privacy > Devices.
    ///
    /// If the user already granted permission on a previous run, this silently
    /// re-registers so the token is fresh before the Devices screen opens.
    func wireUp(env: AppEnvironment) {
        self.env = env
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            if settings.authorizationStatus == .authorized {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    /// Ask for notification permission and wait for the APNs token. Returns the
    /// token on success, nil if the user denies permission or registration fails.
    ///
    /// Safe to call when permission was already granted: the OS skips the prompt
    /// and the existing token is returned immediately without a round-trip.
    func requestPermissionAndGetToken() async -> String? {
        // Already have a token from this session (permission granted previously
        // and wireUp already registered, or a prior call to this method).
        if let existing = deviceTokenHex { return existing }

        guard let granted = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound]),
              granted else { return nil }

        // registerForRemoteNotifications() fires the app-delegate callback, not
        // this async call. Bridge it with a continuation so callers can await.
        return await withCheckedContinuation { cont in
            pendingTokenContinuation = cont
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    /// Called once the OS hands us the device token. Stores it and resolves any
    /// in-flight continuation from requestPermissionAndGetToken().
    func didRegister(deviceToken: Data) async {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        deviceTokenHex = hex
        pendingTokenContinuation?.resume(returning: hex)
        pendingTokenContinuation = nil
    }

    /// True when the OS has provided a push token this session. Used by
    /// `DevicesViewModel` to decide whether to show the register button.
    var hasToken: Bool { deviceTokenHex != nil }

    /// The device ID cached after a successful registration for this user. Used
    /// by `DevicesView` to mark "This device" in the list.
    var registeredDeviceId: String? {
        guard let userId = env?.authStore.currentUser?.id else { return nil }
        return UserDefaults.standard.string(forKey: deviceIdKey(for: userId))
    }

    /// Upload the stored token to the server. Returns the device UUID on
    /// success, nil on failure or if no token is available yet. The caller
    /// (DevicesViewModel) surfaces any error itself.
    func registerCurrentDevice(name: String?) async -> String? {
        guard let env, let token = deviceTokenHex,
              env.authStore.isAuthenticated else { return nil }
        let result: APIResult<RegisterDeviceResponse> = await env.apiClient.request(
            .registerDevice(token: token, platform: "ios", name: name)
        )
        if case .success(let resp) = result, let userId = env.authStore.currentUser?.id {
            UserDefaults.standard.set(resp.id, forKey: deviceIdKey(for: userId))
            return resp.id
        }
        return nil
    }

    /// Drop the current token server-side. Call before tearing down the session
    /// on sign-out, while the access token is still valid, so this device stops
    /// receiving pushes for the account it's leaving.
    func removeToken() async {
        guard let env, let token = deviceTokenHex else { return }
        _ = await env.apiClient.requestEmpty(.unregisterDevice(token: token))
        if let userId = env.authStore.currentUser?.id {
            UserDefaults.standard.removeObject(forKey: deviceIdKey(for: userId))
        }
    }

    // UserDefaults key that ties a device registration to one account. Scoped
    // by userId so switching accounts doesn't bleed the wrong device id over.
    private func deviceIdKey(for userId: String) -> String {
        "counter_device_id_\(userId)"
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// While the app is foregrounded the live notification socket already folds
    /// the event into the tab badge and lists, so suppress the banner and sound
    /// to avoid a duplicate. Keep the badge and the notification-center entry so
    /// nothing is lost if the user wasn't looking at the relevant screen.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.badge, .list]
    }

    /// Route a tapped notification to the screen it points at, using the custom
    /// keys the server attached (see services/apns.ts).
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let info = response.notification.request.content.userInfo
        guard let destination = Self.destination(from: info) else { return }
        env?.pushRouter.pending = destination
    }

    /// Map a push payload to an in-app destination. The app navigates by handle,
    /// so a message opens the sender's thread, a follow the follower's profile,
    /// and any post-bearing type opens the thread.
    static func destination(from info: [AnyHashable: Any]) -> AppDestination? {
        let type = info["type"] as? String
        let actor = info["actorUsername"] as? String
        if type == "message", let actor {
            return .conversation(username: actor)
        }
        if let postId = info["postId"] as? String {
            return .thread(postId: postId)
        }
        if type == "follow", let actor {
            return .profile(username: actor)
        }
        return nil
    }
}

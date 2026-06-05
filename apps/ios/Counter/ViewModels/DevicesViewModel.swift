/**
 View model for the device list in Settings > Privacy > Devices.

 Loads the user's registered push devices, exposes a method to register the
 current device (opt-in, never called automatically), and deletes devices on
 request. The "this device" concept is resolved by comparing each row's id
 against the id PushService cached after the last successful registration.
 */

import Foundation
import UIKit
import Observation

@MainActor
@Observable
final class DevicesViewModel {

    private(set) var devices: [DeviceRecord] = []
    private(set) var isLoading: Bool = false
    private(set) var isRegistering: Bool = false
    var errorMessage: String?

    /// True when the OS has issued a push token this session. If false, the
    /// register button is hidden because there's nothing to upload yet.
    var canRegister: Bool { PushService.shared.hasToken }

    /// The device id stored after the last successful registration for this
    /// account. Used by the view to show a "This device" label on the matching row.
    var thisDeviceId: String? { PushService.shared.registeredDeviceId }

    private let env: AppEnvironment

    init(env: AppEnvironment) {
        self.env = env
    }

    func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        let result: APIResult<[DeviceRecord]> = await env.apiClient.request(.listDevices)
        switch result {
        case .success(let rows): devices = rows
        case .apiError(let e): errorMessage = e.message
        case .networkError: errorMessage = result.errorMessage
        }
    }

    /// Ask for notification permission (if not already granted), wait for the
    /// APNs token, upload it, and refresh the list.
    func registerThisDevice() async {
        isRegistering = true
        errorMessage = nil
        defer { isRegistering = false }

        // This prompts for permission the first time; on subsequent calls the
        // OS skips the dialog and returns the existing token immediately.
        guard await PushService.shared.requestPermissionAndGetToken() != nil else {
            errorMessage = "Notification permission was denied. Enable it in Settings > Counter."
            return
        }

        let deviceName = UIDevice.current.name
        let id = await PushService.shared.registerCurrentDevice(name: deviceName)
        if id == nil {
            errorMessage = "Could not register this device. Try again."
            return
        }
        await load()
    }

    func deleteDevice(id: String) async {
        errorMessage = nil
        let result = await env.apiClient.requestEmpty(.deleteDevice(id: id))
        if case .success = result {
            devices.removeAll { $0.id == id }
            // If this was the locally-cached device id, it's gone from the
            // server, so wipe the cache to avoid a stale "This device" label.
            if id == PushService.shared.registeredDeviceId {
                await PushService.shared.removeToken()
            }
        } else {
            errorMessage = result.errorMessage
        }
    }
}

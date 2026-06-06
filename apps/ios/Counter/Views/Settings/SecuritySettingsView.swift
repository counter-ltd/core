/**
 Security settings: set or change the account password.

 Accounts that signed up with OAuth start with no password (hasPassword false),
 so this screen offers "set a password" with no current-password field. Accounts
 that already have one must confirm it before changing. On success the screen
 refetches the private profile so `hasPassword` flips and the copy updates
 without a relaunch.
 */

import SwiftUI

struct SecuritySettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var didSave = false

    @State private var passkeys: [PasskeySummary] = []
    @State private var passkeyError: String?
    @State private var passkeyBusy = false
    // Retained for the lifetime of one enrolment ceremony.
    @State private var passkeyManager: PasskeyManager?

    /// Whether the account already has a password. Read from the live auth store
    /// so a successful set flips the form from "set" to "change" mode at once.
    private var hasPassword: Bool {
        env.authStore.currentUser?.hasPassword ?? true
    }

    private var canSubmit: Bool {
        !newPassword.isEmpty && (!hasPassword || !currentPassword.isEmpty) && !isSaving
    }

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            List {
                Section {
                    if hasPassword {
                        SecureField("Current password", text: $currentPassword)
                            .textContentType(.password)
                            .listRowBackground(theme.surface)
                    }
                    SecureField("New password", text: $newPassword)
                        .textContentType(.newPassword)
                        .listRowBackground(theme.surface)
                } header: {
                    Text(hasPassword
                        ? "Update the password you sign in with."
                        : "Your account signs in with GitHub or Discord. Add a password to also sign in directly.")
                        .font(CounterFont.body(13))
                        .foregroundStyle(theme.textDim)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(CounterFont.body(13))
                            .foregroundStyle(theme.danger)
                            .listRowBackground(theme.surface)
                    }
                }

                if didSave {
                    Section {
                        Text("Password saved.")
                            .font(CounterFont.body(13))
                            .foregroundStyle(theme.accent)
                            .listRowBackground(theme.surface)
                    }
                }

                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        Text(hasPassword ? "Change password" : "Set password")
                            .font(CounterFont.body(14))
                            .foregroundStyle(canSubmit ? theme.accent : theme.textDim)
                    }
                    .disabled(!canSubmit)
                    .listRowBackground(theme.surface)
                }

                passkeySection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Security")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadPasskeys() }
    }

    // MARK: - Passkeys

    @ViewBuilder
    private var passkeySection: some View {
        Section {
            ForEach(passkeys) { key in
                VStack(alignment: .leading, spacing: 2) {
                    Text(key.nickname?.isEmpty == false ? key.nickname! : "Passkey")
                        .font(CounterFont.body(14))
                        .foregroundStyle(theme.text)
                    Text("Added \(shortDate(key.createdAt))")
                        .font(CounterFont.mono(11))
                        .foregroundStyle(theme.textDim)
                }
                .listRowBackground(theme.surface)
                // Swipe to remove, matching the rest of the app's list affordances.
                .swipeActions {
                    Button("Remove", role: .destructive) {
                        Task { await removePasskey(key) }
                    }
                }
            }

            Button {
                Task { await addPasskey() }
            } label: {
                Text(passkeyBusy ? "Waiting for passkey…" : "Add a passkey")
                    .font(CounterFont.body(14))
                    .foregroundStyle(passkeyBusy ? theme.textDim : theme.accent)
            }
            .disabled(passkeyBusy)
            .listRowBackground(theme.surface)

            if let passkeyError {
                Text(passkeyError)
                    .font(CounterFont.body(13))
                    .foregroundStyle(theme.danger)
                    .listRowBackground(theme.surface)
            }
        } header: {
            Text("Passkeys")
                .font(CounterFont.body(13))
                .foregroundStyle(theme.textDim)
        } footer: {
            Text("Sign in with Face ID, Touch ID, or a security key instead of a password.")
                .font(CounterFont.body(12))
                .foregroundStyle(theme.textDim)
        }
    }

    private func loadPasskeys() async {
        let result: APIResult<[PasskeySummary]> = await env.apiClient.request(.passkeys)
        if case .success(let list) = result { passkeys = list }
    }

    private func addPasskey() async {
        passkeyError = nil
        passkeyBusy = true
        defer { passkeyBusy = false }

        let optionsResult: APIResult<PasskeyRegistrationOptions> =
            await env.apiClient.request(.passkeyRegisterOptions)
        guard case .success(let options) = optionsResult else {
            passkeyError = optionsResult.errorMessage
            return
        }

        let manager = PasskeyManager()
        passkeyManager = manager
        do {
            let attestation = try await manager.register(options: options)
            let verify = await env.apiClient.requestEmpty(
                .passkeyRegisterVerify(response: attestation, nickname: nil),
            )
            guard case .success = verify else {
                passkeyError = verify.errorMessage
                return
            }
            await loadPasskeys()
        } catch {
            // A cancelled system sheet is not an error worth showing.
            if !PasskeyError.isCancellation(error) { passkeyError = error.localizedDescription }
        }
    }

    private func removePasskey(_ key: PasskeySummary) async {
        let result = await env.apiClient.requestEmpty(.deletePasskey(id: key.id))
        if case .success = result {
            passkeys.removeAll { $0.id == key.id }
        } else {
            passkeyError = result.errorMessage
        }
    }

    /// Render an ISO-8601 timestamp as a short local date, falling back to the raw
    /// string if it doesn't parse (a newer server format shouldn't crash the row).
    private func shortDate(_ iso: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let date = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let date else { return iso }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        didSave = false
        defer { isSaving = false }

        // Send the current password only in change mode; set mode has none.
        let result = await env.apiClient.requestEmpty(
            .setPassword(currentPassword: hasPassword ? currentPassword : nil, newPassword: newPassword),
        )
        guard case .success = result else {
            errorMessage = result.errorMessage
            return
        }

        // Refetch the profile so hasPassword reflects the new state (a first-time
        // set flips the form into change mode). A failed refetch is harmless: the
        // password still changed, the copy just lags until the next load.
        let me: APIResult<PrivateUser> = await env.apiClient.request(.me)
        if case .success(let user) = me {
            env.authStore.updateUser(user)
        }

        currentPassword = ""
        newPassword = ""
        didSave = true
    }
}

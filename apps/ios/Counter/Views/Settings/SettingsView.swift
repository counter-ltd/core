/**
 Settings root: profile editing, appearance, notifications, privacy, account
 switcher, sign out, and account deletion.

 The account switcher mirrors the web's nav footer. Accounts are shown as
 a list; tapping one switches immediately. A "Add account" row pushes to
 `AuthFlowView` in add-account mode.

 Privacy navigates to `DevicesView` where the user controls which devices
 receive push notifications. Registration is always opt-in from there.
 */

import SwiftUI

struct SettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme
    @State private var displayName: String = ""
    @State private var bio: String = ""
    @State private var avatarUrl: String = ""
    @State private var isSaving: Bool = false
    @State private var saveError: String?
    @State private var showDeleteConfirm = false
    @State private var deleteConfirmText = ""
    @State private var showAddAccount = false
    @State private var notifyVM: NotificationSettingsViewModel?

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            List {
                profileSection
                appearanceSection
                notificationsSection
                privacySection
                accountsSection
                dangerSection
                aboutSection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            prefillProfile()
            // Lazy-init and load the toggles the first time Settings appears.
            if notifyVM == nil {
                let vm = NotificationSettingsViewModel(env: env)
                notifyVM = vm
                Task { await vm.load() }
            }
        }
        .sheet(isPresented: $showAddAccount) {
            // Dismiss the sheet once the new account is signed in; the app is
            // already authenticated, so nothing else would close it.
            AuthFlowView(onComplete: { showAddAccount = false })
        }
        .alert("Delete account", isPresented: $showDeleteConfirm) {
            TextField("Type DELETE to confirm", text: $deleteConfirmText)
                .autocapitalization(.allCharacters)
            Button("Delete", role: .destructive) {
                guard deleteConfirmText == "DELETE" else { return }
                Task { await env.deleteAccount() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes your account and all your posts. There is no undo.")
        }
    }

    // MARK: - Sections

    private var profileSection: some View {
        Section("Profile") {
            VStack(alignment: .leading, spacing: CounterSpacing.md) {
                labeledField("Display name", text: $displayName)
                labeledField("Bio", text: $bio)
                labeledField("Avatar URL", text: $avatarUrl, keyboard: .URL)

                if let error = saveError {
                    Text(error)
                        .font(CounterFont.body(13))
                        .foregroundStyle(theme.danger)
                }

                Button {
                    Task { await saveProfile() }
                } label: {
                    if isSaving {
                        ProgressView().tint(.black)
                    } else {
                        Text("Save changes")
                    }
                }
                .counterPrimaryButton(isLoading: isSaving)
                .disabled(isSaving)
            }
            .padding(.vertical, CounterSpacing.sm)
            .listRowBackground(theme.surface)
        }
    }

    private var appearanceSection: some View {
        Section("Appearance") {
            NavigationLink {
                ThemeSettingsView()
            } label: {
                Label("Theme", systemImage: "paintpalette")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
            }
            .listRowBackground(theme.surface)
        }
    }

    @ViewBuilder
    private var notificationsSection: some View {
        Section {
            if let notifyVM {
                @Bindable var vm = notifyVM
                Toggle("Likes", isOn: $vm.prefs.like)
                Toggle("Reposts", isOn: $vm.prefs.repost)
                Toggle("Replies", isOn: $vm.prefs.reply)
                Toggle("New followers", isOn: $vm.prefs.follow)
                Toggle("Mentions", isOn: $vm.prefs.mention)
                Toggle("Direct messages", isOn: $vm.prefs.message)

                if let error = vm.errorMessage {
                    Text(error)
                        .font(CounterFont.body(13))
                        .foregroundStyle(theme.danger)
                }

                Button {
                    Task { await vm.save() }
                } label: {
                    if vm.isSaving {
                        ProgressView().tint(.black)
                    } else {
                        Text("Save")
                    }
                }
                .counterPrimaryButton(isLoading: vm.isSaving)
                .disabled(vm.isSaving)
            }
        } header: {
            Text("Notifications")
        } footer: {
            Text("Choose what you're notified about, in the app and on your phone. Turning a type off stops it everywhere.")
        }
        .tint(theme.accent)
        .font(CounterFont.body(14))
        .foregroundStyle(theme.text)
        .listRowBackground(theme.surface)
    }

    private var privacySection: some View {
        Section("Privacy") {
            NavigationLink {
                PresenceSettingsView()
            } label: {
                Label("Online Status", systemImage: "dot.radiowaves.left.and.right")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
            }
            .listRowBackground(theme.surface)

            NavigationLink {
                DevicesView()
            } label: {
                Label("Devices", systemImage: "iphone")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
            }
            .listRowBackground(theme.surface)
        }
    }

    private var accountsSection: some View {
        Section("Accounts") {
            ForEach(env.accountStore.accounts) { account in
                HStack(spacing: CounterSpacing.md) {
                    // Placeholder avatar (no PublicUser available in StoredAccount).
                    Circle()
                        .fill(theme.surface)
                        .frame(width: 32, height: 32)
                        .overlay(
                            Text(String((account.displayName ?? account.username).prefix(1)).uppercased())
                                .font(.system(size: 13, design: .monospaced))
                                .foregroundStyle(theme.textDim)
                        )

                    VStack(alignment: .leading, spacing: 2) {
                        Text(account.displayName ?? account.username)
                            .font(CounterFont.body(14))
                            .foregroundStyle(theme.text)
                        Text("@\(account.username)")
                            .font(CounterFont.mono(12))
                            .foregroundStyle(theme.textDim)
                    }

                    Spacer()

                    if account.id == env.authStore.currentUser?.id {
                        Image(systemName: "checkmark")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.accent)
                    }
                }
                .contentShape(Rectangle())
                .onTapGesture {
                    guard account.id != env.authStore.currentUser?.id else { return }
                    Task { await env.switchAccount(to: account.id) }
                }
                .listRowBackground(theme.surface)
            }

            Button {
                showAddAccount = true
            } label: {
                Label("Add account", systemImage: "plus.circle")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.accent)
            }
            .listRowBackground(theme.surface)

            Button("Sign out", role: .destructive) {
                Task { await env.signOut() }
            }
            .font(CounterFont.body(14))
            .listRowBackground(theme.surface)
        }
    }

    private var dangerSection: some View {
        Section("Danger zone") {
            Button("Delete account", role: .destructive) {
                showDeleteConfirm = true
            }
            .font(CounterFont.body(14))
            .listRowBackground(theme.surface)
        }
    }

    private var aboutSection: some View {
        Section("About") {
            Link(destination: URL(string: "https://counter.ltd")!) {
                HStack {
                    Text("Built with Counter")
                        .font(CounterFont.mono(13))
                        .foregroundStyle(theme.textDim)
                    Spacer()
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 11))
                        .foregroundStyle(theme.textDim)
                }
            }
            .listRowBackground(theme.surface)
        }
    }

    // MARK: - Helpers

    private func labeledField(_ label: String, text: Binding<String>, keyboard: UIKeyboardType = .default) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(CounterFont.mono(11))
                .foregroundStyle(theme.textDim)
            TextField(label, text: text)
                .font(CounterFont.body(14))
                .keyboardType(keyboard)
                .autocapitalization(.none)
                .counterInput()
        }
    }

    private func prefillProfile() {
        guard let user = env.authStore.currentUser else { return }
        displayName = user.displayName ?? ""
        bio = user.bio ?? ""
        avatarUrl = user.avatarUrl ?? ""
    }

    private func saveProfile() async {
        isSaving = true
        saveError = nil
        defer { isSaving = false }

        let result: APIResult<PrivateUser> = await env.apiClient.request(
            .updateProfile(
                displayName: displayName.isEmpty ? nil : displayName,
                bio: bio.isEmpty ? nil : bio,
                avatarUrl: avatarUrl.isEmpty ? nil : avatarUrl
            )
        )
        switch result {
        case .success(let user):
            env.authStore.updateUser(user)
        case .apiError(let e):
            saveError = e.message
        case .networkError:
            saveError = result.errorMessage
        }
    }
}

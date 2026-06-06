/**
 Settings root: navigation hub for profile, appearance, notifications, privacy,
 connections, account management, and account deletion.

 Each major area is a dedicated sub-page. The account switcher mirrors the web
 nav footer — tapping an account switches immediately, and "Add account" pushes
 AuthFlowView in add-account mode.
 */

import SwiftUI

struct SettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme
    @State private var showDeleteConfirm = false
    @State private var deleteConfirmText = ""
    @State private var showAddAccount = false

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            List {
                profileSection
                appearanceSection
                notificationsSection
                privacySection
                connectionsSection
                integrationsSection
                adminSection
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
            NavigationLink {
                ProfileSettingsView()
            } label: {
                Label("Edit profile", systemImage: "person.circle")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
            }
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

    private var notificationsSection: some View {
        Section("Notifications") {
            NavigationLink {
                NotificationSettingsView()
            } label: {
                Label("Notifications", systemImage: "bell")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
            }
            .listRowBackground(theme.surface)
        }
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

            NavigationLink {
                SecuritySettingsView()
            } label: {
                Label("Password & passkeys", systemImage: "key")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
            }
            .listRowBackground(theme.surface)
        }
    }

    private var connectionsSection: some View {
        Section("Connections") {
            NavigationLink {
                ConnectionsView()
            } label: {
                Label("Connected platforms", systemImage: "link")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
            }
            .listRowBackground(theme.surface)
        }
    }

    private var integrationsSection: some View {
        Section("Integrations") {
            NavigationLink {
                IntegrationsView()
            } label: {
                Label("Integrations", systemImage: "puzzlepiece.extension")
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

    // Only rendered for accounts that hold at least one admin permission.
    // @ViewBuilder so it collapses to nothing for regular users.
    @ViewBuilder
    private var adminSection: some View {
        if env.authStore.currentUser?.isAdmin == true {
            Section("Admin") {
                NavigationLink {
                    AdminView()
                } label: {
                    Label("Control panel", systemImage: "shield.lefthalf.filled")
                        .font(CounterFont.body(14))
                        .foregroundStyle(theme.text)
                }
                .listRowBackground(theme.surface)
            }
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
            NavigationLink {
                AlgorithmView()
            } label: {
                Label("The algorithm", systemImage: "function")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
            }
            .listRowBackground(theme.surface)

            externalLink(label: "Changelog", url: "https://counter.ltd/changelog")
            externalLink(label: "Your data", url: "https://counter.ltd/data")
            externalLink(label: "counter.ltd", url: "https://counter.ltd")
        }
    }

    @ViewBuilder
    private func externalLink(label: String, url: String) -> some View {
        Link(destination: URL(string: url)!) {
            HStack {
                Text(label)
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
                Spacer()
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11))
                    .foregroundStyle(theme.textDim)
            }
        }
        .listRowBackground(theme.surface)
    }
}

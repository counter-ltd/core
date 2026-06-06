/**
 Integrations settings: Thing Two (Discord bot) configuration.

 Thing Two lets you receive Counter notifications as Discord DMs and post
 directly from Discord using /post or "Share to Counter". Both require a
 linked Discord account. Enabling notifications also requires Counter server
 membership; the API returns a not_in_guild error if that check fails.
 */

import SwiftUI

struct IntegrationsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme
    @State private var settings: DiscordBotSettings?
    @State private var discordAccount: OAuthConnectedAccount?
    @State private var isLoading = false
    @State private var notificationsEnabled: Bool = false
    @State private var postingEnabled: Bool = false
    @State private var notificationsError: String?
    @State private var notificationsNotInGuild = false
    @State private var postingError: String?

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            List {
                thingTwoSection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Integrations")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    // MARK: - Thing Two section

    private var thingTwoSection: some View {
        Section {
            // Header row: logo, name, active badge.
            HStack(spacing: CounterSpacing.sm) {
                Image("discord-logo")
                    .brandLogo(size: 18)
                    .foregroundStyle(theme.text)
                Text("Thing Two")
                    .font(CounterFont.body(14).weight(.semibold))
                    .foregroundStyle(theme.text)
                if settings?.enabled == true {
                    Text("✦ active")
                        .font(CounterFont.mono(11))
                        .foregroundStyle(theme.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(theme.accent.opacity(0.12))
                        .clipShape(Capsule())
                }
            }
            .listRowBackground(theme.surface)

            if discordAccount == nil {
                // Discord must be linked before either toggle can be used.
                Text("Connect your Discord account in Connections settings to enable Thing Two.")
                    .font(CounterFont.body(13))
                    .foregroundStyle(theme.textDim)
                    .listRowBackground(theme.surface)
            } else {
                notificationsRow
                postingRow
            }
        } header: {
            Text("Thing Two")
        } footer: {
            Text("Thing Two connects Counter to Discord. Notifications requires Counter server membership.")
        }
    }

    // MARK: - Toggle rows

    @ViewBuilder
    private var notificationsRow: some View {
        Toggle(isOn: $notificationsEnabled) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Notifications")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
                Text("Receive Counter notifications as Discord DMs.")
                    .font(CounterFont.body(12))
                    .foregroundStyle(theme.textDim)
            }
        }
        .tint(theme.accent)
        .onChange(of: notificationsEnabled) { _, newValue in
            Task { await toggleNotifications(to: newValue) }
        }
        .listRowBackground(theme.surface)

        if notificationsNotInGuild {
            HStack(spacing: 4) {
                Text("Join the Counter server first.")
                    .font(CounterFont.body(12))
                    .foregroundStyle(theme.danger)
                Link("Join here", destination: URL(string: "https://counter.ltd/discord")!)
                    .font(CounterFont.body(12))
                    .foregroundStyle(theme.accent)
            }
            .listRowBackground(theme.surface)
        } else if let error = notificationsError {
            Text(error)
                .font(CounterFont.body(12))
                .foregroundStyle(theme.danger)
                .listRowBackground(theme.surface)
        }
    }

    @ViewBuilder
    private var postingRow: some View {
        Toggle(isOn: $postingEnabled) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Post from Discord")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
                Text("Use /post or right-click \u{2192} \"Share to Counter\" in Discord.")
                    .font(CounterFont.body(12))
                    .foregroundStyle(theme.textDim)
            }
        }
        .tint(theme.accent)
        .onChange(of: postingEnabled) { _, newValue in
            Task { await togglePosting(to: newValue) }
        }
        .listRowBackground(theme.surface)

        if let error = postingError {
            Text(error)
                .font(CounterFont.body(12))
                .foregroundStyle(theme.danger)
                .listRowBackground(theme.surface)
        }
    }

    // MARK: - Data

    private func load() async {
        isLoading = true
        defer { isLoading = false }

        // Fetch both in parallel; 404 on discord account means not connected.
        async let settingsResult: APIResult<DiscordBotSettings> =
            env.apiClient.request(.discordBotSettings)
        async let discordResult: APIResult<OAuthConnectedAccount> =
            env.apiClient.request(.oauthConnectedAccount(provider: .discord))

        let (s, d) = await (settingsResult, discordResult)

        if case .success(let v) = s {
            settings = v
            notificationsEnabled = v.enabled
            postingEnabled = v.postingEnabled
        }
        if case .success(let a) = d { discordAccount = a } else { discordAccount = nil }
    }

    private func toggleNotifications(to newValue: Bool) async {
        notificationsError = nil
        notificationsNotInGuild = false

        let input = UpdateDiscordBotSettingsInput(enabled: newValue, postingEnabled: nil)
        let result: APIResult<DiscordBotSettings> =
            await env.apiClient.request(.updateDiscordBotSettings(input))

        switch result {
        case .success(let updated):
            settings = updated
            notificationsEnabled = updated.enabled
        case .apiError(let e) where e.code == "not_in_guild":
            notificationsNotInGuild = true
            // Revert the toggle — the API rejected the change.
            notificationsEnabled = !newValue
        case .apiError(let e):
            notificationsError = e.message
            notificationsEnabled = !newValue
        case .networkError:
            notificationsError = result.errorMessage
            notificationsEnabled = !newValue
        }
    }

    private func togglePosting(to newValue: Bool) async {
        postingError = nil

        // Carry the current notifications state so this toggle doesn't reset it.
        let currentEnabled = settings?.enabled ?? false
        let input = UpdateDiscordBotSettingsInput(enabled: currentEnabled, postingEnabled: newValue)
        let result: APIResult<DiscordBotSettings> =
            await env.apiClient.request(.updateDiscordBotSettings(input))

        switch result {
        case .success(let updated):
            settings = updated
            postingEnabled = updated.postingEnabled
        case .apiError(let e):
            postingError = e.message
            // Revert the toggle — the API rejected the change.
            postingEnabled = !newValue
        case .networkError:
            postingError = result.errorMessage
            postingEnabled = !newValue
        }
    }
}

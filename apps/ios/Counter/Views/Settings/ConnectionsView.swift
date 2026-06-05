/**
 Connections: link and unlink OAuth accounts (GitHub, Discord).

 Each row shows the connected username or "Not connected" and a button to
 connect or disconnect. Connecting opens a browser-based OAuth flow managed
 by AppEnvironment. Verified connections unlock badge display in Profile
 settings.
 */

import SwiftUI

struct ConnectionsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme
    @State private var githubAccount: OAuthConnectedAccount?
    @State private var discordAccount: OAuthConnectedAccount?

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            List {
                platformsSection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Connections")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadConnectedAccounts() }
    }

    private var platformsSection: some View {
        Section("Connected platforms") {
            platformRow(name: "GitHub", account: githubAccount, provider: .github)
            platformRow(name: "Discord", account: discordAccount, provider: .discord)
        }
    }

    @ViewBuilder
    private func platformRow(name: String, account: OAuthConnectedAccount?, provider: OAuthProvider) -> some View {
        HStack {
            // Logo asset names track the OAuth provider so the row icon matches
            // the buttons on the auth screens.
            Image(provider == .github ? "github-logo" : "discord-logo")
                .brandLogo(size: 18)
                .foregroundStyle(theme.text)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
                if let account {
                    Text("@\(account.providerUsername ?? "")")
                        .font(CounterFont.mono(12))
                        .foregroundStyle(theme.textDim)
                } else {
                    Text("Not connected")
                        .font(CounterFont.mono(12))
                        .foregroundStyle(theme.textDim)
                }
            }
            Spacer()
            if account != nil {
                Button("Disconnect", role: .destructive) {
                    Task {
                        _ = await env.apiClient.requestEmpty(.oauthDisconnect(provider: provider))
                        await loadConnectedAccounts()
                    }
                }
                .font(CounterFont.body(13))
            } else {
                Button("Connect") {
                    Task {
                        await env.oauthConnect(provider: provider)
                        await loadConnectedAccounts()
                    }
                }
                .font(CounterFont.body(13))
                .foregroundStyle(theme.accent)
            }
        }
        .listRowBackground(theme.surface)
    }

    private func loadConnectedAccounts() async {
        async let ghResult: APIResult<OAuthConnectedAccount> = env.apiClient.request(.oauthConnectedAccount(provider: .github))
        async let dcResult: APIResult<OAuthConnectedAccount> = env.apiClient.request(.oauthConnectedAccount(provider: .discord))
        let (gh, dc) = await (ghResult, dcResult)
        // 404 means not connected; any other result populates the account.
        if case .success(let a) = gh { githubAccount = a } else { githubAccount = nil }
        if case .success(let a) = dc { discordAccount = a } else { discordAccount = nil }
    }
}

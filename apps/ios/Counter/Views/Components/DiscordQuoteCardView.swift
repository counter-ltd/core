/**
 Renders a Discord message shared to Counter via the "Share to Counter" command.

 Shows the quoted content in a card with a Discord-blurple left accent border and
 a Discord logo badge in the top-right corner. The author name links to their
 Counter profile when their Discord account is connected, otherwise to their
 Discord profile with a two-tap confirmation: first tap reveals the domain, second
 tap opens Safari. Matches the layout of DiscordQuoteCard.svelte on web.
 */

import SwiftUI

struct DiscordQuoteCardView: View {
    @Environment(\.counterTheme) private var theme
    @Environment(\.openURL) private var openURL

    let meta: DiscordShareMeta

    @State private var showExternalWarning = false

    // Discord brand color — outside the theme palette, always blurple.
    private let blurple = Color(red: 88 / 255, green: 101 / 255, blue: 242 / 255)

    private var discordHandle: String {
        guard let tag = meta.authorDiscordTag else { return meta.authorName }
        return "\(meta.authorName)#\(tag)"
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            HStack(spacing: 0) {
                // Left accent bar mirrors web's `border-left: 3px solid #5865f2`.
                Rectangle()
                    .fill(blurple)
                    .frame(width: 3)

                VStack(alignment: .leading, spacing: CounterSpacing.sm) {
                    Text(meta.content)
                        .font(CounterFont.body(14))
                        .foregroundStyle(theme.text)
                        .lineLimit(8)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    attribution
                }
                .padding(CounterSpacing.md)
            }
            .background(
                // Approximate `color-mix(surface 95%, blurple 5%)`.
                blurple.opacity(0.05).background(theme.surface)
            )
            .clipShape(RoundedRectangle(cornerRadius: CounterRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: CounterRadius.md)
                    .stroke(blurple.opacity(0.3), lineWidth: 1)
            )

            // Template asset so foregroundStyle tints it blurple.
            Image("discord-logo")
                .resizable()
                .renderingMode(.template)
                .foregroundStyle(blurple.opacity(0.7))
                .frame(width: 14, height: 14)
                .padding(CounterSpacing.sm)
        }
    }

    @ViewBuilder
    private var attribution: some View {
        HStack(spacing: 4) {
            // The author's Discord avatar, ingested into our storage on share.
            // Absent on default avatars or pre-ingest cards; fall back to a dash.
            if let avatar = meta.authorAvatarUrl, let url = URL(string: avatar) {
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Circle().fill(theme.surface)
                }
                .frame(width: 18, height: 18)
                .clipShape(Circle())
            } else {
                Text("—")
                    .foregroundStyle(theme.textDim)
            }

            Button {
                handleDiscordLinkTap()
            } label: {
                Text(discordHandle)
                    .fontWeight(.medium)
                    .foregroundStyle(theme.accent)
            }
            .buttonStyle(.plain)

            if showExternalWarning {
                Text("discord.com — tap again to open")
                    .foregroundStyle(theme.textDim)
            } else if let username = meta.authorCounterUsername {
                // Tight spacing so "(", the link, and ")" read as one token.
                HStack(spacing: 0) {
                    Text("(").foregroundStyle(theme.textDim)
                    NavigationLink(value: AppDestination.profile(username: username)) {
                        Text("@\(username)")
                            .fontWeight(.medium)
                            .foregroundStyle(theme.accent)
                    }
                    .buttonStyle(.plain)
                    Text(")").foregroundStyle(theme.textDim)
                }
            } else {
                Text("on Discord")
                    .foregroundStyle(theme.textDim)
            }
        }
        .font(CounterFont.body(12))
    }

    private func handleDiscordLinkTap() {
        guard let url = URL(string: "https://discord.com/users/\(meta.authorDiscordId)") else { return }
        if showExternalWarning {
            openURL(url)
            showExternalWarning = false
        } else {
            // First tap: show the destination domain so the user knows where they're going.
            showExternalWarning = true
        }
    }
}

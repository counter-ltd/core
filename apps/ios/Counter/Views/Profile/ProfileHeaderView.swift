/**
 The header section of a user profile: avatar, name, bio, stats, follow button.

 Counts are linked to the followers/following lists via `NavigationLink`.
 The follow button only appears when the viewer is authenticated and not
 viewing their own profile.
 */

import SwiftUI

struct ProfileHeaderView: View {
    @Environment(\.counterTheme) private var theme
    let user: PublicUser
    var onFollow: (() -> Void)? = nil

    @Environment(AppEnvironment.self) private var env

    var body: some View {
        VStack(alignment: .leading, spacing: CounterSpacing.lg) {
            HStack(alignment: .top) {
                AvatarView(user: user, size: 64)

                Spacer()

                if env.authStore.isAuthenticated, user.viewer?.isSelf != true {
                    followButton
                }
            }

            VStack(alignment: .leading, spacing: CounterSpacing.xs) {
                HStack(spacing: CounterSpacing.xs) {
                    Text(user.displayName ?? user.username)
                        .font(CounterFont.heading(20))
                        .foregroundStyle(theme.text)

                    if user.verified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(theme.accent)
                    }

                    // Pulsing dot signals a live session, so it's shown only when
                    // the server confirmed the user is currently online.
                    if user.presence?.isOnline == true {
                        Circle()
                            .fill(Color.green)
                            .frame(width: 9, height: 9)
                            .opacity(0.9)
                    }
                }

                HStack(spacing: CounterSpacing.xs) {
                    Text("@\(user.username)")
                        .font(CounterFont.mono(13))
                        .foregroundStyle(theme.textDim)

                    // Show last seen only when the user is offline and the field
                    // is visible to this viewer.
                    if user.presence?.isOnline != true,
                       let lastSeenAt = user.presence?.lastSeenAt {
                        Text("· \(timeAgo(lastSeenAt))")
                            .font(CounterFont.mono(12))
                            .foregroundStyle(theme.textDim)
                    }
                }

                if let bio = user.bio, !bio.isEmpty {
                    Text(bio)
                        .font(CounterFont.body(15))
                        .foregroundStyle(theme.text)
                        .padding(.top, CounterSpacing.xs)
                }
            }

            if let signals = user.signals, !signals.isEmpty {
                platformBadgesRow(signals)
            }

            HStack(spacing: CounterSpacing.xl) {
                statLink(count: user.counts.posts, label: "posts", destination: nil)
                statLink(count: user.counts.followers, label: "followers",
                         destination: .followers(username: user.username))
                statLink(count: user.counts.following, label: "following",
                         destination: .following(username: user.username))
            }
            .font(CounterFont.mono(13))
        }
        .padding(CounterSpacing.lg)
    }

    // MARK: - Badges

    @ViewBuilder
    private func platformBadgesRow(_ signals: [TrustBadge]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: CounterSpacing.sm) {
                ForEach(signals, id: \.label) { badge in
                    badgeChip(badge)
                }
            }
        }
    }

    @ViewBuilder
    private func badgeChip(_ badge: TrustBadge) -> some View {
        let chip = HStack(spacing: 5) {
            platformIcon(badge.platform)
                .frame(width: 13, height: 13)
            Text(badge.detail.map { "@\($0)" } ?? badge.label)
                .font(CounterFont.mono(11))
                .foregroundStyle(theme.accent)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(theme.surface)
        .overlay(Capsule().strokeBorder(theme.border, lineWidth: 0.5))
        .clipShape(Capsule())

        // GitHub and Discord have known public profile URLs; make those tappable.
        if let href = badge.href, let url = URL(string: href) {
            Link(destination: url) { chip }
        } else {
            chip
        }
    }

    @ViewBuilder
    private func platformIcon(_ platform: String?) -> some View {
        switch platform {
        case "github":
            Image("github-logo")
                .brandLogo(size: 13)
                .foregroundStyle(theme.accent)
        case "discord":
            Image("discord-logo")
                .brandLogo(size: 13)
                .foregroundStyle(theme.accent)
        default:
            // Generic fallback for platforms without a dedicated asset.
            Text("✦")
                .font(.system(size: 10))
                .foregroundStyle(theme.accent)
        }
    }

    // MARK: - Follow button

    private var followButton: some View {
        Button {
            onFollow?()
        } label: {
            let following = user.viewer?.isFollowing ?? false
            Text(following ? "Following" : "Follow")
                .font(CounterFont.mono(13))
                .fontWeight(.medium)
                .foregroundStyle(following ? theme.textDim : Color.black)
                .padding(.horizontal, CounterSpacing.lg)
                .padding(.vertical, 8)
                .background(following ? theme.surface : theme.accent)
                .clipShape(Capsule())
                .overlay(
                    Capsule().strokeBorder(theme.border, lineWidth: (user.viewer?.isFollowing ?? false) ? 0.5 : 0)
                )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func statLink(count: Int, label: String, destination: AppDestination?) -> some View {
        if let destination {
            NavigationLink(value: destination) {
                statView(count: count, label: label)
            }
            .buttonStyle(.plain)
        } else {
            statView(count: count, label: label)
        }
    }

    private func statView(count: Int, label: String) -> some View {
        VStack(spacing: 0) {
            Text(compact(count))
                .foregroundStyle(theme.text)
                .fontWeight(.medium)
            Text(label)
                .foregroundStyle(theme.textDim)
        }
    }

    /// Short relative time string from an ISO 8601 timestamp.
    private func timeAgo(_ iso: String) -> String {
        guard let date = parseISO(iso) else { return "" }
        let diff = Int(Date().timeIntervalSince(date))
        if diff < 60 { return "just now" }
        if diff < 3600 { return "\(diff / 60)m ago" }
        if diff < 86400 { return "\(diff / 3600)h ago" }
        return "\(diff / 86400)d ago"
    }
}

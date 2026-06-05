/**
 A compact user row for lists (followers, following, search results).

 Shows avatar, display name, handle, and an optional follow/unfollow button.
 The follow action is passed as a closure so the parent view model handles
 the optimistic update.
 */

import SwiftUI

struct UserRowView: View {
    @Environment(\.counterTheme) private var theme
    let user: PublicUser
    var onFollow: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: CounterSpacing.md) {
            AvatarView(user: user, size: 40)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: CounterSpacing.xs) {
                    Text(user.displayName ?? user.username)
                        .font(CounterFont.body(15))
                        .foregroundStyle(theme.text)
                        .fontWeight(.medium)

                    if user.verified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 11))
                            .foregroundStyle(theme.accent)
                    }
                }

                Text("@\(user.username)")
                    .font(CounterFont.mono(12))
                    .foregroundStyle(theme.textDim)
            }

            Spacer()

            if let onFollow, user.viewer?.isSelf != true {
                followButton(isFollowing: user.viewer?.isFollowing ?? false, action: onFollow)
            }
        }
        .padding(.vertical, CounterSpacing.sm)
    }

    private func followButton(isFollowing: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(isFollowing ? "Following" : "Follow")
                .font(CounterFont.mono(12))
                .fontWeight(.medium)
                .foregroundStyle(isFollowing ? theme.textDim : Color.black)
                .padding(.horizontal, CounterSpacing.md)
                .padding(.vertical, 6)
                .background(isFollowing ? theme.surface : theme.accent)
                .clipShape(Capsule())
                .overlay(
                    Capsule().strokeBorder(theme.border, lineWidth: isFollowing ? 0.5 : 0)
                )
        }
        .buttonStyle(.plain)
    }
}

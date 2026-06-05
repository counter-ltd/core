/**
 The like / repost / reply / views action bar shown at the bottom of each post.

 Calls are routed through closures rather than binding directly to a view model
 so the same component works inside FeedView, ThreadView, and ProfileView.
 Button state is driven purely by the `post` value passed in, which the parent
 view model updates optimistically.
 */

import SwiftUI

struct PostActionBar: View {
    @Environment(\.counterTheme) private var theme
    let post: Post
    var onReply: (() -> Void)? = nil
    var onRepost: (() -> Void)? = nil
    var onLike: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: CounterSpacing.xl) {
            actionButton(
                icon: "arrowshape.turn.up.left",
                count: post.counts.replies,
                isActive: false,
                activeColor: theme.textDim,
                action: onReply
            )

            actionButton(
                icon: post.viewer?.reposted == true ? "arrow.2.squarepath" : "arrow.2.squarepath",
                count: post.counts.reposts,
                isActive: post.viewer?.reposted == true,
                activeColor: theme.repost,
                action: onRepost
            )

            actionButton(
                icon: post.viewer?.liked == true ? "heart.fill" : "heart",
                count: post.counts.likes,
                isActive: post.viewer?.liked == true,
                activeColor: theme.like,
                action: onLike
            )

            HStack(spacing: 4) {
                Image(systemName: "chart.bar")
                    .font(.system(size: 14))
                Text(compact(post.counts.views))
                    .font(CounterFont.mono(12))
            }
            .foregroundStyle(theme.textDim)

            Spacer()
        }
    }

    private func actionButton(
        icon: String,
        count: Int,
        isActive: Bool,
        activeColor: Color,
        action: (() -> Void)?
    ) -> some View {
        Button {
            action?()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                Text(compact(count))
                    .font(CounterFont.mono(12))
            }
            .foregroundStyle(isActive ? activeColor : theme.textDim)
        }
        .buttonStyle(.plain)
        // Disable if no action provided (e.g. unauthenticated, no reply from quoted post).
        .disabled(action == nil)
    }
}

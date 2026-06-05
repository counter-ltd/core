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
    /// Whether to show the moderation overflow menu. Driven by the viewer's
    /// `posts.moderate` permission; a normal account never sees it.
    var canModerate: Bool = false
    /// Whether to offer the hard, irreversible nuke. Rides its own
    /// `posts.nuke` permission, separate from `canModerate`.
    var canNuke: Bool = false
    /// Current removal state, so the menu offers Restore on an already-removed
    /// post and Remove otherwise. Tracked by the parent, not `post.deleted`
    /// directly, so the row reflects an optimistic flip without a reload.
    var isDeleted: Bool = false
    var onRemove: (() -> Void)? = nil
    var onRestore: (() -> Void)? = nil
    var onNuke: (() -> Void)? = nil

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

            if canModerate || canNuke {
                moderationMenu
            }
        }
    }

    // Moderator-only overflow at the trailing edge: remove/restore a post, and,
    // for those who hold posts.nuke, the irreversible nuke. The API enforces the
    // permissions again on the call, so this control is a convenience, not the
    // security boundary.
    private var moderationMenu: some View {
        Menu {
            if canModerate {
                if isDeleted {
                    Button {
                        onRestore?()
                    } label: {
                        Label("Restore post", systemImage: "arrow.uturn.backward")
                    }
                } else {
                    Button(role: .destructive) {
                        onRemove?()
                    } label: {
                        Label("Remove post", systemImage: "trash")
                    }
                }
            }
            if canNuke {
                Button(role: .destructive) {
                    onNuke?()
                } label: {
                    Label("Nuke post", systemImage: "trash.slash")
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15))
                .foregroundStyle(theme.textDim)
                // Pad the glyph out to a comfortable tap target without growing
                // the visual footprint of the bar.
                .frame(width: 32, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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

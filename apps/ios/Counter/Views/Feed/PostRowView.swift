/**
 A single post row in the feed or profile list.

 Renders the author header (display name, optional topic inline, handle,
 timestamp), post body with linkified mentions/hashtags, media grid, optional
 quoted post, and the action bar. Navigation to the thread is handled by a
 `NavigationLink` wrapping the row.

 When the post has `topReplies`, a thread-style continuation is rendered below
 the action bar: a vertical connector line from the main avatar, followed by
 compact reply previews (avatar + author + truncated body).
 */

import SwiftUI

struct PostRowView: View {
    @Environment(\.counterTheme) private var theme
    let post: Post
    var onLike: (() -> Void)? = nil
    var onRepost: (() -> Void)? = nil
    var onReply: (() -> Void)? = nil

    @Environment(AppEnvironment.self) private var env

    // A moderator's remove/restore flips this so the row reflects the new state
    // right away. nil means "no local override yet, trust the post's own flag".
    @State private var removedOverride: Bool? = nil

    private var topReplies: [Post] { post.topReplies ?? [] }

    // The deleted state to render: the moderator's optimistic flip wins, else
    // whatever the server sent on the post.
    private var displayDeleted: Bool { removedOverride ?? post.deleted }

    // Drives the nuke confirmation sheet. Nuke is irreversible, so it never fires
    // straight from the menu tap; the moderator has to confirm first.
    @State private var showNukeConfirm = false

    // Only post moderators get the overflow menu. A normal account's permission
    // list is empty, so this is false and the control never renders.
    private var canModerate: Bool {
        env.authStore.currentUser?.can(.postsModerate) ?? false
    }

    // The harder, separate capability: a permanent delete of the post and its
    // whole reply/repost tree.
    private var canNuke: Bool {
        env.authStore.currentUser?.can(.postsNuke) ?? false
    }

    var body: some View {
        NavigationLink(value: AppDestination.thread(postId: post.id)) {
            VStack(alignment: .leading, spacing: 0) {
                // Repost attribution header
                if let repostedBy = post.repostOf != nil ? post.author : nil, post.repostOf != nil {
                    repostHeader(user: repostedBy)
                }

                HStack(alignment: .top, spacing: CounterSpacing.md) {
                    // Avatar column; shows a connector line when replies follow.
                    VStack(spacing: 0) {
                        NavigationLink(value: AppDestination.profile(username: post.author.username)) {
                            AvatarView(user: post.author)
                        }
                        .buttonStyle(.plain)

                        if !topReplies.isEmpty {
                            threadConnector
                        }
                    }
                    .frame(width: 40)

                    VStack(alignment: .leading, spacing: CounterSpacing.sm) {
                        authorLine

                        bodyContent

                        if !post.media.isEmpty {
                            MediaGridView(items: post.media)
                        }

                        if let quoted = post.repostOf {
                            QuotedPostView(post: quoted)
                        }

                        PostActionBar(
                            post: post,
                            onReply: env.authStore.isAuthenticated ? onReply : nil,
                            onRepost: env.authStore.isAuthenticated ? onRepost : nil,
                            onLike: env.authStore.isAuthenticated ? onLike : nil,
                            canModerate: canModerate,
                            canNuke: canNuke,
                            isDeleted: displayDeleted,
                            onRemove: { Task { await moderate(remove: true) } },
                            onRestore: { Task { await moderate(remove: false) } },
                            onNuke: { showNukeConfirm = true }
                        )
                        .padding(.top, CounterSpacing.xs)
                    }
                }
                .padding(.horizontal, CounterSpacing.lg)
                .padding(.vertical, CounterSpacing.md)

                if !topReplies.isEmpty {
                    topRepliesSection
                }
            }
        }
        .buttonStyle(.plain)
        .confirmationDialog(
            "Nuke this post?",
            isPresented: $showNukeConfirm,
            titleVisibility: .visible
        ) {
            Button("Nuke post", role: .destructive) {
                Task { await nuke() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This permanently deletes the post and every reply and repost. It cannot be undone.")
        }
    }

    // MARK: - Thread connector

    // Grows to fill whatever space the content column takes, visually linking
    // the main avatar to the reply avatars below.
    private var threadConnector: some View {
        Capsule()
            .fill(theme.textDim.opacity(0.25))
            .frame(width: 2)
            .frame(maxHeight: .infinity)
            .padding(.top, CounterSpacing.xs)
    }

    // MARK: - Reply previews

    @ViewBuilder
    private var topRepliesSection: some View {
        VStack(spacing: 0) {
            ForEach(Array(topReplies.enumerated()), id: \.element.id) { idx, reply in
                replyRow(reply, isLast: idx == topReplies.count - 1)
            }
        }
    }

    private func replyRow(_ reply: Post, isLast: Bool) -> some View {
        HStack(alignment: .top, spacing: CounterSpacing.md) {
            // Avatar column continues the thread line between replies.
            VStack(spacing: 0) {
                NavigationLink(value: AppDestination.profile(username: reply.author.username)) {
                    AvatarView(user: reply.author, size: 28)
                }
                .buttonStyle(.plain)
                .padding(.top, CounterSpacing.xs)

                if !isLast {
                    threadConnector
                }
            }
            .frame(width: 40)

            VStack(alignment: .leading, spacing: 2) {
                Text(reply.author.displayName ?? reply.author.username)
                    .font(CounterFont.body(13))
                    .fontWeight(.semibold)
                    .foregroundStyle(theme.text)

                if !reply.deleted, let body = reply.body {
                    Text(body)
                        .font(CounterFont.body(13))
                        .foregroundStyle(theme.textDim)
                        .lineLimit(2)
                } else if reply.deleted {
                    Text("This post was deleted.")
                        .font(CounterFont.body(13))
                        .foregroundStyle(theme.textDim)
                        .italic()
                }
            }
            .padding(.top, CounterSpacing.sm)
            .padding(.bottom, isLast ? CounterSpacing.md : CounterSpacing.xs)
        }
        .padding(.horizontal, CounterSpacing.lg)
    }

    // MARK: - Subviews

    private var authorLine: some View {
        HStack(spacing: CounterSpacing.xs) {
            Text(post.author.username)
                .font(CounterFont.body(15))
                .fontWeight(.semibold)
                .foregroundStyle(theme.text)
                .lineLimit(1)

            if post.author.verified {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(theme.accent)
                    .fixedSize()
            }

            if let topic = post.topic {
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(theme.textDim)
                Text(topic.name)
                    .font(CounterFont.mono(12))
                    .foregroundStyle(theme.accent)
                    .lineLimit(1)
            }

            Spacer(minLength: CounterSpacing.xs)

            RelativeTimeText(isoString: post.createdAt)

            if post.edited {
                Text("edited")
                    .font(CounterFont.mono(11))
                    .foregroundStyle(theme.textDim)
            }
        }
    }

    @ViewBuilder
    private var bodyContent: some View {
        if displayDeleted {
            Text("This post was deleted.")
                .font(CounterFont.body(15))
                .foregroundStyle(theme.textDim)
                .italic()
        } else if let meta = post.sourceMeta {
            DiscordQuoteCardView(meta: meta)
        } else if let body = post.body {
            Text(linkify(body))
                .font(CounterFont.body(15))
                .foregroundStyle(theme.text)
                .environment(\.openURL, OpenURLAction { url in
                    handleInternalURL(url)
                    return .handled
                })
        }
    }

    private func repostHeader(user: PublicUser) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "arrow.2.squarepath")
                .font(.system(size: 11))
            Text("\(user.displayName ?? user.username) reposted")
                .font(CounterFont.mono(11))
        }
        .foregroundStyle(theme.textDim)
        .padding(.leading, 40 + CounterSpacing.md)
        .padding(.top, CounterSpacing.sm)
    }

    // MARK: - Moderation

    /// Remove or restore this post as a moderator, flipping the local view state
    /// on success. The API rechecks `posts.moderate`, so a failure (revoked
    /// permission, network) leaves the row untouched rather than lying about it.
    private func moderate(remove: Bool) async {
        let endpoint: Endpoint = remove ? .adminRemovePost(id: post.id) : .adminRestorePost(id: post.id)
        let result = await env.apiClient.requestEmpty(endpoint)
        if case .success = result {
            removedOverride = remove
        }
    }

    /// Permanently delete this post and its whole reply/repost tree. On success
    /// the row falls back to the deleted placeholder; the post is gone from the
    /// next feed load. A failure leaves it as-is.
    private func nuke() async {
        let result = await env.apiClient.requestEmpty(.adminNukePost(id: post.id))
        if case .success = result {
            removedOverride = true
        }
    }

    // MARK: - Internal link handling

    private func handleInternalURL(_ url: URL) {
        // counter://profile/username and counter://tag/name are synthetic
        // schemes produced by linkify(). Real external URLs open in Safari.
    }
}

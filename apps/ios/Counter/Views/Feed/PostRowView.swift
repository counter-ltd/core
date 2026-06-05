/**
 A single post row in the feed or profile list.

 Renders the author header (display name, optional topic inline, handle,
 timestamp), post body with linkified mentions/hashtags, media grid, optional
 quoted post, and the action bar. Navigation to the thread is handled by a
 `NavigationLink` wrapping the row.
 */

import SwiftUI

struct PostRowView: View {
    @Environment(\.counterTheme) private var theme
    let post: Post
    var onLike: (() -> Void)? = nil
    var onRepost: (() -> Void)? = nil
    var onReply: (() -> Void)? = nil

    @Environment(AppEnvironment.self) private var env

    var body: some View {
        NavigationLink(value: AppDestination.thread(postId: post.id)) {
            VStack(alignment: .leading, spacing: 0) {
                // Repost attribution header
                if let repostedBy = post.repostOf != nil ? post.author : nil, post.repostOf != nil {
                    repostHeader(user: repostedBy)
                }

                HStack(alignment: .top, spacing: CounterSpacing.md) {
                    NavigationLink(value: AppDestination.profile(username: post.author.username)) {
                        AvatarView(user: post.author)
                    }
                    .buttonStyle(.plain)

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
                            onLike: env.authStore.isAuthenticated ? onLike : nil
                        )
                        .padding(.top, CounterSpacing.xs)
                    }
                }
                .padding(.horizontal, CounterSpacing.lg)
                .padding(.vertical, CounterSpacing.md)
            }
        }
        .buttonStyle(.plain)
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
        if post.deleted {
            Text("This post was deleted.")
                .font(CounterFont.body(15))
                .foregroundStyle(theme.textDim)
                .italic()
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

    // MARK: - Internal link handling

    private func handleInternalURL(_ url: URL) {
        // counter://profile/username and counter://tag/name are synthetic
        // schemes produced by linkify(). Real external URLs open in Safari.
    }
}

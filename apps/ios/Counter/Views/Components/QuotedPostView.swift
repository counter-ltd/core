/**
 A compact, non-interactive preview of the post being reposted.

 Shown nested inside a `PostRowView` when the outer post is a repost.
 No action bar, no tappable elements — this is display-only so the user
 taps the parent card to navigate to the thread.
 */

import SwiftUI

struct QuotedPostView: View {
    @Environment(\.counterTheme) private var theme
    let post: PostRef

    var body: some View {
        VStack(alignment: .leading, spacing: CounterSpacing.sm) {
            HStack(spacing: CounterSpacing.sm) {
                // Quoted post uses a smaller avatar.
                if let urlString = post.author.avatarUrl, let url = URL(string: urlString) {
                    AsyncImage(url: url) { phase in
                        if case .success(let img) = phase {
                            img.resizable().scaledToFill()
                        } else {
                            theme.surface
                        }
                    }
                    .frame(width: 20, height: 20)
                    .clipShape(Circle())
                } else {
                    Circle()
                        .fill(theme.surface)
                        .frame(width: 20, height: 20)
                }

                Text(post.author.displayName ?? post.author.username)
                    .font(CounterFont.mono(12))
                    .foregroundStyle(theme.text)

                Text("@\(post.author.username)")
                    .font(CounterFont.mono(12))
                    .foregroundStyle(theme.textDim)
            }

            if post.deleted {
                Text("This post was deleted.")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.textDim)
                    .italic()
            } else if let body = post.body {
                Text(body)
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
                    .lineLimit(4)
            }
        }
        .padding(CounterSpacing.md)
        .counterPanel()
    }
}

/**
 A single row in the notification inbox.

 Renders the actor's avatar, a description of the action, and optionally
 a snippet of the involved post. Unread rows have a subtle left accent bar.
 */

import SwiftUI

struct NotificationRowView: View {
    @Environment(\.counterTheme) private var theme
    let notification: AppNotification

    var body: some View {
        HStack(alignment: .top, spacing: CounterSpacing.md) {
            // Unread indicator — a thin amber bar on the left edge.
            if !notification.read {
                Rectangle()
                    .fill(theme.accent)
                    .frame(width: 2)
                    .padding(.vertical, 4)
            }

            AvatarView(user: notification.actor, size: 36)

            VStack(alignment: .leading, spacing: CounterSpacing.xs) {
                HStack(spacing: 4) {
                    Text(notification.actor.displayName ?? notification.actor.username)
                        .fontWeight(.medium)
                        .foregroundStyle(theme.text)
                    Text(description)
                        .foregroundStyle(theme.textDim)
                    Spacer()
                    RelativeTimeText(isoString: notification.createdAt)
                }
                .font(CounterFont.body(14))

                if let snippet = postSnippet {
                    Text(snippet)
                        .font(CounterFont.body(13))
                        .foregroundStyle(theme.textDim)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, CounterSpacing.sm)
    }

    private var description: String {
        switch notification.type {
        case .like:     return "liked your post"
        case .repost:   return "reposted your post"
        case .reply:    return "replied to your post"
        case .follow:   return "followed you"
        case .mention:  return "mentioned you"
        case .message:  return "sent you a message"
        }
    }

    private var postSnippet: String? {
        notification.post?.body?.prefix(100).description
    }
}

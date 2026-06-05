/**
 A single row in the messages inbox showing a conversation preview.

 Displays the partner's avatar, name, last message snippet, and an unread
 badge count. Tapping navigates to `ConversationView` for that user.
 */

import SwiftUI

struct ConversationRowView: View {
    @Environment(\.counterTheme) private var theme
    let conversation: Conversation

    var body: some View {
        NavigationLink(value: AppDestination.conversation(username: conversation.partner.username)) {
            HStack(spacing: CounterSpacing.md) {
                AvatarView(user: conversation.partner, size: 44)

                VStack(alignment: .leading, spacing: CounterSpacing.xs) {
                    HStack {
                        Text(conversation.partner.displayName ?? conversation.partner.username)
                            .font(CounterFont.body(15))
                            .fontWeight(conversation.unreadCount > 0 ? .semibold : .regular)
                            .foregroundStyle(theme.text)

                        if conversation.partner.presence?.isOnline == true {
                            Circle()
                                .fill(Color.green)
                                .frame(width: 7, height: 7)
                        }

                        Spacer()

                        RelativeTimeText(isoString: conversation.lastMessageAt)
                    }

                    if let last = conversation.lastMessage {
                        if last.encrypted {
                            Label("Encrypted Message", systemImage: "lock.fill")
                                .font(CounterFont.body(13))
                                .foregroundStyle(theme.textDim)
                                .lineLimit(1)
                        } else {
                            Text(last.body)
                                .font(CounterFont.body(13))
                                .foregroundStyle(theme.textDim)
                                .lineLimit(1)
                        }
                    }
                }

                if conversation.unreadCount > 0 {
                    Text("\(conversation.unreadCount)")
                        .font(CounterFont.mono(11))
                        .fontWeight(.semibold)
                        .foregroundStyle(.black)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(theme.accent)
                        .clipShape(Capsule())
                }
            }
            .padding(.vertical, CounterSpacing.sm)
        }
        .buttonStyle(.plain)
    }
}

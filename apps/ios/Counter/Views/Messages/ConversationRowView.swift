/**
 A single row in the messages inbox showing a conversation preview.

 Displays the partner's avatar, name, last message snippet, and an unread
 badge count. Tapping navigates to `ConversationView` for that user.

 The lock icon color signals the security level of the last message: green for
 end-to-end encrypted (only the devices hold the keys), blue for server-side
 only (stored encrypted at rest but the server can read it). A direction arrow
 shows whether the last message was sent or received.
 */

import SwiftUI

struct ConversationRowView: View {
    @Environment(\.counterTheme) private var theme
    @Environment(AppEnvironment.self) private var env
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
                        HStack(spacing: 4) {
                            // Direction: up = sent by me, down = received
                            let isSent = last.sender.id == env.authStore.currentUser?.id
                            Image(systemName: isSent ? "arrow.up.circle.fill" : "arrow.down.circle.fill")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(isSent ? theme.textDim : theme.accent)

                            if last.encrypted {
                                Label("Encrypted Message", systemImage: "lock.fill")
                                    .font(CounterFont.body(13))
                                    // Green = E2EE (keys never leave devices)
                                    .foregroundStyle(Color.green)
                                    .lineLimit(1)
                            } else {
                                Image(systemName: "lock.fill")
                                    .font(.system(size: 11))
                                    // Blue = server-encrypted (at-rest only)
                                    .foregroundStyle(Color.blue)
                                Text(last.body)
                                    .font(CounterFont.body(13))
                                    .foregroundStyle(theme.textDim)
                                    .lineLimit(1)
                            }
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

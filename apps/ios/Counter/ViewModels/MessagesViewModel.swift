/**
 View model for the messages inbox.

 Lists all conversations sorted by most recent activity. The unread badge on
 the Messages tab comes from summing `unreadCount` across all conversations.
 */

import Foundation
import Observation

@Observable
final class MessagesViewModel {

    private(set) var conversations: [Conversation] = []
    private(set) var isLoading: Bool = false
    private(set) var hasMore: Bool = true
    var errorMessage: String?

    var totalUnread: Int { conversations.reduce(0) { $0 + $1.unreadCount } }

    private var cursor: String?
    private let env: AppEnvironment

    init(env: AppEnvironment) {
        self.env = env
    }

    // MARK: - Load

    func loadInitial() async {
        isLoading = true
        defer { isLoading = false }

        cursor = nil
        let result: APIResult<Page<Conversation>> = await env.apiClient.request(.messagesInbox())
        if case .success(let page) = result {
            conversations = page.data
            cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        } else {
            errorMessage = result.errorMessage
        }
    }

    func loadMore() async {
        guard hasMore, !isLoading, let cursor else { return }
        isLoading = true
        defer { isLoading = false }

        let result: APIResult<Page<Conversation>> = await env.apiClient.request(
            .messagesInbox(after: cursor)
        )
        if case .success(let page) = result {
            conversations.append(contentsOf: page.data)
            self.cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        }
    }

    // MARK: - Clear / delete

    /// Deletes all messages in a conversation, leaving the conversation row intact.
    func clearConversation(username: String) async {
        let result = await env.apiClient.requestEmpty(.clearConversation(username: username))
        guard case .success = result,
              let idx = conversations.firstIndex(where: { $0.partner.username == username })
        else { return }
        let c = conversations[idx]
        // Clear the last-message preview so the inbox row shows nothing.
        conversations[idx] = Conversation(
            id: c.id,
            partner: c.partner,
            lastMessage: nil,
            unreadCount: 0,
            lastMessageAt: c.lastMessageAt
        )
    }

    /// Removes a conversation and all its messages, then drops it from the inbox list.
    func deleteConversation(username: String) async {
        let result = await env.apiClient.requestEmpty(.deleteConversation(username: username))
        if case .success = result {
            conversations.removeAll { $0.partner.username == username }
        }
    }

    // MARK: - Read state sync

    /// Decrements the unread count for a conversation when it's been opened.
    func markConversationRead(partnerId: String) {
        guard let idx = conversations.firstIndex(where: { $0.partner.id == partnerId }) else { return }
        let c = conversations[idx]
        conversations[idx] = Conversation(
            id: c.id,
            partner: c.partner,
            lastMessage: c.lastMessage,
            unreadCount: 0,
            lastMessageAt: c.lastMessageAt
        )
    }
}

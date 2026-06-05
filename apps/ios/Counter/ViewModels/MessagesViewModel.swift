/**
 View model for the messages inbox.

 Lists all conversations sorted by most recent activity. Inbound message
 requests (conversations where the viewer is the recipient of a pending request)
 are separated into `requests` so the UI can show them in a distinct tab.
 The unread badge on the Messages tab sums `unreadCount` across active conversations.
 */

import Foundation
import Observation

@Observable
final class MessagesViewModel {

    /// Active conversations plus requests the viewer sent (shown in main tab).
    private(set) var conversations: [Conversation] = []
    /// Inbound message requests the viewer received (shown in Requests tab).
    private(set) var requests: [Conversation] = []
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
            split(page.data)
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
            // Append to each bucket rather than re-splitting from scratch so
            // the current page's items land in the right place.
            conversations.append(contentsOf: page.data.filter { !$0.isInboundRequest })
            requests.append(contentsOf: page.data.filter { $0.isInboundRequest })
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
        conversations[idx] = c.cleared()
    }

    /// Removes a conversation or request, then drops it from the appropriate list.
    func deleteConversation(username: String) async {
        let result = await env.apiClient.requestEmpty(.deleteConversation(username: username))
        if case .success = result {
            conversations.removeAll { $0.partner.username == username }
            requests.removeAll { $0.partner.username == username }
        }
    }

    // MARK: - Read state sync

    /// Zeros the unread count for a conversation when the thread has been opened.
    func markConversationRead(partnerId: String) {
        if let idx = conversations.firstIndex(where: { $0.partner.id == partnerId }) {
            conversations[idx] = conversations[idx].withUnreadCount(0)
        }
    }

    // MARK: - Helpers

    /// Partition a fresh page of conversations into main and requests buckets.
    private func split(_ all: [Conversation]) {
        conversations = all.filter { !$0.isInboundRequest }
        requests      = all.filter { $0.isInboundRequest }
    }
}

// MARK: - Conversation mutation helpers

private extension Conversation {
    /// Returns a copy with the last-message preview cleared and unread count zeroed.
    func cleared() -> Conversation {
        Conversation(
            id: id, partner: partner, lastMessage: nil,
            unreadCount: 0, lastMessageAt: lastMessageAt,
            status: status, isInboundRequest: isInboundRequest
        )
    }

    /// Returns a copy with a different unread count.
    func withUnreadCount(_ count: Int) -> Conversation {
        Conversation(
            id: id, partner: partner, lastMessage: lastMessage,
            unreadCount: count, lastMessageAt: lastMessageAt,
            status: status, isInboundRequest: isInboundRequest
        )
    }
}

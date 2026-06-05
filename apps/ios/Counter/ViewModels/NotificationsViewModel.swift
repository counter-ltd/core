/**
 View model for the notification inbox.

 Loads notifications with cursor pagination and handles mark-read. The unread
 badge count on the tab bar comes from `unreadCount`, derived from the loaded
 list.
 */

import Foundation
import Observation

@Observable
final class NotificationsViewModel {

    private(set) var notifications: [AppNotification] = []
    private(set) var isLoading: Bool = false
    private(set) var hasMore: Bool = true
    var errorMessage: String?

    var unreadCount: Int { notifications.filter { !$0.read }.count }

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
        let result: APIResult<Page<AppNotification>> = await env.apiClient.request(.notifications())
        if case .success(let page) = result {
            notifications = page.data
            cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        } else {
            errorMessage = result.errorMessage
        }
    }

    /// Fold a notification that arrived over the live socket into the top of the
    /// list, so the tab badge and inbox update without a refetch. Ignores
    /// duplicates in case a refresh already pulled it in.
    func receiveLive(_ n: AppNotification) {
        guard !notifications.contains(where: { $0.id == n.id }) else { return }
        notifications.insert(n, at: 0)
    }

    func loadMore() async {
        guard hasMore, !isLoading, let cursor else { return }
        isLoading = true
        defer { isLoading = false }

        let result: APIResult<Page<AppNotification>> = await env.apiClient.request(
            .notifications(after: cursor)
        )
        if case .success(let page) = result {
            notifications.append(contentsOf: page.data)
            self.cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        }
    }

    // MARK: - Mark read

    func markRead(id: String) async {
        guard let idx = notifications.firstIndex(where: { $0.id == id }),
              !notifications[idx].read else { return }

        // Optimistic: mark it read in memory immediately.
        notifications[idx] = AppNotification(
            id: notifications[idx].id,
            type: notifications[idx].type,
            actor: notifications[idx].actor,
            post: notifications[idx].post,
            conversation: notifications[idx].conversation,
            read: true,
            createdAt: notifications[idx].createdAt
        )

        _ = await env.apiClient.requestEmpty(.markNotificationRead(id: id))
    }
}

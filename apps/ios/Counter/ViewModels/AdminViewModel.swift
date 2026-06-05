/**
 Drives the admin control panel: loads each section's data and runs the
 moderation/management actions against the API.

 One view model backs the whole panel rather than one per screen, so the sub
 views share a single source of truth and an action on one screen (say, banning
 a user) can refresh the affected list in place. Every load and action funnels
 through `APIClient`, so permission failures surface as the API's own error
 message rather than a client-side guess.
 */

import Foundation
import Observation

@MainActor
@Observable
final class AdminViewModel {
    private let env: AppEnvironment

    // Section data.
    var stats: DashboardStats?
    var users: [AdminUserListItem] = []
    var groups: [AdminGroup] = []
    var reports: [AdminReport] = []
    var audit: [AuditEntry] = []

    // Shared status flags.
    var isLoading = false
    var errorMessage: String?

    /// The signed-in user's permissions, so sub views can show only what the
    /// caller can act on. Mirrors `PrivateUser.permissions`.
    var permissions: [String] { env.authStore.currentUser?.permissions ?? [] }
    func can(_ p: Permission) -> Bool { permissions.contains(p.rawValue) }

    init(env: AppEnvironment) {
        self.env = env
    }

    // MARK: - Loads

    func loadDashboard() async {
        let result: APIResult<DashboardStats> = await env.apiClient.request(.adminDashboard)
        if case .success(let s) = result { stats = s }
    }

    func loadUsers(q: String? = nil, status: String? = nil) async {
        isLoading = true
        defer { isLoading = false }
        let result: APIResult<Page<AdminUserListItem>> =
            await env.apiClient.request(.adminUsers(q: q, status: status))
        if case .success(let page) = result { users = page.data }
    }

    func loadGroups() async {
        let result: APIResult<GroupListResponse> = await env.apiClient.request(.adminGroups)
        if case .success(let resp) = result { groups = resp.data }
    }

    func loadReports(status: String = "open") async {
        isLoading = true
        defer { isLoading = false }
        let result: APIResult<Page<AdminReport>> =
            await env.apiClient.request(.adminReports(status: status))
        if case .success(let page) = result { reports = page.data }
    }

    func loadAudit() async {
        let result: APIResult<Page<AuditEntry>> = await env.apiClient.request(.adminAudit())
        if case .success(let page) = result { audit = page.data }
    }

    // MARK: - User actions

    func assignGroup(userId: String, groupId: String, q: String?, status: String?) async {
        await run(.adminAssignGroup(userId: userId, groupId: groupId)) {
            await self.loadUsers(q: q, status: status)
        }
    }

    func removeGroup(userId: String, groupId: String, q: String?, status: String?) async {
        await run(.adminRemoveGroup(userId: userId, groupId: groupId)) {
            await self.loadUsers(q: q, status: status)
        }
    }

    func ban(userId: String, reason: String?, q: String?, status: String?) async {
        await run(.adminBanUser(id: userId, reason: reason)) {
            await self.loadUsers(q: q, status: status)
        }
    }

    func unban(userId: String, q: String?, status: String?) async {
        await run(.adminUnbanUser(id: userId)) { await self.loadUsers(q: q, status: status) }
    }

    func suspend(userId: String, until: String, reason: String?, q: String?, status: String?) async {
        await run(.adminSuspendUser(id: userId, until: until, reason: reason)) {
            await self.loadUsers(q: q, status: status)
        }
    }

    func unsuspend(userId: String, q: String?, status: String?) async {
        await run(.adminUnsuspendUser(id: userId)) { await self.loadUsers(q: q, status: status) }
    }

    // MARK: - Group actions

    func createGroup(_ input: CreateGroupInput) async {
        await run(.adminCreateGroup(input)) { await self.loadGroups() }
    }

    func updateGroup(id: String, _ input: UpdateGroupInput) async {
        await run(.adminUpdateGroup(id: id, input: input)) { await self.loadGroups() }
    }

    func deleteGroup(id: String) async {
        await run(.adminDeleteGroup(id: id)) { await self.loadGroups() }
    }

    // MARK: - Content actions

    func removePost(id: String, reloadStatus: String) async {
        await run(.adminRemovePost(id: id)) { await self.loadReports(status: reloadStatus) }
    }

    func resolveReport(id: String, status: String, reloadStatus: String) async {
        await run(.adminResolveReport(id: id, status: status)) {
            await self.loadReports(status: reloadStatus)
        }
    }

    // MARK: - Internal

    /// Run a mutating endpoint, surface any error, then run a reload on success.
    private func run(_ endpoint: Endpoint, reload: () async -> Void) async {
        errorMessage = nil
        let result = await env.apiClient.requestEmpty(endpoint)
        switch result {
        case .success:
            await reload()
        case .apiError(let e):
            errorMessage = e.message
        case .networkError:
            errorMessage = result.errorMessage
        }
    }
}

/// The `{ data: [...] }` wrapper the group list endpoint returns (it isn't a
/// cursor page, so it doesn't fit `Page`).
struct GroupListResponse: Decodable, Sendable {
    let data: [AdminGroup]
}

/**
 Admin control-panel models.

 Mirrors packages/types/src/admin.ts. The permission model is a fixed enum
 (`Permission`) shared with the API; a user's effective permissions are the
 union of their groups, returned on `PrivateUser`. Group permission lists are
 decoded as raw strings so an unknown key (one removed from a newer build)
 never fails decoding; `Permission(rawValue:)` is used where a typed value is
 wanted.
 */

import Foundation

// MARK: - Permissions

/// Every capability the admin panel understands. Raw values match the API's
/// PERMISSION_KEYS exactly. `allCases` drives the group editor's checklist.
enum Permission: String, CaseIterable, Codable, Sendable, Identifiable {
    case dashboardView = "dashboard.view"
    case usersView = "users.view"
    case usersManageGroups = "users.manage_groups"
    case usersBan = "users.ban"
    case usersSuspend = "users.suspend"
    case groupsView = "groups.view"
    case groupsManage = "groups.manage"
    case postsModerate = "posts.moderate"
    case postsNuke = "posts.nuke"
    case reportsView = "reports.view"
    case reportsResolve = "reports.resolve"
    case auditView = "audit.view"

    var id: String { rawValue }

    /// Section heading the group editor groups this permission under.
    var category: String {
        switch self {
        case .dashboardView: return "Dashboard"
        case .usersView, .usersManageGroups, .usersBan, .usersSuspend: return "Users"
        case .groupsView, .groupsManage: return "Groups"
        case .postsModerate, .postsNuke, .reportsView, .reportsResolve: return "Content"
        case .auditView: return "Audit"
        }
    }

    /// Short human label for the checklist row.
    var label: String {
        switch self {
        case .dashboardView: return "View dashboard"
        case .usersView: return "View users"
        case .usersManageGroups: return "Assign groups"
        case .usersBan: return "Ban users"
        case .usersSuspend: return "Suspend users"
        case .groupsView: return "View groups"
        case .groupsManage: return "Manage groups"
        case .postsModerate: return "Moderate posts"
        case .postsNuke: return "Nuke posts"
        case .reportsView: return "View reports"
        case .reportsResolve: return "Resolve reports"
        case .auditView: return "View audit log"
        }
    }
}

// MARK: - Groups

/// A group reduced to what a badge needs. Attached to users in admin lists and
/// to the signed-in user's own `PrivateUser`.
struct GroupSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let slug: String
    let name: String
    let color: String?
}

/// A full group with its permission set and live member count.
struct AdminGroup: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let slug: String
    let name: String
    let description: String?
    let permissions: [String]
    let color: String?
    let isSystem: Bool
    let memberCount: Int
    let createdAt: String
    let updatedAt: String

    /// True when this group already carries the given permission.
    func has(_ p: Permission) -> Bool { permissions.contains(p.rawValue) }
}

// MARK: - Users

/// A user as a row in the admin user list.
struct AdminUserListItem: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let username: String
    let displayName: String?
    let avatarUrl: String?
    let status: String
    let suspendedUntil: String?
    let createdAt: String
    let groups: [GroupSummary]
}

// MARK: - Reports

/// A user reduced to what the panel shows for an actor or reporter.
struct AdminUserRef: Decodable, Hashable, Sendable {
    let id: String
    let username: String
    let displayName: String?
}

/// A report in the moderation queue.
struct AdminReport: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let targetType: String
    let targetId: String
    let reason: String
    let detail: String?
    let status: String
    let reporter: AdminUserRef?
    let resolvedBy: AdminUserRef?
    let resolvedAt: String?
    let createdAt: String
}

// MARK: - Audit

/// One entry in the admin audit trail. The arbitrary `metadata` jsonb is not
/// decoded here; the list view shows the human `summary` instead.
struct AuditEntry: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let action: String
    let targetType: String?
    let targetId: String?
    let summary: String
    let actor: AdminUserRef?
    let createdAt: String
}

// MARK: - Dashboard

/// The numbers the control-panel landing page renders.
struct DashboardStats: Decodable, Hashable, Sendable {
    struct Users: Decodable, Hashable, Sendable {
        let total: Int
        let active: Int
        let suspended: Int
        let banned: Int
        let newLast7d: Int
    }
    struct Posts: Decodable, Hashable, Sendable {
        let total: Int
        let removed: Int
    }
    struct Reports: Decodable, Hashable, Sendable { let open: Int }
    struct Groups: Decodable, Hashable, Sendable { let total: Int }
    let users: Users
    let posts: Posts
    let reports: Reports
    let groups: Groups
}

// MARK: - Request bodies

struct AssignGroupInput: Encodable, Sendable { let groupId: String }
struct BanUserInput: Encodable, Sendable { let reason: String? }
struct SuspendUserInput: Encodable, Sendable { let until: String; let reason: String? }
struct ResolveReportInput: Encodable, Sendable { let status: String }
struct CreateReportInput: Encodable, Sendable {
    let targetType: String
    let targetId: String
    let reason: String
    let detail: String?
}

/// Create body for POST /admin/groups.
struct CreateGroupInput: Encodable, Sendable {
    let slug: String
    let name: String
    let description: String?
    let color: String?
    let permissions: [String]
}

/// Edit body for PATCH /admin/groups/:id. Sends the full editable set each time.
struct UpdateGroupInput: Encodable, Sendable {
    let name: String
    let description: String?
    let color: String?
    let permissions: [String]
}

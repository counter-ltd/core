/**
 The admin control panel and its sub screens.

 `AdminView` is the entry pushed from Settings. It shows a dashboard summary and
 a permission-aware list of sections; each section is its own screen further
 down this file. Every screen reads `AdminViewModel`, so an action taken on one
 (banning a user, resolving a report) refreshes the relevant list in place.

 Which sections and controls appear is driven by the caller's permissions, so a
 moderator sees a narrower panel than an administrator. The API enforces the
 same permissions, so hiding a control is a convenience, not the security
 boundary.
 */

import SwiftUI

struct AdminView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme
    @State private var vm: AdminViewModel?

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()
            if let vm {
                List {
                    if vm.can(.dashboardView) {
                        dashboardSection(vm)
                    }
                    sectionsList(vm)
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(theme.bg)
            }
        }
        .navigationTitle("Admin")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if vm == nil {
                let model = AdminViewModel(env: env)
                vm = model
                if model.can(.dashboardView) { await model.loadDashboard() }
            }
        }
    }

    @ViewBuilder
    private func dashboardSection(_ vm: AdminViewModel) -> some View {
        Section("Overview") {
            if let s = vm.stats {
                statRow("Users", "\(s.users.total)", "\(s.users.newLast7d) new this week")
                statRow("Active", "\(s.users.active)", "\(s.users.suspended) suspended · \(s.users.banned) banned")
                statRow("Posts", "\(s.posts.total)", "\(s.posts.removed) removed by mods")
                statRow("Open reports", "\(s.reports.open)", "\(s.groups.total) groups")
            } else {
                Text("Loading…").font(CounterFont.body(13)).foregroundStyle(theme.textDim)
                    .listRowBackground(theme.surface)
            }
        }
    }

    private func statRow(_ label: String, _ value: String, _ sub: String) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(CounterFont.body(14)).foregroundStyle(theme.text)
                Text(sub).font(CounterFont.mono(11)).foregroundStyle(theme.textDim)
            }
            Spacer()
            Text(value).font(CounterFont.mono(20)).foregroundStyle(theme.accent)
        }
        .listRowBackground(theme.surface)
    }

    @ViewBuilder
    private func sectionsList(_ vm: AdminViewModel) -> some View {
        Section("Manage") {
            if vm.can(.usersView) {
                navRow("Users", "person.2", AdminUsersView(vm: vm))
            }
            if vm.can(.groupsView) {
                navRow("Groups & permissions", "key", AdminGroupsView(vm: vm))
            }
            if vm.can(.reportsView) {
                navRow("Reports", "flag", AdminReportsView(vm: vm))
            }
            if vm.can(.auditView) {
                navRow("Audit log", "list.bullet.rectangle", AdminAuditView(vm: vm))
            }
        }
    }

    private func navRow<Destination: View>(_ title: String, _ icon: String, _ destination: Destination) -> some View {
        NavigationLink {
            destination
        } label: {
            Label(title, systemImage: icon)
                .font(CounterFont.body(14))
                .foregroundStyle(theme.text)
        }
        .listRowBackground(theme.surface)
    }
}

// MARK: - Users

private struct AdminUsersView: View {
    @Bindable var vm: AdminViewModel
    @Environment(\.counterTheme) private var theme
    @State private var query = ""
    @State private var statusFilter = ""

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()
            List {
                ForEach(vm.users) { user in
                    NavigationLink {
                        AdminUserDetailView(vm: vm, user: user, query: query, statusFilter: statusFilter)
                    } label: {
                        userRow(user)
                    }
                    .listRowBackground(theme.surface)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Users")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: "username or name")
        .onSubmit(of: .search) { Task { await reload() } }
        .task { if vm.users.isEmpty { await reload() } }
    }

    private func reload() async {
        await vm.loadUsers(q: query.isEmpty ? nil : query, status: statusFilter.isEmpty ? nil : statusFilter)
    }

    private func userRow(_ u: AdminUserListItem) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(u.displayName ?? u.username).font(CounterFont.body(14)).foregroundStyle(theme.text)
                Text("@\(u.username)").font(CounterFont.mono(11)).foregroundStyle(theme.textDim)
            }
            Spacer()
            if !u.groups.isEmpty {
                Text(u.groups.map(\.name).joined(separator: ", "))
                    .font(CounterFont.mono(10)).foregroundStyle(theme.textDim)
            }
            StatusBadge(status: u.status)
        }
    }
}

/// One user's moderation controls, shown when their row is tapped. Each control
/// is gated on the matching permission and reloads the list through the model.
private struct AdminUserDetailView: View {
    @Bindable var vm: AdminViewModel
    let user: AdminUserListItem
    let query: String
    let statusFilter: String
    @Environment(\.counterTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var banReason = ""
    @State private var suspendReason = ""
    @State private var suspendUntil = Date().addingTimeInterval(86_400)
    @State private var pickedGroup = ""

    private var q: String? { query.isEmpty ? nil : query }
    private var sf: String? { statusFilter.isEmpty ? nil : statusFilter }

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()
            List {
                if let error = vm.errorMessage {
                    Text(error).font(CounterFont.body(13)).foregroundStyle(theme.danger)
                        .listRowBackground(theme.surface)
                }

                Section {
                    HStack {
                        Text("@\(user.username)").font(CounterFont.body(15)).foregroundStyle(theme.text)
                        Spacer()
                        StatusBadge(status: user.status)
                    }
                    .listRowBackground(theme.surface)
                }

                if vm.can(.usersManageGroups) {
                    groupsSection
                }
                if vm.can(.usersBan) {
                    banSection
                }
                if vm.can(.usersSuspend) {
                    suspendSection
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle(user.username)
        .navigationBarTitleDisplayMode(.inline)
        .tint(theme.accent)
    }

    private var groupsSection: some View {
        Section("Groups") {
            ForEach(user.groups) { g in
                HStack {
                    Text(g.name).font(CounterFont.body(14)).foregroundStyle(theme.text)
                    Spacer()
                    Button("Remove", role: .destructive) {
                        Task {
                            await vm.removeGroup(userId: user.id, groupId: g.id, q: q, status: sf)
                            dismiss()
                        }
                    }
                    .font(CounterFont.body(12))
                }
                .listRowBackground(theme.surface)
            }
            Picker("Add to group", selection: $pickedGroup) {
                Text("Pick a group").tag("")
                ForEach(vm.groups) { g in Text(g.name).tag(g.id) }
            }
            .font(CounterFont.body(14))
            .listRowBackground(theme.surface)
            Button("Add to group") {
                guard !pickedGroup.isEmpty else { return }
                Task {
                    await vm.assignGroup(userId: user.id, groupId: pickedGroup, q: q, status: sf)
                    dismiss()
                }
            }
            .font(CounterFont.body(14))
            .foregroundStyle(theme.accent)
            .listRowBackground(theme.surface)
        }
        .task { if vm.groups.isEmpty { await vm.loadGroups() } }
    }

    private var banSection: some View {
        Section("Ban") {
            if user.status == "banned" {
                Button("Lift ban") {
                    Task { await vm.unban(userId: user.id, q: q, status: sf); dismiss() }
                }
                .font(CounterFont.body(14)).foregroundStyle(theme.accent)
                .listRowBackground(theme.surface)
            } else {
                TextField("Reason (optional)", text: $banReason)
                    .font(CounterFont.body(14)).foregroundStyle(theme.text)
                    .listRowBackground(theme.surface)
                Button("Ban account", role: .destructive) {
                    Task {
                        await vm.ban(userId: user.id, reason: banReason.isEmpty ? nil : banReason, q: q, status: sf)
                        dismiss()
                    }
                }
                .font(CounterFont.body(14))
                .listRowBackground(theme.surface)
            }
        }
    }

    private var suspendSection: some View {
        Section("Suspend") {
            if user.status == "suspended" {
                Button("End suspension") {
                    Task { await vm.unsuspend(userId: user.id, q: q, status: sf); dismiss() }
                }
                .font(CounterFont.body(14)).foregroundStyle(theme.accent)
                .listRowBackground(theme.surface)
            } else {
                DatePicker("Until", selection: $suspendUntil, in: Date()...)
                    .font(CounterFont.body(14)).foregroundStyle(theme.text)
                    .listRowBackground(theme.surface)
                TextField("Reason (optional)", text: $suspendReason)
                    .font(CounterFont.body(14)).foregroundStyle(theme.text)
                    .listRowBackground(theme.surface)
                Button("Suspend account", role: .destructive) {
                    let iso = ISO8601DateFormatter().string(from: suspendUntil)
                    Task {
                        await vm.suspend(userId: user.id, until: iso, reason: suspendReason.isEmpty ? nil : suspendReason, q: q, status: sf)
                        dismiss()
                    }
                }
                .font(CounterFont.body(14))
                .listRowBackground(theme.surface)
            }
        }
    }
}

// MARK: - Groups

private struct AdminGroupsView: View {
    @Bindable var vm: AdminViewModel
    @Environment(\.counterTheme) private var theme
    @State private var showCreate = false

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()
            List {
                ForEach(vm.groups) { g in
                    NavigationLink {
                        AdminGroupEditorView(vm: vm, group: g)
                    } label: {
                        groupRow(g)
                    }
                    .listRowBackground(theme.surface)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Groups")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if vm.can(.groupsManage) {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showCreate = true } label: { Image(systemName: "plus") }
                        .tint(theme.accent)
                }
            }
        }
        .sheet(isPresented: $showCreate) {
            AdminGroupCreateView(vm: vm)
        }
        .task { if vm.groups.isEmpty { await vm.loadGroups() } }
    }

    private func groupRow(_ g: AdminGroup) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(g.name).font(CounterFont.body(14)).foregroundStyle(theme.text)
                if g.isSystem {
                    Text("SYSTEM").font(CounterFont.mono(9)).foregroundStyle(theme.textDim)
                }
            }
            Text("\(g.memberCount) members · \(g.permissions.count) perms")
                .font(CounterFont.mono(11)).foregroundStyle(theme.textDim)
        }
    }
}

/// A grouped permission checklist plus name/description/colour fields, shared by
/// the create sheet and the editor.
private struct PermissionEditor: View {
    @Binding var name: String
    @Binding var description: String
    @Binding var color: String
    @Binding var selected: Set<String>
    @Environment(\.counterTheme) private var theme

    /// Permissions grouped by their category heading, in declared order.
    private var categories: [(String, [Permission])] {
        var out: [(String, [Permission])] = []
        for p in Permission.allCases {
            if let i = out.firstIndex(where: { $0.0 == p.category }) {
                out[i].1.append(p)
            } else {
                out.append((p.category, [p]))
            }
        }
        return out
    }

    var body: some View {
        Section("Details") {
            TextField("Name", text: $name).font(CounterFont.body(14)).foregroundStyle(theme.text)
                .listRowBackground(theme.surface)
            TextField("Description", text: $description).font(CounterFont.body(14)).foregroundStyle(theme.text)
                .listRowBackground(theme.surface)
            TextField("Colour (e.g. #7aa2ff)", text: $color).font(CounterFont.body(14)).foregroundStyle(theme.text)
                .listRowBackground(theme.surface)
        }
        ForEach(categories, id: \.0) { category, perms in
            Section(category) {
                ForEach(perms) { p in
                    Toggle(isOn: Binding(
                        get: { selected.contains(p.rawValue) },
                        set: { on in if on { selected.insert(p.rawValue) } else { selected.remove(p.rawValue) } }
                    )) {
                        Text(p.label).font(CounterFont.body(14)).foregroundStyle(theme.text)
                    }
                    .tint(theme.accent)
                    .listRowBackground(theme.surface)
                }
            }
        }
    }
}

private struct AdminGroupCreateView: View {
    @Bindable var vm: AdminViewModel
    @Environment(\.counterTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var slug = ""
    @State private var name = ""
    @State private var description = ""
    @State private var color = ""
    @State private var selected: Set<String> = []

    var body: some View {
        NavigationStack {
            ZStack {
                theme.bg.ignoresSafeArea()
                List {
                    Section("Slug") {
                        TextField("support", text: $slug)
                            .autocapitalization(.none)
                            .font(CounterFont.body(14)).foregroundStyle(theme.text)
                            .listRowBackground(theme.surface)
                    }
                    PermissionEditor(name: $name, description: $description, color: $color, selected: $selected)
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(theme.bg)
            }
            .navigationTitle("New group")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.tint(theme.accent)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        let input = CreateGroupInput(
                            slug: slug, name: name,
                            description: description.isEmpty ? nil : description,
                            color: color.isEmpty ? nil : color,
                            permissions: Array(selected)
                        )
                        Task { await vm.createGroup(input); dismiss() }
                    }
                    .disabled(slug.isEmpty || name.isEmpty)
                    .tint(theme.accent)
                }
            }
        }
    }
}

private struct AdminGroupEditorView: View {
    @Bindable var vm: AdminViewModel
    let group: AdminGroup
    @Environment(\.counterTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var color = ""
    @State private var selected: Set<String> = []
    @State private var loaded = false

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()
            List {
                PermissionEditor(name: $name, description: $description, color: $color, selected: $selected)
                Section {
                    Button("Save changes") {
                        let input = UpdateGroupInput(
                            name: name,
                            description: description.isEmpty ? nil : description,
                            color: color.isEmpty ? nil : color,
                            permissions: Array(selected)
                        )
                        Task { await vm.updateGroup(id: group.id, input); dismiss() }
                    }
                    .font(CounterFont.body(14)).foregroundStyle(theme.accent)
                    .listRowBackground(theme.surface)
                    if !group.isSystem {
                        Button("Delete group", role: .destructive) {
                            Task { await vm.deleteGroup(id: group.id); dismiss() }
                        }
                        .font(CounterFont.body(14))
                        .listRowBackground(theme.surface)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle(group.name)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            // Prefill once from the group passed in, so edits aren't clobbered on
            // a re-render.
            guard !loaded else { return }
            name = group.name
            description = group.description ?? ""
            color = group.color ?? ""
            selected = Set(group.permissions)
            loaded = true
        }
    }
}

// MARK: - Reports

private struct AdminReportsView: View {
    @Bindable var vm: AdminViewModel
    @Environment(\.counterTheme) private var theme
    @State private var statusFilter = "open"

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()
            List {
                Section {
                    Picker("Status", selection: $statusFilter) {
                        Text("Open").tag("open")
                        Text("Resolved").tag("resolved")
                        Text("Dismissed").tag("dismissed")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(theme.surface)
                    .onChange(of: statusFilter) { _, new in Task { await vm.loadReports(status: new) } }
                }
                if let error = vm.errorMessage {
                    Text(error).font(CounterFont.body(13)).foregroundStyle(theme.danger)
                        .listRowBackground(theme.surface)
                }
                ForEach(vm.reports) { r in
                    reportRow(r)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Reports")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.loadReports(status: statusFilter) }
    }

    private func reportRow(_ r: AdminReport) -> some View {
        VStack(alignment: .leading, spacing: CounterSpacing.sm) {
            HStack {
                Text(r.reason.capitalized).font(CounterFont.body(14)).foregroundStyle(theme.text)
                Text(r.targetType).font(CounterFont.mono(10)).foregroundStyle(theme.textDim)
                Spacer()
                Text(String(r.targetId.prefix(8))).font(CounterFont.mono(10)).foregroundStyle(theme.textDim)
            }
            if let detail = r.detail {
                Text(detail).font(CounterFont.body(13)).foregroundStyle(theme.textDim)
            }
            Text("by \(r.reporter.map { "@\($0.username)" } ?? "deleted user")")
                .font(CounterFont.mono(11)).foregroundStyle(theme.textDim)

            if r.status == "open" {
                HStack(spacing: CounterSpacing.md) {
                    if vm.can(.reportsResolve) {
                        Button("Resolve") {
                            Task { await vm.resolveReport(id: r.id, status: "resolved", reloadStatus: statusFilter) }
                        }
                        .font(CounterFont.body(12)).foregroundStyle(theme.accent)
                        Button("Dismiss") {
                            Task { await vm.resolveReport(id: r.id, status: "dismissed", reloadStatus: statusFilter) }
                        }
                        .font(CounterFont.body(12)).foregroundStyle(theme.textDim)
                    }
                    if vm.can(.postsModerate) && r.targetType == "post" {
                        Button("Remove post", role: .destructive) {
                            Task { await vm.removePost(id: r.targetId, reloadStatus: statusFilter) }
                        }
                        .font(CounterFont.body(12))
                    }
                }
                .padding(.top, 2)
            }
        }
        .listRowBackground(theme.surface)
    }
}

// MARK: - Audit

private struct AdminAuditView: View {
    @Bindable var vm: AdminViewModel
    @Environment(\.counterTheme) private var theme

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()
            List {
                ForEach(vm.audit) { e in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(e.action).font(CounterFont.mono(11)).foregroundStyle(theme.accent)
                        Text(e.summary).font(CounterFont.body(13)).foregroundStyle(theme.text)
                        Text("\(e.actor.map { "@\($0.username)" } ?? "system") · \(e.createdAt)")
                            .font(CounterFont.mono(10)).foregroundStyle(theme.textDim)
                    }
                    .listRowBackground(theme.surface)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Audit log")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.loadAudit() }
    }
}

// MARK: - Shared

/// A small pill showing a user's moderation status, coloured by severity.
private struct StatusBadge: View {
    let status: String
    @Environment(\.counterTheme) private var theme

    var body: some View {
        Text(status)
            .font(CounterFont.mono(10))
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .foregroundStyle(color)
            .overlay(Capsule().stroke(color, lineWidth: 1))
    }

    private var color: Color {
        switch status {
        case "banned": return theme.danger
        case "suspended": return .orange
        default: return theme.textDim
        }
    }
}

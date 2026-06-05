/**
 User-search sheet for starting a new direct message conversation.

 Presented from the inbox compose button. Shows a searchable user list;
 tapping a user pushes a ConversationView within the sheet's own
 NavigationStack so the compose flow is fully self-contained.
 */

import SwiftUI

struct NewMessageView: View {
    @Environment(\.counterTheme) private var theme
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    @State private var query = ""
    @State private var users: [PublicUser] = []
    @State private var isLoading = false
    @State private var debounceTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ZStack {
                theme.bg.ignoresSafeArea()
                content
            }
            .navigationTitle("New Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(theme.accent)
                }
            }
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search users"
            )
            .onChange(of: query) { scheduleSearch() }
            .navigationDestination(for: AppDestination.self) { destination in
                if case .conversation(let username) = destination {
                    ConversationView(vm: ConversationViewModel(partnerUsername: username, env: env))
                }
            }
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if isLoading {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if query.isEmpty {
            emptyState(icon: "magnifyingglass", text: "Search for someone to message")
        } else if users.isEmpty {
            emptyState(icon: "person.slash", text: "No users found for \"\(query)\"")
        } else {
            List {
                ForEach(users) { user in
                    NavigationLink(value: AppDestination.conversation(username: user.username)) {
                        UserRowView(user: user)
                    }
                    .buttonStyle(.plain)
                    .counterListRow()
                }
            }
            .listStyle(.plain)
            .background(theme.bg)
            .scrollContentBackground(.hidden)
        }
    }

    private func emptyState(icon: String, text: String) -> some View {
        VStack(spacing: CounterSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 40))
                .foregroundStyle(theme.textDim)
            Text(text)
                .font(CounterFont.body(15))
                .foregroundStyle(theme.textDim)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Search

    private func scheduleSearch() {
        debounceTask?.cancel()
        let q = query
        debounceTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await runSearch(q.trimmingCharacters(in: .whitespaces))
        }
    }

    private func runSearch(_ q: String) async {
        guard !q.isEmpty else { users = []; return }
        isLoading = true
        defer { isLoading = false }
        let result: APIResult<Page<PublicUser>> = await env.apiClient.request(
            .search(query: q, type: .users)
        )
        if case .success(let page) = result {
            users = page.data
        }
    }
}

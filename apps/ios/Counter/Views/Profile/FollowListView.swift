/**
 A paginated list of followers or following for a given user.

 Reused for both directions by the `mode` parameter. Follow/unfollow actions
 are available when the viewer is authenticated.
 */

import SwiftUI

struct FollowListView: View {
    @Environment(\.counterTheme) private var theme
    let username: String
    let mode: Mode
    let env: AppEnvironment

    enum Mode { case followers, following }

    @State private var users: [PublicUser] = []
    @State private var cursor: String?
    @State private var hasMore: Bool = true
    @State private var isLoading: Bool = false

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            if users.isEmpty && isLoading {
                ProgressView()
            } else {
                List {
                    ForEach(users) { user in
                        NavigationLink(value: AppDestination.profile(username: user.username)) {
                            UserRowView(user: user)
                        }
                        .buttonStyle(.plain)
                        .counterListRow()
                        .onAppear {
                            if user.id == users.last?.id { Task { await loadMore() } }
                        }
                    }
                }
                .listStyle(.plain)
                .background(theme.bg)
                .scrollContentBackground(.hidden)
            }
        }
        .navigationTitle(mode == .followers ? "Followers" : "Following")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadInitial() }
    }

    private func loadInitial() async {
        isLoading = true
        defer { isLoading = false }
        cursor = nil
        let result = await fetch(after: nil)
        if let page = result {
            users = page.data
            cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        }
    }

    private func loadMore() async {
        guard hasMore, !isLoading, let cursor else { return }
        isLoading = true
        defer { isLoading = false }
        if let page = await fetch(after: cursor) {
            users.append(contentsOf: page.data)
            self.cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        }
    }

    private func fetch(after: String?) async -> Page<PublicUser>? {
        let endpoint: Endpoint = mode == .followers
            ? .followers(username: username, after: after)
            : .following(username: username, after: after)
        let result: APIResult<Page<PublicUser>> = await env.apiClient.request(endpoint)
        if case .success(let page) = result { return page }
        return nil
    }
}

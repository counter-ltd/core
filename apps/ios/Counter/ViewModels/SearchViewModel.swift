/**
 View model for the search screen.

 Uses a debounce task so network calls don't fire on every keystroke.
 Supports three search modes (posts, users, tags) matched to the API's
 `GET /search?q=&type=` endpoint.
 */

import Foundation
import Observation

@Observable
final class SearchViewModel {

    enum ResultType: String, CaseIterable {
        case posts = "Posts"
        case users = "Users"
    }

    // MARK: - State

    var query: String = "" {
        didSet { scheduleSearch() }
    }
    var selectedType: ResultType = .posts

    private(set) var posts: [Post] = []
    private(set) var users: [PublicUser] = []
    private(set) var isLoading: Bool = false
    var errorMessage: String?

    private var debounceTask: Task<Void, Never>?
    private let env: AppEnvironment

    init(env: AppEnvironment) {
        self.env = env
    }

    // MARK: - Search

    func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else {
            posts = []; users = []
            return
        }

        isLoading = true
        defer { isLoading = false }

        switch selectedType {
        case .posts:
            let result: APIResult<Page<Post>> = await env.apiClient.request(
                .search(query: trimmed, type: .posts)
            )
            if case .success(let page) = result { posts = page.data }
            else { errorMessage = result.errorMessage }

        case .users:
            let result: APIResult<Page<PublicUser>> = await env.apiClient.request(
                .search(query: trimmed, type: .users)
            )
            if case .success(let page) = result { users = page.data }
            else { errorMessage = result.errorMessage }
        }
    }

    // MARK: - Internal

    private func scheduleSearch() {
        debounceTask?.cancel()
        debounceTask = Task {
            // 350ms debounce to avoid a call on every character.
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            await search()
        }
    }
}

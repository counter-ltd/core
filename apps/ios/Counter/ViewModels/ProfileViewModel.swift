/**
 View model for a user's profile page.

 Loads the profile and the user's post list. Follow/unfollow toggle is
 optimistic: the viewer relationship flips immediately and rolls back on error.

 `filter` controls whether the post list shows only root posts or all posts
 including replies. Changing it resets and reloads the list.
 */

import Foundation
import Observation

/** Controls which posts appear on a profile. */
enum ProfilePostFilter: String, CaseIterable {
    case posts = "posts"
    case all   = "all"

    var label: String {
        switch self {
        case .posts: return "Posts"
        case .all:   return "Posts & Replies"
        }
    }
}

@Observable
final class ProfileViewModel {

    private(set) var user: PublicUser?
    private(set) var posts: [Post] = []
    private(set) var isLoading: Bool = false
    private(set) var hasMore: Bool = true
    var errorMessage: String?
    var filter: ProfilePostFilter = .posts

    private var cursor: String?
    private let username: String
    private let env: AppEnvironment

    init(username: String, env: AppEnvironment) {
        self.username = username
        self.env = env
    }

    // MARK: - Load

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        async let profileResult: APIResult<PublicUser> = env.apiClient.request(.userProfile(username: username))
        async let postsResult: APIResult<Page<Post>> = env.apiClient.request(.userPosts(username: username, filter: filter))

        let (profile, postsPage) = await (profileResult, postsResult)

        if case .success(let u) = profile { user = u }
        if case .success(let page) = postsPage {
            posts = page.data
            cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        }
    }

    /** Resets the post list and reloads with the current filter. */
    func reloadPosts() async {
        cursor = nil
        hasMore = true
        posts = []
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        let result: APIResult<Page<Post>> = await env.apiClient.request(.userPosts(username: username, filter: filter))
        if case .success(let page) = result {
            posts = page.data
            cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        }
    }

    func loadMorePosts() async {
        guard hasMore, !isLoading, let cursor else { return }
        isLoading = true
        defer { isLoading = false }

        let result: APIResult<Page<Post>> = await env.apiClient.request(
            .userPosts(username: username, after: cursor, filter: filter)
        )
        if case .success(let page) = result {
            posts.append(contentsOf: page.data)
            self.cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        }
    }

    // MARK: - Follow (optimistic)

    func toggleFollow() async {
        guard let current = user else { return }
        let isFollowing = current.viewer?.isFollowing ?? false

        applyFollow(!isFollowing)

        let endpoint: Endpoint = isFollowing
            ? .unfollow(username: username)
            : .follow(username: username)
        let result: APIResult<Empty> = await env.apiClient.request(endpoint)

        if case .apiError = result { applyFollow(isFollowing) }
        if case .networkError = result { applyFollow(isFollowing) }
    }

    // MARK: - Internal

    private func applyFollow(_ following: Bool) {
        guard var u = user else { return }
        let delta = following ? 1 : -1
        let newCounts = UserCounts(
            posts: u.counts.posts,
            followers: u.counts.followers + delta,
            following: u.counts.following
        )
        let newViewer = ViewerRelationship(
            isFollowing: following,
            isSelf: u.viewer?.isSelf ?? false
        )
        user = PublicUser(
            id: u.id, username: u.username, displayName: u.displayName,
            bio: u.bio, avatarUrl: u.avatarUrl, verified: u.verified,
            createdAt: u.createdAt, counts: newCounts, signals: u.signals,
            viewer: newViewer, presence: u.presence
        )
    }
}

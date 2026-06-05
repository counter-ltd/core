/**
 View model for a user's profile page.

 Loads the profile and the user's post list. Follow/unfollow toggle is
 optimistic: the viewer relationship flips immediately and rolls back on error.
 */

import Foundation
import Observation

@Observable
final class ProfileViewModel {

    private(set) var user: PublicUser?
    private(set) var posts: [Post] = []
    private(set) var isLoading: Bool = false
    private(set) var hasMore: Bool = true
    var errorMessage: String?

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
        async let postsResult: APIResult<Page<Post>> = env.apiClient.request(.userPosts(username: username))

        let (profile, postsPage) = await (profileResult, postsResult)

        if case .success(let u) = profile { user = u }
        if case .success(let page) = postsPage {
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
            .userPosts(username: username, after: cursor)
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

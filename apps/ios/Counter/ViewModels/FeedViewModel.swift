/**
 View model for the home feed.

 Supports multiple feed sources: the public timeline, the authenticated
 following feed, and per-topic feeds. The active source drives which API
 endpoint is called. Switching sources resets pagination and reloads.

 Available sources are built on first load — topics are fetched in parallel
 with the initial post page so there's no extra round-trip on the critical path.
 */

import Foundation
import Observation

// MARK: - Feed source

enum FeedSource: Equatable, Hashable, Sendable {
    case all
    case following
    case topic(slug: String, name: String)

    var label: String {
        switch self {
        case .all:                    return "All"
        case .following:              return "Following"
        case .topic(_, let name):     return name
        }
    }
}

// MARK: - View model

@Observable
final class FeedViewModel {

    // MARK: - State

    private(set) var posts: [Post] = []
    private(set) var source: FeedSource
    private(set) var availableSources: [FeedSource] = []
    private(set) var isLoading: Bool = false
    private(set) var isRefreshing: Bool = false
    private(set) var hasMore: Bool = true
    var errorMessage: String?

    private var cursor: String?
    private let env: AppEnvironment

    init(env: AppEnvironment) {
        self.env = env
        // Default to the following feed when signed in.
        self.source = env.authStore.isAuthenticated ? .following : .all
    }

    // MARK: - Load

    func loadInitial() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        cursor = nil
        hasMore = true

        // Fetch the first post page and the source list in parallel.
        async let feedTask = fetchPage(after: nil)
        async let sourcesTask = buildAvailableSources()

        let (page, sources) = await (feedTask, sourcesTask)
        availableSources = sources
        if let page {
            posts = page.data
            cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        }
    }

    func refresh() async {
        isRefreshing = true
        defer { isRefreshing = false }
        await loadInitial()
    }

    func loadMore() async {
        guard hasMore, !isLoading, let cursor else { return }
        isLoading = true
        defer { isLoading = false }

        if let page = await fetchPage(after: cursor) {
            posts.append(contentsOf: page.data)
            self.cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        }
    }

    func switchSource(_ newSource: FeedSource) async {
        guard newSource != source else { return }
        source = newSource
        posts = []
        cursor = nil
        hasMore = true
        // Bypass the loadInitial guard — we know we're not mid-load here.
        isLoading = true
        defer { isLoading = false }
        if let page = await fetchPage(after: nil) {
            posts = page.data
            cursor = page.nextCursor
            hasMore = page.nextCursor != nil
        }
    }

    // MARK: - Engagement (optimistic)

    func toggleLike(postId: String) async {
        guard let idx = posts.firstIndex(where: { $0.id == postId }) else { return }
        let wasLiked = posts[idx].viewer?.liked ?? false

        // Flip optimistically before the network call.
        applyLike(at: idx, liked: !wasLiked)

        let endpoint: Endpoint = wasLiked ? .unlike(id: postId) : .like(id: postId)
        let result: APIResult<Empty> = await env.apiClient.request(endpoint)

        if case .apiError = result { applyLike(at: idx, liked: wasLiked) }
        if case .networkError = result { applyLike(at: idx, liked: wasLiked) }
    }

    func toggleRepost(postId: String) async {
        guard let idx = posts.firstIndex(where: { $0.id == postId }) else { return }
        let wasReposted = posts[idx].viewer?.reposted ?? false

        applyRepost(at: idx, reposted: !wasReposted)

        let endpoint: Endpoint = wasReposted ? .unrepost(id: postId) : .repost(id: postId)
        let result: APIResult<Empty> = await env.apiClient.request(endpoint)

        if case .apiError = result { applyRepost(at: idx, reposted: wasReposted) }
        if case .networkError = result { applyRepost(at: idx, reposted: wasReposted) }
    }

    // MARK: - Private

    private func fetchPage(after: String?) async -> Page<Post>? {
        let endpoint: Endpoint
        switch source {
        case .all:
            endpoint = .publicFeed(after: after)
        case .following:
            endpoint = .authenticatedFeed(after: after)
        case .topic(let slug, _):
            endpoint = .topicPosts(slug: slug, after: after)
        }

        let result: APIResult<Page<Post>> = await env.apiClient.request(endpoint)
        switch result {
        case .success(let page): return page
        case .apiError(let e): errorMessage = e.message; return nil
        case .networkError: errorMessage = result.errorMessage; return nil
        }
    }

    private func buildAvailableSources() async -> [FeedSource] {
        var sources: [FeedSource] = [.all]
        if env.authStore.isAuthenticated {
            sources.append(.following)
        }

        let result: APIResult<Page<Topic>> = await env.apiClient.request(.topics)
        if case .success(let page) = result {
            let topicSources = page.data.map { FeedSource.topic(slug: $0.slug, name: $0.name) }
            sources.append(contentsOf: topicSources)
        }

        return sources
    }

    private func applyLike(at idx: Int, liked: Bool) {
        let delta = liked ? 1 : -1
        posts[idx] = mutated(posts[idx]) { post in
            post.counts.likes += delta
            if post.viewer != nil { post.viewer!.liked = liked }
        }
    }

    private func applyRepost(at idx: Int, reposted: Bool) {
        let delta = reposted ? 1 : -1
        posts[idx] = mutated(posts[idx]) { post in
            post.counts.reposts += delta
            if post.viewer != nil { post.viewer!.reposted = reposted }
        }
    }
}

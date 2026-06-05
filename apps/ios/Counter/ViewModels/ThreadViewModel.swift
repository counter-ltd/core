/**
 View model for the post thread screen.

 Fetches the full thread (ancestors + focused post + replies) and exposes
 like/repost actions that apply optimistically to the focused post and
 any reply in the list.
 */

import Foundation
import Observation

@Observable
final class ThreadViewModel {

    private(set) var thread: Thread?
    private(set) var isLoading: Bool = false
    var errorMessage: String?

    private let postId: String
    private let env: AppEnvironment

    init(postId: String, env: AppEnvironment) {
        self.postId = postId
        self.env = env
    }

    // MARK: - Load

    func load() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        let result: APIResult<Thread> = await env.apiClient.request(.thread(id: postId))
        switch result {
        case .success(let t): thread = t
        case .apiError(let e): errorMessage = e.message
        case .networkError: errorMessage = result.errorMessage
        }
    }

    // MARK: - Engagement (optimistic on focused post)

    func toggleLike() async {
        guard var t = thread else { return }
        let wasLiked = t.post.viewer?.liked ?? false
        thread = withLike(t, postId: postId, liked: !wasLiked)

        let result: APIResult<Empty> = await env.apiClient.request(
            wasLiked ? .unlike(id: postId) : .like(id: postId)
        )
        if case .apiError = result { thread = withLike(t, postId: postId, liked: wasLiked) }
        if case .networkError = result { thread = withLike(t, postId: postId, liked: wasLiked) }
    }

    func toggleRepost() async {
        guard let t = thread else { return }
        let wasReposted = t.post.viewer?.reposted ?? false
        thread = withRepost(t, postId: postId, reposted: !wasReposted)

        let result: APIResult<Empty> = await env.apiClient.request(
            wasReposted ? .unrepost(id: postId) : .repost(id: postId)
        )
        if case .apiError = result { thread = withRepost(t, postId: postId, reposted: wasReposted) }
        if case .networkError = result { thread = withRepost(t, postId: postId, reposted: wasReposted) }
    }

    // MARK: - Internal

    private func withLike(_ thread: Thread, postId: String, liked: Bool) -> Thread {
        let delta = liked ? 1 : -1
        if thread.post.id == postId {
            let updated = applyLikeDelta(thread.post, delta: delta, liked: liked)
            return Thread(ancestors: thread.ancestors, post: updated, replies: thread.replies)
        }
        let replies = thread.replies.map { r -> Post in
            r.id == postId ? applyLikeDelta(r, delta: delta, liked: liked) : r
        }
        return Thread(ancestors: thread.ancestors, post: thread.post, replies: replies)
    }

    private func applyLikeDelta(_ post: Post, delta: Int, liked: Bool) -> Post {
        mutated(post) {
            $0.counts.likes += delta
            $0.viewer?.liked = liked
        }
    }

    private func withRepost(_ thread: Thread, postId: String, reposted: Bool) -> Thread {
        let delta = reposted ? 1 : -1
        let updated = mutated(thread.post) {
            $0.counts.reposts += delta
            $0.viewer?.reposted = reposted
        }
        return Thread(ancestors: thread.ancestors, post: updated, replies: thread.replies)
    }
}


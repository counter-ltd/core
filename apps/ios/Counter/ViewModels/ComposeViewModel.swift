/**
 View model for the compose sheet.

 Handles both new top-level posts and replies. When `parentId` is set the
 sheet is in reply mode. On success it calls the `onSuccess` closure so
 `FeedView` or `ThreadView` can insert the new post without a full reload.
 */

import Foundation
import Observation

@Observable
final class ComposeViewModel {

    // MARK: - State

    var body: String = ""
    var selectedTopicId: String?

    private(set) var isPosting: Bool = false
    var errorMessage: String?

    // Reply context; nil for top-level posts.
    let parentId: String?
    /// Invoked with the new post after a successful submission.
    var onSuccess: ((Post) -> Void)?

    // Character limit matches the API's createPostSchema.
    static let maxLength = 5000

    var remainingCharacters: Int { Self.maxLength - body.count }
    var canPost: Bool { !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        && remainingCharacters >= 0
                        && !isPosting }

    private let env: AppEnvironment

    init(parentId: String? = nil, env: AppEnvironment) {
        self.parentId = parentId
        self.env = env
    }

    // MARK: - Submit

    func post() async {
        guard canPost else { return }
        isPosting = true
        defer { isPosting = false }

        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        let result: APIResult<Post>

        if let parentId {
            result = await env.apiClient.request(.createReply(parentId: parentId, body: trimmed))
        } else {
            result = await env.apiClient.request(.createPost(body: trimmed, topicId: selectedTopicId))
        }

        switch result {
        case .success(let post):
            body = ""
            onSuccess?(post)
        case .apiError(let e):
            errorMessage = e.message
        case .networkError:
            errorMessage = result.errorMessage
        }
    }
}

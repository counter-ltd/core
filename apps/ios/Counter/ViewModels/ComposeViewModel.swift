/**
 View model for the compose sheet.

 Handles both new top-level posts and replies. When `parentId` is set the
 sheet is in reply mode. On success it calls the `onSuccess` closure so
 `FeedView` or `ThreadView` can insert the new post without a full reload.
 */

import Foundation
import Observation

/// A photo attached to the post being composed: the uploaded object id (sent on
/// submit) plus the raw bytes kept for the thumbnail preview.
struct ComposeAttachment: Identifiable, Sendable {
    let id: String
    let preview: Data
}

@Observable
final class ComposeViewModel {

    // MARK: - State

    var body: String = ""
    var selectedTopicId: String?

    private(set) var isPosting: Bool = false
    var errorMessage: String?

    // Photos attached to this post, uploaded as they're picked. Capped to match
    // the API's `media.max(4)`.
    private(set) var attachments: [ComposeAttachment] = []
    private(set) var isUploading: Bool = false
    static let maxAttachments = 4

    // Reply context; nil for top-level posts.
    let parentId: String?
    /// Invoked with the new post after a successful submission.
    var onSuccess: ((Post) -> Void)?

    // Character limit matches the API's createPostSchema.
    static let maxLength = 5000

    var remainingCharacters: Int { Self.maxLength - body.count }
    /// A post needs text or at least one photo, and nothing in flight.
    var canPost: Bool {
        let hasText = !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return (hasText || !attachments.isEmpty)
            && remainingCharacters >= 0
            && !isPosting
            && !isUploading
    }
    var canAddPhoto: Bool { attachments.count < Self.maxAttachments && !isUploading }

    private let env: AppEnvironment

    init(parentId: String? = nil, env: AppEnvironment) {
        self.parentId = parentId
        self.env = env
    }

    // MARK: - Attachments

    /// Upload image bytes and, on success, add them as an attachment.
    func addAttachment(_ data: Data) async {
        guard canAddPhoto else { return }
        isUploading = true
        defer { isUploading = false }

        let result = await env.apiClient.upload(data, mimeType: "image/jpeg")
        switch result {
        case .success(let media):
            attachments.append(ComposeAttachment(id: media.id, preview: data))
        case .apiError(let e):
            errorMessage = e.message
        case .networkError:
            errorMessage = result.errorMessage
        }
    }

    /// Drop an attachment before submit; the unused object is swept later.
    func removeAttachment(_ id: String) {
        attachments.removeAll { $0.id == id }
    }

    // MARK: - Submit

    func post() async {
        guard canPost else { return }
        isPosting = true
        defer { isPosting = false }

        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        let media = attachments.isEmpty
            ? nil
            : attachments.map { MediaInputDTO(objectId: $0.id) }
        let result: APIResult<Post>

        if let parentId {
            result = await env.apiClient.request(.createReply(parentId: parentId, body: trimmed, media: media))
        } else {
            result = await env.apiClient.request(.createPost(body: trimmed, topicId: selectedTopicId, media: media))
        }

        switch result {
        case .success(let post):
            body = ""
            attachments = []
            onSuccess?(post)
        case .apiError(let e):
            errorMessage = e.message
        case .networkError:
            errorMessage = result.errorMessage
        }
    }
}

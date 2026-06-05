/**
 Post models: individual posts, threads, and media attachments.

 Mirrors packages/types/src/post.ts. A "post" covers three cases in one type:
 top-level posts (`parentId == nil`, `repostOf == nil`), replies (`parentId` set),
 and reposts (`repostOf` set, `body` may be nil for a bare repost).

 The `deleted` flag is a soft-delete: the row stays in the DB so reply threads
 keep their parent reference intact.
 */

// MARK: - Post

struct Post: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let body: String?
    let author: PublicUser
    let parentId: String?
    let repostOf: PostRef?
    let topic: TopicRef?
    let edited: Bool
    let deleted: Bool
    let createdAt: String
    let updatedAt: String
    let media: [MediaItem]
    let tags: [String]
    let counts: PostCounts
    /// Populated when the request is authenticated.
    let viewer: PostViewerState?
}

struct PostCounts: Decodable, Hashable, Sendable {
    var likes: Int
    var reposts: Int
    var replies: Int
    var views: Int
}

struct PostViewerState: Decodable, Hashable, Sendable {
    var liked: Bool
    var reposted: Bool
}

// MARK: - Thread

/// A post with its ancestor chain (root-first) and direct replies.
struct Thread: Decodable, Sendable {
    let ancestors: [Post]
    let post: Post
    let replies: [Post]
}

// MARK: - Media

struct MediaItem: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let url: String
    let mimeType: String
    let width: Int?
    let height: Int?
    let sizeBytes: Int?
    let altText: String?
}

// MARK: - Lightweight reference (embedded in reposts)

struct PostRef: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let body: String?
    let author: PublicUser
    let deleted: Bool
    let createdAt: String
    let media: [MediaItem]
}

// MARK: - Mutable copy helper

/// A mutable mirror of `Post` used for optimistic state updates in view models.
/// `Post` uses `let` properties so mutations need to go through this scratch type.
struct MutablePost {
    var id: String
    var body: String?
    var author: PublicUser
    var parentId: String?
    var repostOf: PostRef?
    var topic: TopicRef?
    var edited: Bool
    var deleted: Bool
    var createdAt: String
    var updatedAt: String
    var media: [MediaItem]
    var tags: [String]
    var counts: PostCounts
    var viewer: PostViewerState?

    init(_ post: Post) {
        id = post.id; body = post.body; author = post.author; parentId = post.parentId
        repostOf = post.repostOf; topic = post.topic; edited = post.edited
        deleted = post.deleted; createdAt = post.createdAt; updatedAt = post.updatedAt
        media = post.media; tags = post.tags; counts = post.counts; viewer = post.viewer
    }

    func build() -> Post {
        Post(id: id, body: body, author: author, parentId: parentId, repostOf: repostOf,
             topic: topic, edited: edited, deleted: deleted, createdAt: createdAt,
             updatedAt: updatedAt, media: media, tags: tags, counts: counts, viewer: viewer)
    }
}

/// Applies a mutation closure to a `Post` via `MutablePost` and returns the result.
func mutated(_ post: Post, _ mutation: (inout MutablePost) -> Void) -> Post {
    var m = MutablePost(post)
    mutation(&m)
    return m.build()
}

// MARK: - Create requests

struct CreatePostInput: Encodable, Sendable {
    let body: String
    let topicId: String?
}

struct CreateReplyInput: Encodable, Sendable {
    let body: String
}

struct UpdatePostInput: Encodable, Sendable {
    let body: String
}

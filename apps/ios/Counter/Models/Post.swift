/**
 Post models: individual posts, threads, and media attachments.

 Mirrors packages/types/src/post.ts. A "post" covers three cases in one type:
 top-level posts (`parentId == nil`, `repostOf == nil`), replies (`parentId` set),
 and reposts (`repostOf` set, `body` may be nil for a bare repost).

 The `deleted` flag is a soft-delete: the row stays in the DB so reply threads
 keep their parent reference intact.

 `DiscordShareMeta` is stored in `sourceMeta` when a post was created via the
 "Share to Counter" Discord command. Clients that render it show a quote card;
 the plain-text `body` is the fallback for older clients.
 */

// MARK: - Discord share metadata

/// Rich card metadata for posts created via the "Share to Counter" Discord command.
/// Mirrors `DiscordShareMeta` in packages/types/src/post.ts.
struct DiscordShareMeta: Decodable, Hashable, Sendable {
    let type: String
    let content: String
    let authorName: String
    let authorDiscordTag: String?
    let authorDiscordId: String
    let authorCounterUsername: String?
    // Optional so cards shared before avatar ingest (which lack the field) still decode.
    let authorAvatarUrl: String?
}

// MARK: - Post

struct Post: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let body: String?
    /// Set when the post was created via a Discord integration; nil otherwise.
    let sourceMeta: DiscordShareMeta?
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
    /// Up to two oldest direct replies, included by the feed for thread previews.
    /// Nil when the post has no replies or when this post is itself a reply.
    let topReplies: [Post]?
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
    var sourceMeta: DiscordShareMeta?
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
    var topReplies: [Post]?

    init(_ post: Post) {
        id = post.id; body = post.body; sourceMeta = post.sourceMeta; author = post.author
        parentId = post.parentId; repostOf = post.repostOf; topic = post.topic
        edited = post.edited; deleted = post.deleted; createdAt = post.createdAt
        updatedAt = post.updatedAt; media = post.media; tags = post.tags
        counts = post.counts; viewer = post.viewer; topReplies = post.topReplies
    }

    func build() -> Post {
        Post(id: id, body: body, sourceMeta: sourceMeta, author: author, parentId: parentId,
             repostOf: repostOf, topic: topic, edited: edited, deleted: deleted,
             createdAt: createdAt, updatedAt: updatedAt, media: media, tags: tags,
             counts: counts, viewer: viewer, topReplies: topReplies)
    }
}

/// Applies a mutation closure to a `Post` via `MutablePost` and returns the result.
func mutated(_ post: Post, _ mutation: (inout MutablePost) -> Void) -> Post {
    var m = MutablePost(post)
    mutation(&m)
    return m.build()
}

// MARK: - Media upload

/// One attachment referenced by its uploaded object id when creating a post.
/// Mirrors the API's `mediaInputSchema`: the bytes are uploaded first, then the
/// returned id is attached here.
struct MediaInputDTO: Encodable, Sendable {
    let objectId: String
    let altText: String?

    init(objectId: String, altText: String? = nil) {
        self.objectId = objectId
        self.altText = altText
    }
}

/// The response from POST /media after an upload is validated and stored.
struct MediaUploadResponse: Decodable, Sendable {
    let id: String
    let url: String
    let mimeType: String
    let width: Int?
    let height: Int?
    let sizeBytes: Int
}

// MARK: - Create requests

struct CreatePostInput: Encodable, Sendable {
    let body: String
    let topicId: String?
    let media: [MediaInputDTO]?

    init(body: String, topicId: String?, media: [MediaInputDTO]? = nil) {
        self.body = body
        self.topicId = topicId
        self.media = media
    }
}

struct CreateReplyInput: Encodable, Sendable {
    let body: String
    let media: [MediaInputDTO]?

    init(body: String, media: [MediaInputDTO]? = nil) {
        self.body = body
        self.media = media
    }
}

struct UpdatePostInput: Encodable, Sendable {
    let body: String
}

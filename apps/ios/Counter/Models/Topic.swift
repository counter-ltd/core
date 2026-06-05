/**
 Topic models: community spaces users can create, join, and post in.

 Mirrors packages/types/src/topic.ts. `TopicRef` is the lightweight version
 embedded inside `Post`; `Topic` is the full record returned by the topics API.
 */

// MARK: - Reference (embedded in posts)

struct TopicRef: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let slug: String
    let name: String
}

// MARK: - Full topic

struct Topic: Decodable, Identifiable, Sendable {
    let id: String
    let slug: String
    let name: String
    let description: String?
    let createdAt: String
    let counts: TopicCounts
    let viewer: TopicViewerState?
}

struct TopicCounts: Decodable, Sendable {
    let members: Int
    let posts: Int
}

struct TopicViewerState: Decodable, Sendable {
    let isMember: Bool
}

// MARK: - Create request

struct CreateTopicInput: Encodable, Sendable {
    let slug: String
    let name: String
    let description: String?
}

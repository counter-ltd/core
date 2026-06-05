/**
 All Counter API endpoints expressed as a typed enum.

 Each case encodes the HTTP method, path, query parameters, and request body
 for one API operation. `APIClient` unpacks these into `URLRequest` values;
 call sites never build URLs or headers manually.

 Paths mirror the current API exactly. See `apps/api/src/routes/` for the
 authoritative source.
 */

import Foundation

enum Endpoint {

    // MARK: Auth

    case login(identifier: String, password: String)
    case register(username: String, email: String, password: String, displayName: String? = nil)
    case refresh(token: String)
    case logout(refreshToken: String? = nil)
    /// Hard-deletes the authenticated account.
    case deleteAccount
    /// Register or upsert the E2EE key for one device (POST /auth/keys).
    case registerPublicKey(deviceId: String, publicKey: String)
    /// List all device keys registered for the authenticated account (GET /auth/keys).
    case authDeviceKeys

    // MARK: Users

    case me
    case updateProfile(displayName: String?, bio: String?, avatarUrl: String?)
    case presenceSettings
    case updatePresenceSettings(PresenceSettings)
    /// Records that the user is active right now. Called on the heartbeat interval.
    case heartbeat
    case userProfile(username: String)
    /// Fetch the SPKI base64 public key for a user, or null if not yet registered.
    case userPublicKey(username: String)
    case userPosts(username: String, after: String? = nil, limit: Int = 20)
    case follow(username: String)
    case unfollow(username: String)
    case followers(username: String, after: String? = nil)
    case following(username: String, after: String? = nil)

    // MARK: Posts

    case publicFeed(after: String? = nil, limit: Int = 20)
    case authenticatedFeed(after: String? = nil, limit: Int = 20)
    case thread(id: String)
    case createPost(body: String, topicId: String? = nil)
    case createReply(parentId: String, body: String)
    case updatePost(id: String, body: String)
    case deletePost(id: String)
    case like(id: String)
    case unlike(id: String)
    case repost(id: String)
    case unrepost(id: String)
    case postViews(id: String)

    // MARK: Notifications

    case notifications(after: String? = nil)
    case markNotificationRead(id: String)
    case notificationPreferences
    case updateNotificationPreferences(NotificationPreferences)

    // MARK: Devices (push tokens)

    case listDevices
    case registerDevice(token: String, platform: String, name: String? = nil)
    /// Delete by device ID (UUID from GET /devices). Used from the Privacy panel.
    case deleteDevice(id: String)
    /// Delete by raw APNs token. Used on sign-out where the ID is not locally cached.
    case unregisterDevice(token: String)

    // MARK: Search

    case search(query: String, type: SearchType, after: String? = nil)

    // MARK: Topics

    case topics
    case topic(slug: String)
    case topicPosts(slug: String, after: String? = nil)
    case createTopic(slug: String, name: String, description: String? = nil)
    case joinTopic(slug: String)
    case leaveTopic(slug: String)

    // MARK: Themes

    /// Public, keyset-paginated gallery of published themes.
    case themes(after: String? = nil)
    /// A single theme by ID (published or, with a direct link, a draft).
    case theme(id: String)

    // MARK: Messages

    case messagesInbox(after: String? = nil)
    case conversation(username: String, after: String? = nil)
    case sendMessage(username: String, body: String)
    case markConversationRead(username: String)
    /// Records a screenshot event in the conversation transcript (POST /messages/:username/screenshot).
    case reportScreenshot(username: String)
    /// Deletes all messages in the conversation but keeps the conversation row (DELETE /messages/:username/messages).
    case clearConversation(username: String)
    /// Deletes the conversation and all its messages (DELETE /messages/:username).
    case deleteConversation(username: String)
}

// MARK: - Search type

enum SearchType: String, Sendable {
    case posts
    case users
    case tags
}

// MARK: - URLRequest construction

extension Endpoint {

    var method: String {
        switch self {
        case .login, .register, .logout, .createPost, .createReply, .createTopic,
             .like, .repost, .follow, .joinTopic, .sendMessage,
             .markNotificationRead, .markConversationRead, .refresh, .registerDevice,
             .registerPublicKey, .reportScreenshot, .heartbeat:
            return "POST"
        case .updateProfile, .updatePost:
            return "PATCH"
        case .updateNotificationPreferences, .updatePresenceSettings:
            return "PUT"
        case .deleteAccount, .deletePost, .unlike, .unrepost, .unfollow, .leaveTopic,
             .unregisterDevice, .deleteDevice,
             .clearConversation, .deleteConversation:
            return "DELETE"
        default:
            return "GET"
        }
    }

    var path: String {
        switch self {
        case .login:                       return "/auth/login"
        case .register:                    return "/auth/register"
        case .refresh:                     return "/auth/refresh"
        case .logout:                      return "/auth/logout"
        case .deleteAccount:               return "/auth/account"
        case .me:                          return "/users/me"
        case .updateProfile:               return "/users/me"
        case .presenceSettings:            return "/users/me/presence"
        case .updatePresenceSettings:      return "/users/me/presence"
        case .heartbeat:                   return "/users/me/heartbeat"
        case .userProfile(let u):          return "/users/\(u)"
        case .userPublicKey(let u):        return "/users/\(u)/public-key"
        case .registerPublicKey:           return "/auth/keys"
        case .authDeviceKeys:              return "/auth/keys"
        case .userPosts(let u, _, _):      return "/users/\(u)/posts"
        case .follow(let u):               return "/users/\(u)/follow"
        case .unfollow(let u):             return "/users/\(u)/follow"
        case .followers(let u, _):         return "/users/\(u)/followers"
        case .following(let u, _):         return "/users/\(u)/following"
        case .publicFeed:                  return "/posts/public"
        case .authenticatedFeed:           return "/posts"
        case .thread(let id):              return "/posts/\(id)/thread"
        case .createPost:                  return "/posts"
        case .createReply(let id, _):      return "/posts/\(id)/reply"
        case .updatePost(let id, _):       return "/posts/\(id)"
        case .deletePost(let id):          return "/posts/\(id)"
        case .like(let id):                return "/posts/\(id)/like"
        case .unlike(let id):              return "/posts/\(id)/like"
        case .repost(let id):              return "/posts/\(id)/repost"
        case .unrepost(let id):            return "/posts/\(id)/repost"
        case .postViews(let id):           return "/posts/\(id)/views"
        case .notifications:               return "/notifications"
        case .markNotificationRead(let id): return "/notifications/\(id)/read"
        case .notificationPreferences:     return "/notifications/preferences"
        case .updateNotificationPreferences: return "/notifications/preferences"
        case .listDevices:                 return "/devices"
        case .registerDevice:              return "/devices"
        case .deleteDevice(let id):        return "/devices/by-id/\(id)"
        case .unregisterDevice(let token): return "/devices/\(token)"
        case .search:                      return "/search"
        case .topics:                      return "/topics"
        case .topic(let slug):             return "/topics/\(slug)"
        case .topicPosts(let slug, _):     return "/topics/\(slug)/posts"
        case .createTopic:                 return "/topics"
        case .joinTopic(let slug):         return "/topics/\(slug)/join"
        case .leaveTopic(let slug):        return "/topics/\(slug)/join"
        case .themes:                      return "/themes"
        case .theme(let id):               return "/themes/\(id)"
        case .messagesInbox:               return "/messages"
        case .conversation(let u, _):      return "/messages/\(u)"
        case .sendMessage(let u, _):       return "/messages/\(u)"
        case .markConversationRead(let u): return "/messages/\(u)/read"
        case .reportScreenshot(let u):     return "/messages/\(u)/screenshot"
        case .clearConversation(let u):    return "/messages/\(u)/messages"
        case .deleteConversation(let u):   return "/messages/\(u)"
        }
    }

    /// Query parameters appended to the URL for GET requests.
    var queryItems: [URLQueryItem] {
        switch self {
        case .publicFeed(let after, let limit),
             .authenticatedFeed(let after, let limit):
            return paginationItems(after: after, limit: limit)
        case .userPosts(_, let after, let limit):
            return paginationItems(after: after, limit: limit)
        case .followers(_, let after),
             .following(_, let after),
             .notifications(let after),
             .topicPosts(_, let after),
             .themes(let after),
             .messagesInbox(let after),
             .conversation(_, let after):
            return paginationItems(after: after)
        case .search(let q, let type, let after):
            var items: [URLQueryItem] = [
                .init(name: "q", value: q),
                .init(name: "type", value: type.rawValue)
            ]
            if let after { items.append(.init(name: "after", value: after)) }
            return items
        default:
            return []
        }
    }

    /// JSON-encodable body for POST/PATCH/DELETE requests.
    var bodyData: Data? {
        let encoder = JSONEncoder()
        switch self {
        case .login(let id, let pw):
            return try? encoder.encode(LoginInput(identifier: id, password: pw))
        case .register(let u, let e, let p, let d):
            return try? encoder.encode(RegisterInput(username: u, email: e, password: p, displayName: d))
        case .refresh(let token):
            return try? encoder.encode(RefreshInput(refreshToken: token))
        case .logout(let token):
            return try? encoder.encode(LogoutInput(refreshToken: token))
        case .updateProfile(let d, let b, let a):
            return try? encoder.encode(UpdateProfileInput(displayName: d, bio: b, avatarUrl: a))
        case .createPost(let body, let topicId):
            return try? encoder.encode(CreatePostInput(body: body, topicId: topicId))
        case .createReply(_, let body):
            return try? encoder.encode(CreateReplyInput(body: body))
        case .updatePost(_, let body):
            return try? encoder.encode(UpdatePostInput(body: body))
        case .createTopic(let slug, let name, let description):
            return try? encoder.encode(CreateTopicInput(slug: slug, name: name, description: description))
        case .sendMessage(_, let body):
            return try? encoder.encode(SendMessageInput(body: body))
        case .registerPublicKey(let did, let key):
            return try? encoder.encode(RegisterPublicKeyInput(deviceId: did, publicKey: key))
        case .updateNotificationPreferences(let prefs):
            return try? encoder.encode(prefs)
        case .updatePresenceSettings(let settings):
            return try? encoder.encode(settings)
        case .registerDevice(let token, let platform, let name):
            return try? encoder.encode(RegisterDeviceInput(token: token, platform: platform, name: name))
        default:
            return nil
        }
    }

    /// True for endpoints that require an Authorization header.
    var requiresAuth: Bool {
        switch self {
        case .me, .updateProfile, .deleteAccount,
             .presenceSettings, .updatePresenceSettings, .heartbeat,
             .authenticatedFeed, .createPost, .createReply, .updatePost, .deletePost,
             .like, .unlike, .repost, .unrepost,
             .follow, .unfollow,
             .notifications, .markNotificationRead,
             .notificationPreferences, .updateNotificationPreferences,
             .listDevices, .registerDevice, .unregisterDevice, .deleteDevice,
             .createTopic, .joinTopic, .leaveTopic,
             .messagesInbox, .conversation, .sendMessage, .markConversationRead,
             .reportScreenshot, .clearConversation, .deleteConversation,
             .registerPublicKey, .authDeviceKeys:
            return true
        default:
            return false
        }
    }
}

// MARK: - Helpers

private func paginationItems(after: String?, limit: Int = 20) -> [URLQueryItem] {
    var items: [URLQueryItem] = [.init(name: "limit", value: "\(limit)")]
    if let after { items.append(.init(name: "after", value: after)) }
    return items
}

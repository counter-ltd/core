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
    /// Set or change the authenticated account's password (POST /auth/password).
    case setPassword(currentPassword: String?, newPassword: String)
    /// Start enrolling a passkey for the signed-in user.
    case passkeyRegisterOptions
    /// Finish enrolling a passkey (attestation + optional label).
    case passkeyRegisterVerify(response: PasskeyRegistrationResponseJSON, nickname: String?)
    /// Start a passwordless passkey login. Public.
    case passkeyAuthOptions
    /// Finish a passwordless passkey login (assertion). Public.
    case passkeyAuthVerify(response: PasskeyAuthenticationResponseJSON)
    /// List the signed-in user's registered passkeys.
    case passkeys
    /// Remove one of the signed-in user's passkeys.
    case deletePasskey(id: String)
    /// Register or upsert the E2EE key for one device (POST /auth/keys).
    case registerPublicKey(deviceId: String, publicKey: String)
    /// List all device keys registered for the authenticated account (GET /auth/keys).
    case authDeviceKeys

    // MARK: Users

    case me
    case updateProfile(displayName: String?, bio: String?, avatar: AvatarChange)
    case presenceSettings
    case updatePresenceSettings(PresenceSettings)
    /// Records that the user is active right now. Called on the heartbeat interval.
    case heartbeat
    case userProfile(username: String)
    /// Fetch the SPKI base64 public key for a user, or null if not yet registered.
    case userPublicKey(username: String)
    case userPosts(username: String, after: String? = nil, limit: Int = 20, filter: ProfilePostFilter = .posts)
    case follow(username: String)
    case unfollow(username: String)
    case followers(username: String, after: String? = nil)
    case following(username: String, after: String? = nil)

    // MARK: Posts

    case publicFeed(after: String? = nil, limit: Int = 20)
    case authenticatedFeed(after: String? = nil, limit: Int = 20)
    case thread(id: String)
    case createPost(body: String, topicId: String? = nil, media: [MediaInputDTO]? = nil)
    case createReply(parentId: String, body: String, media: [MediaInputDTO]? = nil)
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
    /// The signed-in user's library: themes they created plus ones they saved.
    case themeLibrary
    /// Create a theme owned by the caller. `published: false` makes a draft.
    case createTheme(name: String, description: String?, variables: [String: String], published: Bool)
    /// Edit one of the caller's own themes (partial update, sent in full here).
    case updateTheme(id: String, name: String, description: String, variables: [String: String], published: Bool)
    /// Save a published theme into the caller's library.
    case saveTheme(id: String)
    /// Remove a theme from the caller's library.
    case unsaveTheme(id: String)

    // MARK: Messages

    case messagesInbox(after: String? = nil)
    case conversation(username: String, after: String? = nil)
    /// Lightweight request-state check for the thread page (GET /messages/:username/info).
    case conversationInfo(username: String)
    case sendMessage(username: String, body: String)
    case markConversationRead(username: String)
    /// Accepts an inbound message request, switching the conversation to active (POST /messages/:username/accept).
    case acceptRequest(username: String)
    /// Records a screenshot event in the conversation transcript (POST /messages/:username/screenshot).
    case reportScreenshot(username: String)
    /// Deletes all messages in the conversation but keeps the conversation row (DELETE /messages/:username/messages).
    case clearConversation(username: String)
    /// Deletes the conversation and all its messages (DELETE /messages/:username).
    case deleteConversation(username: String)

    // MARK: Tunnel Talk

    /// Create a Tunnel Talk invite for the given user (POST /tunnel/:username/invite).
    case tunnelInvite(username: String)
    /// Check for an incoming Tunnel Talk invite from the given user (GET /tunnel/:username/pending).
    case tunnelPending(username: String)
    /// Accept an incoming invite (POST /tunnel/:sessionId/accept).
    case tunnelAccept(sessionId: String)
    /// Decline an incoming invite (POST /tunnel/:sessionId/decline).
    case tunnelDecline(sessionId: String)
    /// End an active session (DELETE /tunnel/:sessionId).
    case tunnelEnd(sessionId: String)
    /// Opt in to transcript saving (PUT /tunnel/:sessionId/consent).
    case tunnelConsentOn(sessionId: String)
    /// Revoke transcript saving consent and delete the saved transcript (DELETE /tunnel/:sessionId/consent).
    case tunnelConsentOff(sessionId: String)
    /// Upload a batch of transcript messages after the session ends (POST /tunnel/:sessionId/transcript).
    case tunnelTranscript(sessionId: String, input: UploadTranscriptInput)
    /// Fetch short-lived TURN/STUN credentials for WebRTC (GET /tunnel/turn-credentials).
    case tunnelTurnCredentials

    // MARK: Algorithm transparency

    /// GET /algorithm — the live feed-ranking config (version, weights, parameters).
    case algorithm
    /// GET /algorithm/changelog — history of algorithm changes, newest first.
    case algorithmChangelog

    // MARK: Integrations (badges)

    /// GET /integrations/me — the caller's linked accounts (verified and unverified).
    case integrations
    /// PATCH /integrations/:id — toggle whether a verified badge shows on the profile.
    case patchIntegration(id: String, displayed: Bool)

    // MARK: Discord bot

    /// GET /discord-bot/settings — the caller's Thing Two subscription state.
    case discordBotSettings
    /// PUT /discord-bot/settings — update notifications and/or posting toggles.
    case updateDiscordBotSettings(UpdateDiscordBotSettingsInput)

    // MARK: OAuth

    /// POST /auth/session/exchange — trade the session code from an OAuth callback for a JWT pair.
    case oauthExchangeCode(code: String)
    /// POST /auth/:provider/connect/prepare — get the provider auth URL for linking (mobile flow).
    case oauthConnectPrepare(provider: OAuthProvider)
    /// GET /auth/:provider/me — connected account info, 404 if not linked.
    case oauthConnectedAccount(provider: OAuthProvider)
    /// DELETE /auth/:provider/disconnect — unlink an OAuth provider.
    case oauthDisconnect(provider: OAuthProvider)

    // MARK: Reports

    /// POST /reports — file a report against a post or user.
    case createReport(targetType: String, targetId: String, reason: String, detail: String?)

    // MARK: Admin

    /// GET /admin/dashboard — site-wide stats.
    case adminDashboard
    /// GET /admin/users — paginated, searchable user list.
    case adminUsers(q: String?, status: String?, after: String? = nil)
    /// POST /admin/users/:id/groups — add the user to a group.
    case adminAssignGroup(userId: String, groupId: String)
    /// DELETE /admin/users/:id/groups/:groupId — remove the user from a group.
    case adminRemoveGroup(userId: String, groupId: String)
    /// POST /admin/users/:id/ban — ban indefinitely.
    case adminBanUser(id: String, reason: String?)
    /// POST /admin/users/:id/unban — lift a ban.
    case adminUnbanUser(id: String)
    /// POST /admin/users/:id/suspend — suspend until a time.
    case adminSuspendUser(id: String, until: String, reason: String?)
    /// POST /admin/users/:id/unsuspend — end a suspension early.
    case adminUnsuspendUser(id: String)
    /// GET /admin/groups — every group with permissions and member counts.
    case adminGroups
    /// POST /admin/groups — create a group.
    case adminCreateGroup(CreateGroupInput)
    /// PATCH /admin/groups/:id — edit a group's metadata and permissions.
    case adminUpdateGroup(id: String, input: UpdateGroupInput)
    /// DELETE /admin/groups/:id — delete a non-system group.
    case adminDeleteGroup(id: String)
    /// DELETE /admin/posts/:id — remove a post as a moderator.
    case adminRemovePost(id: String)
    /// POST /admin/posts/:id/restore — restore a moderator-removed post.
    case adminRestorePost(id: String)
    /// DELETE /admin/posts/:id/nuke — hard-delete a post and its whole reply/repost tree.
    case adminNukePost(id: String)
    /// GET /admin/reports — the moderation queue.
    case adminReports(status: String?, after: String? = nil)
    /// POST /admin/reports/:id/resolve — close a report.
    case adminResolveReport(id: String, status: String)
    /// GET /admin/audit — the admin action log.
    case adminAudit(after: String? = nil)
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
             .markNotificationRead, .markConversationRead, .acceptRequest, .refresh, .registerDevice,
             .registerPublicKey, .reportScreenshot, .heartbeat, .setPassword,
             .passkeyRegisterOptions, .passkeyRegisterVerify, .passkeyAuthOptions, .passkeyAuthVerify,
             .tunnelInvite, .tunnelAccept, .tunnelDecline, .tunnelTranscript,
             .createReport, .adminAssignGroup, .adminBanUser, .adminUnbanUser,
             .adminSuspendUser, .adminUnsuspendUser, .adminCreateGroup,
             .adminRestorePost, .adminResolveReport,
             .createTheme, .saveTheme:
            return "POST"
        case .updateProfile, .updatePost, .patchIntegration, .adminUpdateGroup, .updateTheme:
            return "PATCH"
        case .updateNotificationPreferences, .updatePresenceSettings,
             .updateDiscordBotSettings,
             .tunnelConsentOn:
            return "PUT"
        case .deletePasskey:
            return "DELETE"
        case .deleteAccount, .deletePost, .unlike, .unrepost, .unfollow, .leaveTopic,
             .unregisterDevice, .deleteDevice,
             .clearConversation, .deleteConversation,
             .oauthDisconnect,
             .tunnelEnd, .tunnelConsentOff,
             .adminRemoveGroup, .adminDeleteGroup, .adminRemovePost, .adminNukePost,
             .unsaveTheme:
            return "DELETE"
        case .oauthExchangeCode, .oauthConnectPrepare:
            return "POST"
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
        case .setPassword:                 return "/auth/password"
        case .passkeyRegisterOptions:      return "/auth/passkeys/register/options"
        case .passkeyRegisterVerify:       return "/auth/passkeys/register/verify"
        case .passkeyAuthOptions:          return "/auth/passkeys/authenticate/options"
        case .passkeyAuthVerify:           return "/auth/passkeys/authenticate/verify"
        case .passkeys:                    return "/auth/passkeys"
        case .deletePasskey(let id):       return "/auth/passkeys/\(id)"
        case .me:                          return "/users/me"
        case .updateProfile:               return "/users/me"
        case .presenceSettings:            return "/users/me/presence"
        case .updatePresenceSettings:      return "/users/me/presence"
        case .heartbeat:                   return "/users/me/heartbeat"
        case .userProfile(let u):          return "/users/\(u)"
        case .userPublicKey(let u):        return "/users/\(u)/public-key"
        case .registerPublicKey:           return "/auth/keys"
        case .authDeviceKeys:              return "/auth/keys"
        case .userPosts(let u, _, _, _):   return "/users/\(u)/posts"
        case .follow(let u):               return "/users/\(u)/follow"
        case .unfollow(let u):             return "/users/\(u)/follow"
        case .followers(let u, _):         return "/users/\(u)/followers"
        case .following(let u, _):         return "/users/\(u)/following"
        case .publicFeed:                  return "/posts/public"
        case .authenticatedFeed:           return "/posts"
        case .thread(let id):              return "/posts/\(id)/thread"
        case .createPost:                  return "/posts"
        case .createReply(let id, _, _):   return "/posts/\(id)/replies"
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
        case .themeLibrary:                return "/themes/library"
        case .createTheme:                 return "/themes"
        case .theme(let id):               return "/themes/\(id)"
        case .updateTheme(let id, _, _, _, _): return "/themes/\(id)"
        case .saveTheme(let id):           return "/themes/\(id)/save"
        case .unsaveTheme(let id):         return "/themes/\(id)/save"
        case .messagesInbox:               return "/messages"
        case .conversation(let u, _):      return "/messages/\(u)"
        case .conversationInfo(let u):     return "/messages/\(u)/info"
        case .sendMessage(let u, _):       return "/messages/\(u)"
        case .markConversationRead(let u): return "/messages/\(u)/read"
        case .acceptRequest(let u):        return "/messages/\(u)/accept"
        case .reportScreenshot(let u):     return "/messages/\(u)/screenshot"
        case .clearConversation(let u):    return "/messages/\(u)/messages"
        case .deleteConversation(let u):   return "/messages/\(u)"
        case .algorithm:                   return "/algorithm"
        case .algorithmChangelog:          return "/algorithm/changelog"
        case .integrations:                return "/integrations/me"
        case .patchIntegration(let id, _): return "/integrations/\(id)"
        case .discordBotSettings:          return "/discord-bot/settings"
        case .updateDiscordBotSettings:    return "/discord-bot/settings"
        case .oauthExchangeCode:           return "/auth/session/exchange"
        case .oauthConnectPrepare(let p):  return "/auth/\(p.rawValue)/connect/prepare"
        case .oauthConnectedAccount(let p): return "/auth/\(p.rawValue)/me"
        case .oauthDisconnect(let p):      return "/auth/\(p.rawValue)/disconnect"
        case .tunnelTurnCredentials:               return "/tunnel/turn-credentials"
        case .tunnelInvite(let u):                 return "/tunnel/\(u)/invite"
        case .tunnelPending(let u):                return "/tunnel/\(u)/pending"
        case .tunnelAccept(let id):                return "/tunnel/\(id)/accept"
        case .tunnelDecline(let id):               return "/tunnel/\(id)/decline"
        case .tunnelEnd(let id):                   return "/tunnel/\(id)"
        case .tunnelConsentOn(let id):             return "/tunnel/\(id)/consent"
        case .tunnelConsentOff(let id):            return "/tunnel/\(id)/consent"
        case .tunnelTranscript(let id, _):         return "/tunnel/\(id)/transcript"
        case .createReport:                        return "/reports"
        case .adminDashboard:                      return "/admin/dashboard"
        case .adminUsers:                          return "/admin/users"
        case .adminAssignGroup(let uid, _):        return "/admin/users/\(uid)/groups"
        case .adminRemoveGroup(let uid, let gid):  return "/admin/users/\(uid)/groups/\(gid)"
        case .adminBanUser(let id, _):             return "/admin/users/\(id)/ban"
        case .adminUnbanUser(let id):              return "/admin/users/\(id)/unban"
        case .adminSuspendUser(let id, _, _):      return "/admin/users/\(id)/suspend"
        case .adminUnsuspendUser(let id):          return "/admin/users/\(id)/unsuspend"
        case .adminGroups:                         return "/admin/groups"
        case .adminCreateGroup:                    return "/admin/groups"
        case .adminUpdateGroup(let id, _):         return "/admin/groups/\(id)"
        case .adminDeleteGroup(let id):            return "/admin/groups/\(id)"
        case .adminRemovePost(let id):             return "/admin/posts/\(id)"
        case .adminRestorePost(let id):            return "/admin/posts/\(id)/restore"
        case .adminNukePost(let id):               return "/admin/posts/\(id)/nuke"
        case .adminReports:                        return "/admin/reports"
        case .adminResolveReport(let id, _):       return "/admin/reports/\(id)/resolve"
        case .adminAudit:                          return "/admin/audit"
        }
    }

    /// Query parameters appended to the URL for GET requests.
    var queryItems: [URLQueryItem] {
        switch self {
        case .publicFeed(let after, let limit),
             .authenticatedFeed(let after, let limit):
            return paginationItems(after: after, limit: limit)
        case .userPosts(_, let after, let limit, let filter):
            var items = paginationItems(after: after, limit: limit)
            items.append(.init(name: "filter", value: filter.rawValue))
            return items
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
        case .adminUsers(let q, let status, let after):
            var items = paginationItems(after: after, limit: 50)
            if let q, !q.isEmpty { items.append(.init(name: "q", value: q)) }
            if let status, !status.isEmpty { items.append(.init(name: "status", value: status)) }
            return items
        case .adminReports(let status, let after):
            var items = paginationItems(after: after, limit: 50)
            if let status, !status.isEmpty { items.append(.init(name: "status", value: status)) }
            return items
        case .adminAudit(let after):
            return paginationItems(after: after, limit: 100)
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
        case .updateProfile(let d, let b, let avatar):
            return try? encoder.encode(UpdateProfileInput(displayName: d, bio: b, avatar: avatar))
        case .createPost(let body, let topicId, let media):
            return try? encoder.encode(CreatePostInput(body: body, topicId: topicId, media: media))
        case .createReply(_, let body, let media):
            return try? encoder.encode(CreateReplyInput(body: body, media: media))
        case .updatePost(_, let body):
            return try? encoder.encode(UpdatePostInput(body: body))
        case .createTopic(let slug, let name, let description):
            return try? encoder.encode(CreateTopicInput(slug: slug, name: name, description: description))
        case .createTheme(let name, let description, let variables, let published):
            return try? encoder.encode(CreateThemeInput(name: name, description: description, variables: variables, published: published))
        case .updateTheme(_, let name, let description, let variables, let published):
            return try? encoder.encode(UpdateThemeInput(name: name, description: description, variables: variables, published: published))
        case .sendMessage(_, let body):
            return try? encoder.encode(SendMessageInput(body: body))
        case .registerPublicKey(let did, let key):
            return try? encoder.encode(RegisterPublicKeyInput(deviceId: did, publicKey: key))
        case .setPassword(let current, let new):
            return try? encoder.encode(SetPasswordInput(currentPassword: current, newPassword: new))
        case .passkeyRegisterVerify(let response, let nickname):
            return try? encoder.encode(PasskeyRegisterVerifyBody(response: response, nickname: nickname))
        case .passkeyAuthVerify(let response):
            return try? encoder.encode(PasskeyAuthVerifyBody(response: response))
        case .updateNotificationPreferences(let prefs):
            return try? encoder.encode(prefs)
        case .updatePresenceSettings(let settings):
            return try? encoder.encode(settings)
        case .registerDevice(let token, let platform, let name):
            return try? encoder.encode(RegisterDeviceInput(token: token, platform: platform, name: name))
        case .patchIntegration(_, let displayed):
            return try? encoder.encode(PatchIntegrationInput(displayed: displayed))
        case .updateDiscordBotSettings(let input):
            return try? encoder.encode(input)
        case .oauthExchangeCode(let code):
            return try? encoder.encode(OAuthSessionExchangeInput(code: code))
        case .oauthConnectPrepare:
            // mobile: true tells the API to redirect to counter:// after the callback.
            return try? encoder.encode(OAuthConnectPrepareInput(mobile: true))
        case .tunnelTranscript(_, let input):
            return try? encoder.encode(input)
        case .createReport(let tt, let tid, let reason, let detail):
            return try? encoder.encode(CreateReportInput(targetType: tt, targetId: tid, reason: reason, detail: detail))
        case .adminAssignGroup(_, let gid):
            return try? encoder.encode(AssignGroupInput(groupId: gid))
        case .adminBanUser(_, let reason):
            return try? encoder.encode(BanUserInput(reason: reason))
        case .adminSuspendUser(_, let until, let reason):
            return try? encoder.encode(SuspendUserInput(until: until, reason: reason))
        case .adminCreateGroup(let input):
            return try? encoder.encode(input)
        case .adminUpdateGroup(_, let input):
            return try? encoder.encode(input)
        case .adminResolveReport(_, let status):
            return try? encoder.encode(ResolveReportInput(status: status))
        default:
            return nil
        }
    }

    /// True for endpoints that require an Authorization header.
    var requiresAuth: Bool {
        switch self {
        case .me, .updateProfile, .deleteAccount, .setPassword,
             .passkeyRegisterOptions, .passkeyRegisterVerify, .passkeys, .deletePasskey,
             .presenceSettings, .updatePresenceSettings, .heartbeat,
             .authenticatedFeed, .createPost, .createReply, .updatePost, .deletePost,
             .like, .unlike, .repost, .unrepost,
             .follow, .unfollow,
             .notifications, .markNotificationRead,
             .notificationPreferences, .updateNotificationPreferences,
             .listDevices, .registerDevice, .unregisterDevice, .deleteDevice,
             .createTopic, .joinTopic, .leaveTopic,
             .messagesInbox, .conversation, .conversationInfo, .sendMessage,
             .markConversationRead, .acceptRequest,
             .reportScreenshot, .clearConversation, .deleteConversation,
             .registerPublicKey, .authDeviceKeys,
             .oauthConnectPrepare, .oauthConnectedAccount, .oauthDisconnect,
             .integrations, .patchIntegration,
             .discordBotSettings, .updateDiscordBotSettings,
             .createReport, .adminDashboard, .adminUsers, .adminAssignGroup,
             .adminRemoveGroup, .adminBanUser, .adminUnbanUser, .adminSuspendUser,
             .adminUnsuspendUser, .adminGroups, .adminCreateGroup, .adminUpdateGroup,
             .adminDeleteGroup, .adminRemovePost, .adminRestorePost, .adminNukePost, .adminReports,
             .adminResolveReport, .adminAudit,
             .themeLibrary, .createTheme, .updateTheme, .saveTheme, .unsaveTheme:
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

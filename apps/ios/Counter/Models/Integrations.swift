/**
 Models for the Thing Two Discord bot integration.

 `DiscordBotSettings` is the shape returned by GET /discord-bot/settings and
 after a successful PUT. Both `enabled` and `postingEnabled` default to false
 when the user has no subscription row yet.
 */

import Foundation

/// Thing Two Discord bot subscription state for the current user.
struct DiscordBotSettings: Decodable, Sendable {
    /// Whether Counter notification DMs are enabled.
    let enabled: Bool
    /// Whether the user is in the Counter Discord server (checked at enable time).
    let inGuild: Bool
    /// Whether posting from Discord via /post or "Share to Counter" is enabled.
    let postingEnabled: Bool
}

/// Body for PUT /discord-bot/settings.
struct UpdateDiscordBotSettingsInput: Encodable, Sendable {
    let enabled: Bool
    /// Only include when toggling the posting setting; omit to leave it unchanged.
    let postingEnabled: Bool?
}

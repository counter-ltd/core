/**
 Theme models: a shareable palette of CSS-variable overrides.

 Mirrors packages/types/src/theme.ts. A theme is just a flat map of CSS custom
 properties (`--color-bg`, `--color-accent`, …) to string values. The web app
 drops that map into a `:root` block; the iOS app resolves the `--color-*`
 entries into native `Color`s via `CounterPalette`. Values arrive already
 validated by the API (keys match `--[a-z0-9-]+`, values can't contain `;{}<>`),
 so the client never re-validates, it only parses what it understands and
 ignores the rest.
 */

// MARK: - Theme

/// A published or draft theme as returned by `GET /themes` and `GET /themes/:id`.
///
/// `Encodable` as well as `Decodable` so the active selection can be cached
/// verbatim in `UserDefaults`, letting an applied theme survive a relaunch
/// with no network round-trip.
struct Theme: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let description: String?
    /// Flat map of CSS custom property name to value, e.g. `["--color-bg": "#0c0c0d"]`.
    let variables: [String: String]
    let published: Bool
    /// True for Counter's curated catalog. The Browse list badges these.
    let official: Bool
    /// Nil for built-in themes that have no user author.
    let author: ThemeAuthor?
    let createdAt: String
    let updatedAt: String
}

/// The user who created a theme. Absent on built-in themes.
struct ThemeAuthor: Codable, Hashable, Sendable {
    let id: String
    let username: String
}

// MARK: - Library

/// The signed-in user's theme library, as returned by `GET /themes/library`.
///
/// `created` are themes the user authored (drafts included, since they own
/// them); `saved` are published themes they kept from someone else's gallery.
/// Kept as two lists, matching the API, so the UI can label each section
/// without re-deriving ownership on the client.
struct ThemeLibrary: Decodable, Sendable {
    let created: [Theme]
    let saved: [Theme]
}

// MARK: - Create

/// Body for `POST /themes`. `published: false` makes a private draft that only
/// shows in the author's library; `true` publishes it to the public gallery.
struct CreateThemeInput: Encodable, Sendable {
    let name: String
    let description: String?
    let variables: [String: String]
    let published: Bool
}

/// Body for `PATCH /themes/:id` (editing one of your own themes). `description`
/// is sent as a plain string ("" to clear) rather than nullable, which keeps the
/// encoding simple since Swift would otherwise drop a nil key.
struct UpdateThemeInput: Encodable, Sendable {
    let name: String
    let description: String
    let variables: [String: String]
    let published: Bool
}

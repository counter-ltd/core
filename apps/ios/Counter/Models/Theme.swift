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

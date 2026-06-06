/**
 Theme selection state: the active base scheme, the applied custom theme, and
 the browsable gallery.

 `ThemeStore` owns everything about appearance. It computes the live
 `CounterPalette` that `CounterApp` injects into the environment, and persists
 the user's choice to `UserDefaults` so it survives relaunch. Persistence is
 device-local by design (mirroring the web's `localStorage` approach); nothing
 about the chosen theme is synced to the server.

 The gallery is the public `GET /themes` listing, keyset-paginated the same way
 every other Counter list endpoint is.
 */

import Foundation
import Observation

/// The base appearance a custom theme layers on top of.
enum BaseScheme: String, Sendable {
    case dark
    case light
}

@Observable
final class ThemeStore {

    /// The chosen base appearance. Drives both the fallback palette and the
    /// app's `preferredColorScheme`.
    var base: BaseScheme = .dark {
        didSet { persist() }
    }

    /// The applied custom theme, or nil for a plain base palette.
    var selectedTheme: Theme? {
        didSet { persist() }
    }

    /// Themes loaded from the public gallery, in fetch order.
    private(set) var gallery: [Theme] = []

    /// Cursor for the next gallery page; nil once the end is reached.
    private(set) var nextCursor: String?

    /// True while a gallery page is in flight.
    private(set) var isLoading = false

    /// Whether the first gallery page has been fetched yet this session.
    private var hasLoadedGallery = false

    /// The signed-in user's own themes, drafts included. Newest first.
    private(set) var created: [Theme] = []

    /// Themes the user saved from other people's galleries. Newest-saved first.
    private(set) var saved: [Theme] = []

    /// Whether the library has been fetched yet this session.
    private var hasLoadedLibrary = false

    /// Every theme id already in the library (created or saved), so Browse can
    /// hide Save on themes the user already has.
    var savedThemeIds: Set<String> {
        Set(created.map(\.id)).union(saved.map(\.id))
    }

    /// The resolved palette to render with: the base scheme's defaults, with
    /// the selected theme's overrides layered on top.
    var palette: CounterPalette {
        let baseline: CounterPalette = base == .dark ? .dark : .light
        return CounterPalette.resolve(base: baseline, variables: selectedTheme?.variables ?? [:])
    }

    // MARK: - Persistence

    private enum Key {
        static let base = "counter.theme.base"
        static let selected = "counter.theme.selected"
    }

    /// Restores the saved base scheme and applied theme. Call once at launch,
    /// before the first frame, so the initial palette is already correct.
    func load() {
        let defaults = UserDefaults.standard
        if let raw = defaults.string(forKey: Key.base), let scheme = BaseScheme(rawValue: raw) {
            base = scheme
        }
        if let data = defaults.data(forKey: Key.selected),
           let theme = try? JSONDecoder().decode(Theme.self, from: data) {
            selectedTheme = theme
        }
    }

    private func persist() {
        let defaults = UserDefaults.standard
        defaults.set(base.rawValue, forKey: Key.base)
        if let theme = selectedTheme, let data = try? JSONEncoder().encode(theme) {
            defaults.set(data, forKey: Key.selected)
        } else {
            defaults.removeObject(forKey: Key.selected)
        }
    }

    // MARK: - Reset

    /// Clears the custom theme, falling back to the plain base palette.
    func useDefault() {
        selectedTheme = nil
    }

    /// Applies a theme from the gallery. Takes effect immediately because
    /// `CounterApp` re-reads `palette` whenever this store changes.
    func apply(_ theme: Theme) {
        selectedTheme = theme
    }

    // MARK: - Gallery

    /// Loads the first page of the public gallery, once per session. Repeated
    /// calls are no-ops so reopening the gallery screen doesn't refetch.
    func loadGalleryIfNeeded(client: APIClient) async {
        guard !hasLoadedGallery else { return }
        hasLoadedGallery = true
        await fetchPage(after: nil, client: client)
    }

    /// Loads the next gallery page if one exists and we're not already loading.
    func loadMore(client: APIClient) async {
        guard let cursor = nextCursor, !isLoading else { return }
        await fetchPage(after: cursor, client: client)
    }

    private func fetchPage(after: String?, client: APIClient) async {
        isLoading = true
        defer { isLoading = false }

        let result: APIResult<Page<Theme>> = await client.request(.themes(after: after))
        guard case .success(let page) = result else { return }
        gallery.append(contentsOf: page.data)
        nextCursor = page.nextCursor
    }

    // MARK: - Library

    /// Loads the library once per session. The Browse gallery is public, but the
    /// library is per-user, so it only fetches when the user opens the screen.
    func loadLibraryIfNeeded(client: APIClient) async {
        guard !hasLoadedLibrary else { return }
        hasLoadedLibrary = true
        await reloadLibrary(client: client)
    }

    /// Re-fetches the library. Used after create/save/unsave so the lists and
    /// the `savedThemeIds` dedupe set reflect the server without a guess.
    func reloadLibrary(client: APIClient) async {
        let result: APIResult<ThemeLibrary> = await client.request(.themeLibrary)
        guard case .success(let library) = result else { return }
        created = library.created
        saved = library.saved
    }

    /// Saves a published theme into the library. Optimistically prepends it so
    /// the UI updates instantly; a failed call reloads to resync.
    func save(_ theme: Theme, client: APIClient) async {
        guard !savedThemeIds.contains(theme.id) else { return }
        saved.insert(theme, at: 0)
        let result = await client.requestEmpty(.saveTheme(id: theme.id))
        if case .success = result { return }
        await reloadLibrary(client: client)
    }

    /// Removes a theme from the library. Optimistic, with a reload on failure.
    func unsave(_ theme: Theme, client: APIClient) async {
        saved.removeAll { $0.id == theme.id }
        let result = await client.requestEmpty(.unsaveTheme(id: theme.id))
        if case .success = result { return }
        await reloadLibrary(client: client)
    }

    /// Deletes one of the user's own themes. Drops it from `created`, the
    /// gallery, and clears the selection if it was applied. Reloads on failure.
    func delete(_ theme: Theme, client: APIClient) async {
        created.removeAll { $0.id == theme.id }
        gallery.removeAll { $0.id == theme.id }
        if selectedTheme?.id == theme.id { useDefault() }
        let result = await client.requestEmpty(.theme(id: theme.id))
        if case .success = result { return }
        await reloadLibrary(client: client)
    }

    /// Creates a theme owned by the user. Returns whether it succeeded so the
    /// editor can switch tabs. A published theme also lands in the gallery.
    func createTheme(
        name: String,
        description: String?,
        variables: [String: String],
        published: Bool,
        client: APIClient
    ) async -> Bool {
        let result: APIResult<Theme> = await client.request(
            .createTheme(name: name, description: description, variables: variables, published: published)
        )
        guard case .success(let theme) = result else { return false }
        created.insert(theme, at: 0)
        if published { gallery.insert(theme, at: 0) }
        return true
    }

    /// Edits one of the user's own themes. Replaces it in `created` and the
    /// gallery, and re-applies it live if it's the active theme so the edit
    /// shows immediately. Returns whether it succeeded.
    func updateTheme(
        id: String,
        name: String,
        description: String,
        variables: [String: String],
        published: Bool,
        client: APIClient
    ) async -> Bool {
        let result: APIResult<Theme> = await client.request(
            .updateTheme(id: id, name: name, description: description, variables: variables, published: published)
        )
        guard case .success(let theme) = result else { return false }

        replace(theme, in: &created)
        if gallery.contains(where: { $0.id == id }) { replace(theme, in: &gallery) }
        // Keep a published edit in the gallery and pull a now-private one out.
        if !published { gallery.removeAll { $0.id == id } }
        if selectedTheme?.id == id { apply(theme) }
        return true
    }

    /// Swaps the theme with a matching id in place, preserving list order.
    private func replace(_ theme: Theme, in list: inout [Theme]) {
        if let i = list.firstIndex(where: { $0.id == theme.id }) { list[i] = theme }
    }
}

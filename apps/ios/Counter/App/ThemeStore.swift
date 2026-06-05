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
}

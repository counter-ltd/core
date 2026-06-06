/**
 The themes screen: Library, Browse, and Create behind a segmented control.

 Mirrors the web's three-section themes page. **Browse** is the public gallery
 (`GET /themes`, keyset-paginated). **Library** is the signed-in user's own
 themes plus the ones they saved (`GET /themes/library`). **Create** is a live
 editor. Tapping a row applies that theme instantly through `ThemeStore`; the
 change propagates app-wide via the `\.counterTheme` environment. Applying stays
 device-local, only library membership (created + saved) is server-synced.

 This screen is only reachable from Settings, so it always has an authenticated
 user, which is why none of the tabs guard for a logged-out state.
 */

import SwiftUI

/// The three sections of the themes screen.
enum ThemeTab: String, CaseIterable, Sendable {
    case library = "Library"
    case browse = "Browse"
    case create = "Create"
}

struct ThemeGalleryView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme

    @State private var tab: ThemeTab = .library
    /// The theme loaded into the Create editor for editing, or nil for a fresh
    /// one. Set from a created-theme row's Edit action.
    @State private var editingTheme: Theme?

    var body: some View {
        let store = env.themeStore

        ZStack {
            theme.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                Picker("Section", selection: $tab) {
                    ForEach(ThemeTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(CounterSpacing.md)

                switch tab {
                case .library: libraryList(store)
                case .browse: browseList(store)
                case .create:
                    // .id re-seeds the editor when the target changes (a new
                    // theme to edit, or back to a blank create).
                    ThemeCreateView(
                        editing: editingTheme,
                        onStartNew: { editingTheme = nil }
                    ) {
                        editingTheme = nil
                        tab = .library
                    }
                    .id(editingTheme?.id ?? "new")
                }
            }
        }
        .navigationTitle("Themes")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // Both fetch once per session; reopening the screen won't refetch.
            await env.loadThemeGallery()
            await env.loadThemeLibrary()
        }
    }

    // MARK: - Library

    private func libraryList(_ store: ThemeStore) -> some View {
        List {
            Section("Created by you") {
                if store.created.isEmpty {
                    emptyRow("Nothing yet. Make one in Create.")
                } else {
                    ForEach(store.created) { item in
                        row(item, store: store, badge: item.official ? "Official" : (item.published ? nil : "Draft"))
                            // Official themes are catalog-managed: no edit or
                            // delete, even though the brand account owns them.
                            .swipeActions(edge: .leading) {
                                if !item.official {
                                    Button {
                                        editingTheme = item
                                        tab = .create
                                    } label: { Label("Edit", systemImage: "pencil") }
                                    .tint(theme.accent)
                                }
                            }
                            .swipeActions(edge: .trailing) {
                                if !item.official {
                                    Button(role: .destructive) {
                                        Task { await env.deleteTheme(item) }
                                    } label: { Label("Delete", systemImage: "trash") }
                                }
                            }
                    }
                }
            }

            Section("Saved") {
                if store.saved.isEmpty {
                    emptyRow("Nothing saved. Find themes in Browse.")
                } else {
                    ForEach(store.saved) { item in
                        row(item, store: store, badge: nil)
                            .swipeActions(edge: .trailing) {
                                Button {
                                    Task { await env.unsaveTheme(item) }
                                } label: { Label("Unsave", systemImage: "bookmark.slash") }
                            }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(theme.bg)
    }

    // MARK: - Browse

    private func browseList(_ store: ThemeStore) -> some View {
        List {
            ForEach(store.gallery) { item in
                let inLibrary = store.savedThemeIds.contains(item.id)
                let badge = item.official ? "Official" : (inLibrary ? "In library" : nil)
                row(item, store: store, badge: badge)
                    .swipeActions(edge: .trailing) {
                        // Save lives behind a swipe, the inverse of Library's
                        // Unsave. Already-saved rows show the badge instead.
                        if !inLibrary {
                            Button {
                                Task { await env.saveTheme(item) }
                            } label: { Label("Save", systemImage: "bookmark") }
                            .tint(theme.accent)
                        }
                    }
                    .onAppear {
                        // Standard keyset infinite-scroll cue: the last known row
                        // appearing triggers the next page.
                        if item.id == store.gallery.last?.id {
                            Task { await env.loadMoreThemes() }
                        }
                    }
            }

            if store.isLoading {
                HStack {
                    Spacer()
                    ProgressView().tint(theme.textDim)
                    Spacer()
                }
                .listRowBackground(theme.bg)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(theme.bg)
        .overlay {
            if store.gallery.isEmpty && !store.isLoading {
                Text("No themes published yet.")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.textDim)
            }
        }
    }

    // MARK: - Shared row

    /// One theme row: tap to apply, with an optional status badge. The caller
    /// attaches whatever swipe action fits its tab (save / unsave / delete).
    private func row(_ item: Theme, store: ThemeStore, badge: String?) -> some View {
        ThemeRow(
            theme: item,
            base: store.base,
            isSelected: item.id == store.selectedTheme?.id,
            badge: badge
        )
        .contentShape(Rectangle())
        .onTapGesture { store.apply(item) }
        .listRowBackground(theme.surface)
    }

    private func emptyRow(_ text: String) -> some View {
        Text(text)
            .font(CounterFont.body(14))
            .foregroundStyle(theme.textDim)
            .listRowBackground(theme.surface)
    }
}

// MARK: - Row

/// One theme entry: name, optional author and status badge, and a swatch strip
/// resolved against the active base so it previews exactly what applying does.
private struct ThemeRow: View {
    @Environment(\.counterTheme) private var theme
    let model: Theme
    let base: BaseScheme
    let isSelected: Bool
    let badge: String?

    init(theme: Theme, base: BaseScheme, isSelected: Bool, badge: String?) {
        self.model = theme
        self.base = base
        self.isSelected = isSelected
        self.badge = badge
    }

    var body: some View {
        let preview = CounterPalette.resolve(
            base: base == .dark ? .dark : .light,
            variables: model.variables
        )

        VStack(alignment: .leading, spacing: CounterSpacing.sm) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.name)
                        .font(CounterFont.body(15))
                        .foregroundStyle(theme.text)
                    if let author = model.author {
                        Text("@\(author.username)")
                            .font(CounterFont.mono(12))
                            .foregroundStyle(theme.textDim)
                    }
                    if let badge {
                        Text(badge)
                            .font(CounterFont.mono(11))
                            .foregroundStyle(theme.textFaint)
                    }
                }
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.accent)
                }
            }

            swatches(preview)
        }
        .padding(.vertical, CounterSpacing.xs)
    }

    private func swatches(_ p: CounterPalette) -> some View {
        HStack(spacing: 0) {
            ForEach(Array([p.bg, p.surface, p.accent, p.accent2, p.text, p.like, p.repost].enumerated()), id: \.offset) { _, color in
                Rectangle().fill(color)
            }
        }
        .frame(height: 18)
        .clipShape(RoundedRectangle(cornerRadius: CounterRadius.sm))
        .overlay(
            RoundedRectangle(cornerRadius: CounterRadius.sm)
                .strokeBorder(theme.border, lineWidth: 0.5)
        )
    }
}

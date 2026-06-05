/**
 The public theme gallery: browse and apply published themes.

 Themes come from `GET /themes`, keyset-paginated. Each row previews the theme
 as a strip of color swatches resolved against the current base scheme, so the
 list reads as a palette browser. Tapping a row applies it instantly through
 `ThemeStore`; the change propagates app-wide via the environment.
 */

import SwiftUI

struct ThemeGalleryView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme

    var body: some View {
        let store = env.themeStore

        ZStack {
            theme.bg.ignoresSafeArea()

            List {
                ForEach(store.gallery) { item in
                    ThemeRow(theme: item, base: store.base, isSelected: item.id == store.selectedTheme?.id)
                        .contentShape(Rectangle())
                        .onTapGesture { store.apply(item) }
                        .listRowBackground(theme.surface)
                        .onAppear {
                            // Trigger the next page as the last known row scrolls
                            // into view, the standard keyset infinite-scroll cue.
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

            if store.gallery.isEmpty && !store.isLoading {
                Text("No themes yet.")
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.textDim)
            }
        }
        .navigationTitle("Themes")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // Fetches once per session; reopening the screen won't refetch.
            await env.loadThemeGallery()
        }
    }
}

// MARK: - Row

/// One gallery entry: name, author, swatch strip, and a selected checkmark.
private struct ThemeRow: View {
    @Environment(\.counterTheme) private var theme
    let model: Theme
    let base: BaseScheme
    let isSelected: Bool

    init(theme: Theme, base: BaseScheme, isSelected: Bool) {
        self.model = theme
        self.base = base
        self.isSelected = isSelected
    }

    var body: some View {
        // Resolve the theme against the active base so swatches preview exactly
        // what applying it would produce.
        let preview = CounterPalette.resolve(
            base: base == .dark ? .dark : .light,
            variables: model.variables
        )

        VStack(alignment: .leading, spacing: CounterSpacing.sm) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.name)
                        .font(CounterFont.body(15))
                        .foregroundStyle(theme.text)
                    if let author = model.author {
                        Text("@\(author.username)")
                            .font(CounterFont.mono(12))
                            .foregroundStyle(theme.textDim)
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

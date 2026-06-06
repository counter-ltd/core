/**
 The live theme editor.

 A colour picker for each editable token (`themeColorTokens`) over an example
 post that recolours in real time as you drag. The preview is themed by a
 `CounterPalette` built straight from the editor's working colours and passed
 down explicitly, so only the example recolours, the surrounding editor chrome
 stays on the real app theme.

 Committing maps the chosen `Color`s back to `#rrggbb` strings (`Color.hexString`)
 and posts them. "Save to library" makes a private draft (`published: false`);
 "Publish" makes it public. On success the parent screen flips to the Library
 tab via `onCommit`.
 */

import SwiftUI

struct ThemeCreateView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme

    /// The theme being edited, or nil when authoring a fresh one. The parent
    /// re-creates this view (via `.id`) when the target changes, so seeding in
    /// `init` is enough, no need to react to later changes.
    let editing: Theme?

    /// Called after a successful save, publish, or edit, so the parent can clear
    /// edit state and switch tabs.
    var onCommit: () -> Void

    /// Called when the user abandons an edit to author a fresh theme instead.
    /// Only shown in edit mode.
    var onStartNew: (() -> Void)?

    @State private var name: String
    @State private var description: String
    /// Working colours keyed by CSS variable.
    @State private var colors: [String: Color]
    @State private var isSubmitting = false

    init(editing: Theme? = nil, onStartNew: (() -> Void)? = nil, onCommit: @escaping () -> Void) {
        self.editing = editing
        self.onStartNew = onStartNew
        self.onCommit = onCommit
        _name = State(initialValue: editing?.name ?? "")
        _description = State(initialValue: editing?.description ?? "")
        // Seed each token from the theme being edited when present, else from the
        // token's default. A theme value that can't be parsed (an unexpected
        // format) falls back to the default rather than a blank picker.
        let seed = themeColorTokens.reduce(into: [String: Color]()) { acc, token in
            let raw = editing?.variables[token.key]
            acc[token.key] = raw.flatMap { Color(cssString: $0) } ?? (Color(cssString: token.defaultHex) ?? .black)
        }
        _colors = State(initialValue: seed)
    }

    var body: some View {
        List {
            Section {
                ThemePreviewCard(palette: previewPalette)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(theme.bg)
            } header: {
                Text("Live preview")
            }

            if editing != nil, let onStartNew {
                Section {
                    Button("Start a new theme instead") { onStartNew() }
                        .font(CounterFont.body(14))
                        .foregroundStyle(theme.accent)
                        .listRowBackground(theme.surface)
                } header: {
                    Text("Editing")
                }
            }

            Section("Details") {
                TextField("Name", text: $name)
                    .listRowBackground(theme.surface)
                TextField("Description (optional)", text: $description)
                    .listRowBackground(theme.surface)
            }

            Section("Colours") {
                ForEach(themeColorTokens) { token in
                    ColorPicker(token.label, selection: binding(for: token.key), supportsOpacity: false)
                        .font(CounterFont.body(14))
                        .foregroundStyle(theme.text)
                        .listRowBackground(theme.surface)
                }
            }

            Section {
                Button("Save to library") { submit(published: false) }
                    .font(CounterFont.body(15))
                    .foregroundStyle(canSubmit ? theme.text : theme.textFaint)
                    .listRowBackground(theme.surface)
                Button("Publish") { submit(published: true) }
                    .font(CounterFont.body(15))
                    .foregroundStyle(canSubmit ? theme.accent : theme.textFaint)
                    .listRowBackground(theme.surface)
            }
            .disabled(!canSubmit)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(theme.bg)
    }

    // MARK: - Helpers

    /// A name is required, and we block double-submits while a request is open.
    private var canSubmit: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !isSubmitting
    }

    /// Binding that reads/writes one token's colour. Returns black for a missing
    /// key, which can't happen since the map is seeded with every token.
    private func binding(for key: String) -> Binding<Color> {
        Binding(
            get: { colors[key] ?? .black },
            set: { colors[key] = $0 }
        )
    }

    /// The preview palette, built directly from the working colours. No CSS
    /// round-trip: the editor already holds real `Color`s, so resolve straight.
    private var previewPalette: CounterPalette {
        func c(_ key: String, _ fallback: Color) -> Color { colors[key] ?? fallback }
        let base = CounterPalette.dark
        return CounterPalette(
            bg: c("--color-bg", base.bg),
            bg2: c("--color-bg-2", base.bg2),
            surface: c("--color-surface", base.surface),
            surfaceStrong: c("--color-surface-strong", base.surfaceStrong),
            border: c("--color-border", base.border),
            borderBright: c("--color-border-bright", base.borderBright),
            text: c("--color-text", base.text),
            textDim: c("--color-text-dim", base.textDim),
            textFaint: c("--color-text-faint", base.textFaint),
            accent: c("--color-accent", base.accent),
            accent2: c("--color-accent-2", base.accent2),
            accentContrast: c("--color-accent-contrast", base.accentContrast),
            like: c("--color-like", base.like),
            repost: c("--color-repost", base.repost),
            danger: c("--color-danger", base.danger)
        )
    }

    private func submit(published: Bool) {
        guard canSubmit else { return }
        isSubmitting = true

        // Serialize each working colour to a hex string for the variables map.
        let variables = Dictionary(uniqueKeysWithValues: colors.map { ($0.key, $0.value.hexString) })
        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        let trimmedDesc = description.trimmingCharacters(in: .whitespaces)

        Task {
            let ok: Bool
            if let editing {
                // Edit sends description as a plain string ("" clears it).
                ok = await env.updateTheme(
                    id: editing.id,
                    name: trimmedName,
                    description: trimmedDesc,
                    variables: variables,
                    published: published
                )
            } else {
                ok = await env.createTheme(
                    name: trimmedName,
                    description: trimmedDesc.isEmpty ? nil : trimmedDesc,
                    variables: variables,
                    published: published
                )
            }
            isSubmitting = false
            if ok { onCommit() }
        }
    }
}

// MARK: - Preview card

/// A self-contained example post plus UI chrome, coloured by an explicit
/// palette so it can show a work-in-progress theme without affecting the
/// surrounding screen.
private struct ThemePreviewCard: View {
    let palette: CounterPalette

    var body: some View {
        let p = palette

        VStack(alignment: .leading, spacing: CounterSpacing.md) {
            // Example post.
            VStack(alignment: .leading, spacing: CounterSpacing.sm) {
                HStack(spacing: CounterSpacing.sm) {
                    Circle()
                        .fill(p.surfaceStrong)
                        .frame(width: 34, height: 34)
                        .overlay(Circle().strokeBorder(p.borderBright, lineWidth: 1))
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text("Ada Lovelace").font(CounterFont.body(14).weight(.semibold)).foregroundStyle(p.text)
                            Text("@ada").font(CounterFont.mono(12)).foregroundStyle(p.textDim)
                        }
                        Text("2h").font(CounterFont.mono(11)).foregroundStyle(p.textFaint)
                    }
                    Spacer()
                }
                Text("A theme is just colours. Drag below and watch this post follow along.")
                    .font(CounterFont.body(14))
                    .foregroundStyle(p.text)
                HStack(spacing: CounterSpacing.lg) {
                    Text("reply 12").foregroundStyle(p.textDim)
                    Text("repost 4").foregroundStyle(p.repost)
                    Text("like 28").foregroundStyle(p.like)
                    Text("views 1.2k").foregroundStyle(p.textDim)
                }
                .font(CounterFont.mono(11))
            }
            .padding(CounterSpacing.md)
            .background(p.surface)
            .clipShape(RoundedRectangle(cornerRadius: CounterRadius.md))
            .overlay(RoundedRectangle(cornerRadius: CounterRadius.md).strokeBorder(p.border, lineWidth: 1))

            // Buttons + pill.
            HStack(spacing: CounterSpacing.sm) {
                Text("Primary")
                    .font(CounterFont.mono(13))
                    .padding(.horizontal, CounterSpacing.md)
                    .padding(.vertical, CounterSpacing.sm)
                    .background(p.accent)
                    .foregroundStyle(p.accentContrast)
                    .clipShape(RoundedRectangle(cornerRadius: CounterRadius.sm))
                Text("Secondary")
                    .font(CounterFont.mono(13))
                    .padding(.horizontal, CounterSpacing.md)
                    .padding(.vertical, CounterSpacing.sm)
                    .foregroundStyle(p.text)
                    .overlay(RoundedRectangle(cornerRadius: CounterRadius.sm).strokeBorder(p.borderBright, lineWidth: 1))
                Text("TOPIC")
                    .font(CounterFont.mono(10))
                    .padding(.horizontal, CounterSpacing.sm)
                    .padding(.vertical, 4)
                    .background(p.surfaceStrong)
                    .foregroundStyle(p.textDim)
                    .clipShape(RoundedRectangle(cornerRadius: CounterRadius.sm))
                    .overlay(RoundedRectangle(cornerRadius: CounterRadius.sm).strokeBorder(p.border, lineWidth: 0.5))
                Spacer()
            }
        }
        .padding(CounterSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(p.bg)
    }
}

/**
 The live theme editor.

 A colour picker for each token (`themeColorTokens`) plus typography, geometry,
 and surface controls, over an example post that updates in real time. The
 preview is themed by a `CounterPalette` built from the editor's working colours
 and the style knobs, passed down explicitly, so only the example changes, not
 the surrounding editor chrome.

 Presets seed the whole set; the user tweaks from there. On submit the colours
 serialize to `#rrggbb` and the style knobs to their `--*` tokens, then
 `expandThemeVariables` derives the font stacks and radius scale so the theme
 renders the same on the web. "Save to library" makes a draft; "Publish" makes it
 public. On success the parent flips to the Library tab via `onCommit`.
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
    // Style knobs.
    @State private var fontDesign: String
    @State private var roundness: Double
    @State private var glass: Bool
    @State private var shadow: Bool
    @State private var isSubmitting = false

    private let fontOptions: [(value: String, label: String)] = [
        ("default", "System"),
        ("mono", "Monospace"),
        ("serif", "Serif"),
        ("rounded", "Rounded"),
    ]

    init(editing: Theme? = nil, onStartNew: (() -> Void)? = nil, onCommit: @escaping () -> Void) {
        self.editing = editing
        self.onStartNew = onStartNew
        self.onCommit = onCommit
        _name = State(initialValue: editing?.name ?? "")
        _description = State(initialValue: editing?.description ?? "")
        let v = editing?.variables
        // Seed each colour from the theme being edited, else from the token's
        // default. An unparseable value falls back rather than showing black.
        let seed = themeColorTokens.reduce(into: [String: Color]()) { acc, token in
            acc[token.key] = v?[token.key].flatMap { Color(cssString: $0) }
                ?? (Color(cssString: token.defaultHex) ?? .black)
        }
        _colors = State(initialValue: seed)
        _fontDesign = State(initialValue: v?["--font-design"] ?? "default")
        _roundness = State(initialValue: Double((v?["--radius"] ?? "3").replacingOccurrences(of: "px", with: "")) ?? 3)
        // A fresh theme opens flat (matching the Default preset and the web);
        // editing reads the theme's own surface treatment.
        let style = v.map { CounterStyle.resolve(variables: $0) }
        _glass = State(initialValue: style?.glass ?? false)
        _shadow = State(initialValue: style?.shadow ?? false)
    }

    var body: some View {
        List {
            Section {
                ThemePreviewCard(
                    palette: previewPalette,
                    radius: CGFloat(roundness),
                    glass: glass,
                    fontDesign: CounterStyle.design(from: fontDesign)
                )
                .listRowInsets(EdgeInsets())
                .listRowBackground(theme.bg)
            } header: {
                Text("Live preview")
            }

            if editing != nil, let onStartNew {
                Section("Editing") {
                    Button("Start a new theme instead") { onStartNew() }
                        .font(CounterFont.body(14))
                        .foregroundStyle(theme.accent)
                        .listRowBackground(theme.surface)
                }
            }

            Section("Details") {
                TextField("Name", text: $name)
                    .listRowBackground(theme.surface)
                TextField("Description (optional)", text: $description)
                    .listRowBackground(theme.surface)
            }

            Section("Type") {
                Picker("Font", selection: $fontDesign) {
                    ForEach(fontOptions, id: \.value) { Text($0.label).tag($0.value) }
                }
                .foregroundStyle(theme.text)
                .listRowBackground(theme.surface)
            }

            Section("Shape") {
                VStack(alignment: .leading) {
                    HStack {
                        Text("Corner roundness").font(CounterFont.body(14)).foregroundStyle(theme.text)
                        Spacer()
                        Text("\(Int(roundness))px").font(CounterFont.mono(12)).foregroundStyle(theme.textDim)
                    }
                    Slider(value: $roundness, in: 0...24, step: 1)
                }
                .listRowBackground(theme.surface)
            }

            Section("Surface") {
                Toggle("Glass", isOn: $glass)
                    .foregroundStyle(theme.text)
                    .listRowBackground(theme.surface)
                Toggle("Drop shadow", isOn: $shadow)
                    .foregroundStyle(theme.text)
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

    /// Binding that reads/writes one token's colour.
    private func binding(for key: String) -> Binding<Color> {
        Binding(get: { colors[key] ?? .black }, set: { colors[key] = $0 })
    }

    /// The preview palette, built directly from the working colours.
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

        // Start from the edited theme so tokens the editor doesn't manage (e.g.
        // density) survive, then overwrite colours and the style knobs.
        var variables = editing?.variables ?? [:]
        for token in themeColorTokens {
            variables[token.key] = colors[token.key]?.hexString ?? token.defaultHex
        }
        variables["--font-design"] = fontDesign
        variables["--radius"] = "\(Int(roundness))px"
        variables["--surface-blur"] = glass ? "14px" : "0px"
        variables["--surface-opacity"] = glass ? "0.6" : "1"
        variables["--surface-shadow"] = shadow ? "0 8px 30px rgba(0,0,0,0.45)" : "none"
        variables["--letter-spacing"] = fontDesign == "mono" ? "0.01em" : (variables["--letter-spacing"] ?? "0em")
        // Derive --font / --font-heading / radius scale so the web renders it right.
        let expanded = expandThemeVariables(variables)

        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        let trimmedDesc = description.trimmingCharacters(in: .whitespaces)

        Task {
            let ok: Bool
            if let editing {
                ok = await env.updateTheme(
                    id: editing.id,
                    name: trimmedName,
                    description: trimmedDesc,
                    variables: expanded,
                    published: published
                )
            } else {
                ok = await env.createTheme(
                    name: trimmedName,
                    description: trimmedDesc.isEmpty ? nil : trimmedDesc,
                    variables: expanded,
                    published: published
                )
            }
            isSubmitting = false
            if ok { onCommit() }
        }
    }
}

// MARK: - Preview card

/// A self-contained example post plus UI chrome, coloured and shaped by an
/// explicit theme so it shows a work-in-progress theme without affecting the
/// surrounding screen.
private struct ThemePreviewCard: View {
    let palette: CounterPalette
    let radius: CGFloat
    let glass: Bool
    let fontDesign: Font.Design

    var body: some View {
        let p = palette
        let rSmall = max(0, (radius * 0.6).rounded())

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
                Text("A theme is type, corners, and glass now. Tweak and watch.")
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
            // Glass fades the fill so the theme's translucency reads in the
            // preview; flat uses the solid surface colour.
            .background(glass ? p.surface.opacity(0.6) : p.surface)
            .clipShape(RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).strokeBorder(p.border, lineWidth: 1))

            // Buttons + pill.
            HStack(spacing: CounterSpacing.sm) {
                Text("Primary")
                    .font(CounterFont.mono(13))
                    .padding(.horizontal, CounterSpacing.md)
                    .padding(.vertical, CounterSpacing.sm)
                    .background(p.accent)
                    .foregroundStyle(p.accentContrast)
                    .clipShape(RoundedRectangle(cornerRadius: rSmall))
                Text("Secondary")
                    .font(CounterFont.mono(13))
                    .padding(.horizontal, CounterSpacing.md)
                    .padding(.vertical, CounterSpacing.sm)
                    .foregroundStyle(p.text)
                    .overlay(RoundedRectangle(cornerRadius: rSmall).strokeBorder(p.borderBright, lineWidth: 1))
                Text("TOPIC")
                    .font(CounterFont.mono(10))
                    .padding(.horizontal, CounterSpacing.sm)
                    .padding(.vertical, 4)
                    .background(p.surfaceStrong)
                    .foregroundStyle(p.textDim)
                    .clipShape(RoundedRectangle(cornerRadius: rSmall))
                Spacer()
            }
        }
        .padding(CounterSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(p.bg)
        // Mirror the app-root approach: one modifier themes the example's type.
        .fontDesign(fontDesign)
    }
}

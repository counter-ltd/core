/**
 The runtime color palette and the environment plumbing that delivers it.

 Counter's colors used to be static asset-catalog symbols (`Color.counterBg`).
 Those can't react to a theme change: reading a global getter inside `body`
 registers no SwiftUI dependency, so swapping a theme wouldn't redraw anything.
 Instead the active palette rides through the SwiftUI environment under
 `\.counterTheme`. Views read `@Environment(\.counterTheme) private var theme`
 and write `theme.bg`; because that read happens inside `body`, the view
 re-renders when the palette changes.

 A `CounterPalette` is the resolved form of a theme: the ~15 `--color-*` tokens
 turned into real `Color`s. The hardcoded `.dark` / `.light` palettes mirror the
 web's `app.css` so the two clients stay in sync. A custom theme from the API
 layers on top via `resolve(base:variables:)`, overriding only the tokens it
 actually specifies.
 */

import SwiftUI
import UIKit

// MARK: - CSS color parsing

extension Color {
    /// Parses a CSS color string into a `Color`, or nil if it can't.
    ///
    /// Handles `#rgb`, `#rrggbb`, `#rrggbbaa`, and `rgb()/rgba()`. Theme values
    /// come from arbitrary user-authored themes, so anything unrecognised
    /// returns nil rather than crashing, and the caller keeps the base color.
    init?(cssString raw: String) {
        let s = raw.trimmingCharacters(in: .whitespaces).lowercased()

        if s.hasPrefix("#") {
            self.init(hex: String(s.dropFirst()))
            return
        }
        if s.hasPrefix("rgb") {
            // Pull the numbers out of rgb(...) / rgba(...); commas or spaces.
            guard let open = s.firstIndex(of: "("), let close = s.lastIndex(of: ")") else { return nil }
            let inside = s[s.index(after: open)..<close]
            let parts = inside.split(whereSeparator: { $0 == "," || $0 == " " || $0 == "/" })
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            guard parts.count >= 3,
                  let r = Double(parts[0]), let g = Double(parts[1]), let b = Double(parts[2])
            else { return nil }
            // A 4th component is alpha, expressed 0...1 in CSS.
            let a = parts.count >= 4 ? (Double(parts[3]) ?? 1) : 1
            self.init(.sRGB, red: r / 255, green: g / 255, blue: b / 255, opacity: a)
            return
        }
        return nil
    }

    /// Builds a `Color` from a bare hex string (no leading `#`).
    ///
    /// Accepts 3, 6, or 8 digit forms. 8-digit is `rrggbbaa`, matching the
    /// web's accepted hex shapes.
    private init?(hex: String) {
        var value: UInt64 = 0
        guard Scanner(string: hex).scanHexInt64(&value) else { return nil }

        let r, g, b, a: Double
        switch hex.count {
        case 3: // #rgb shorthand: each digit doubled.
            r = Double((value >> 8) & 0xF) / 15
            g = Double((value >> 4) & 0xF) / 15
            b = Double(value & 0xF) / 15
            a = 1
        case 6:
            r = Double((value >> 16) & 0xFF) / 255
            g = Double((value >> 8) & 0xFF) / 255
            b = Double(value & 0xFF) / 255
            a = 1
        case 8:
            r = Double((value >> 24) & 0xFF) / 255
            g = Double((value >> 16) & 0xFF) / 255
            b = Double((value >> 8) & 0xFF) / 255
            a = Double(value & 0xFF) / 255
        default:
            return nil
        }
        self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
    }

    /// Serializes a `Color` to a `#rrggbb` string, the inverse of
    /// `Color(cssString:)`.
    ///
    /// The Create editor's `ColorPicker`s hand back `Color`s in whatever space
    /// SwiftUI chooses, so resolve through `UIColor` into sRGB before packing
    /// the bytes. Alpha is dropped: themes are authored solid, and the editor
    /// disables opacity. Falls back to black if a colour can't be resolved,
    /// which won't happen for picker output but keeps the return non-optional.
    var hexString: String {
        let ui = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard ui.getRed(&r, green: &g, blue: &b, alpha: &a) else { return "#000000" }
        let clamp = { (v: CGFloat) in Int((max(0, min(1, v)) * 255).rounded()) }
        return String(format: "#%02x%02x%02x", clamp(r), clamp(g), clamp(b))
    }
}

// MARK: - Editable tokens

/// One colour a theme author can set in the Create editor: the CSS variable it
/// drives, a display label, and the dark-scheme default.
///
/// Mirrors `THEME_COLOR_TOKENS` in the web app (`apps/web/src/lib/theme.ts`) so
/// both clients expose the same palette. Defaults match `CounterPalette.dark`.
struct ThemeColorToken: Identifiable, Sendable {
    var id: String { key }
    let key: String
    let label: String
    let defaultHex: String
}

/// The editable palette, in display order. Single source of truth for the
/// Create editor's pickers and the variable map it submits.
let themeColorTokens: [ThemeColorToken] = [
    .init(key: "--color-bg", label: "Background", defaultHex: "#0c0c0d"),
    .init(key: "--color-bg-2", label: "Background 2", defaultHex: "#161619"),
    .init(key: "--color-surface", label: "Surface", defaultHex: "#121214"),
    .init(key: "--color-surface-strong", label: "Surface strong", defaultHex: "#1c1c21"),
    .init(key: "--color-border", label: "Border", defaultHex: "#2b2b31"),
    .init(key: "--color-border-bright", label: "Border bright", defaultHex: "#45454d"),
    .init(key: "--color-text", label: "Text", defaultHex: "#e8e8ea"),
    .init(key: "--color-text-dim", label: "Text dim", defaultHex: "#97979e"),
    .init(key: "--color-text-faint", label: "Text faint", defaultHex: "#64646b"),
    .init(key: "--color-accent", label: "Accent", defaultHex: "#e0a23c"),
    .init(key: "--color-accent-2", label: "Accent 2", defaultHex: "#6fae8f"),
    .init(key: "--color-accent-contrast", label: "Accent contrast", defaultHex: "#0c0c0d"),
    .init(key: "--color-like", label: "Like", defaultHex: "#e5577d"),
    .init(key: "--color-repost", label: "Repost", defaultHex: "#4fb98a"),
    .init(key: "--color-danger", label: "Danger", defaultHex: "#e5484d"),
]

// MARK: - Palette

/// The full set of resolved theme colors used across the app.
///
/// `Equatable` so the environment skips redundant re-renders when the palette
/// hasn't actually changed.
struct CounterPalette: Equatable, Sendable {
    let bg: Color
    let bg2: Color
    let surface: Color
    let surfaceStrong: Color
    let border: Color
    let borderBright: Color
    let text: Color
    let textDim: Color
    let textFaint: Color
    let accent: Color
    let accent2: Color
    let accentContrast: Color
    let like: Color
    let repost: Color
    let danger: Color
}

extension CounterPalette {

    /// The default dark palette. Values mirror `app.css` `[data-theme='dark']`.
    static let dark = CounterPalette(
        bg: Color(cssString: "#0c0c0d")!,
        bg2: Color(cssString: "#161619")!,
        surface: Color(cssString: "#121214")!,
        surfaceStrong: Color(cssString: "#1c1c21")!,
        border: Color(cssString: "#2b2b31")!,
        borderBright: Color(cssString: "#45454d")!,
        text: Color(cssString: "#e8e8ea")!,
        textDim: Color(cssString: "#97979e")!,
        textFaint: Color(cssString: "#64646b")!,
        accent: Color(cssString: "#e0a23c")!,
        accent2: Color(cssString: "#6fae8f")!,
        accentContrast: Color(cssString: "#0c0c0d")!,
        like: Color(cssString: "#e5577d")!,
        repost: Color(cssString: "#4fb98a")!,
        danger: Color(cssString: "#e5484d")!
    )

    /// The default light palette. Values mirror `app.css` `[data-theme='light']`.
    /// The web's light block doesn't override accent-2 or danger, so those
    /// inherit the root (dark) values, which is what's repeated here.
    static let light = CounterPalette(
        bg: Color(cssString: "#f7f6f3")!,
        bg2: Color(cssString: "#efece6")!,
        surface: Color(cssString: "#ffffff")!,
        surfaceStrong: Color(cssString: "#f1efe9")!,
        border: Color(cssString: "#dcd8cf")!,
        borderBright: Color(cssString: "#b6b1a4")!,
        text: Color(cssString: "#17160f")!,
        textDim: Color(cssString: "#57544a")!,
        textFaint: Color(cssString: "#8a8678")!,
        accent: Color(cssString: "#aa6300")!,
        accent2: Color(cssString: "#6fae8f")!,
        accentContrast: Color(cssString: "#fffaf0")!,
        like: Color(cssString: "#c1325a")!,
        repost: Color(cssString: "#2f8f68")!,
        danger: Color(cssString: "#e5484d")!
    )

    /// Layers a theme's variable overrides on top of a base palette.
    ///
    /// Each `--color-*` token is applied only when present and parseable; a
    /// missing or malformed value falls through to the base. That's how a
    /// partial custom theme coexists with the chosen light/dark base, and why
    /// garbage from an unexpected theme can never blank out the UI.
    static func resolve(base: CounterPalette, variables: [String: String]) -> CounterPalette {
        func color(_ key: String, _ fallback: Color) -> Color {
            guard let raw = variables[key], let parsed = Color(cssString: raw) else { return fallback }
            return parsed
        }
        return CounterPalette(
            bg: color("--color-bg", base.bg),
            bg2: color("--color-bg-2", base.bg2),
            surface: color("--color-surface", base.surface),
            surfaceStrong: color("--color-surface-strong", base.surfaceStrong),
            border: color("--color-border", base.border),
            borderBright: color("--color-border-bright", base.borderBright),
            text: color("--color-text", base.text),
            textDim: color("--color-text-dim", base.textDim),
            textFaint: color("--color-text-faint", base.textFaint),
            accent: color("--color-accent", base.accent),
            accent2: color("--color-accent-2", base.accent2),
            accentContrast: color("--color-accent-contrast", base.accentContrast),
            like: color("--color-like", base.like),
            repost: color("--color-repost", base.repost),
            danger: color("--color-danger", base.danger)
        )
    }
}

// MARK: - Style (non-color theme facets)

/// The non-colour side of a theme: typography, geometry, and surface treatment.
///
/// Resolved from the same `--*` variable bag as the palette and injected
/// alongside it, so `ViewModifier`s and `ButtonStyle`s can read both. The
/// canonical keys (`--font-design`, `--radius`, `--surface-blur/-opacity/-shadow`)
/// are the ones the web editor and iOS editor both write, which is what lets a
/// theme authored on either platform render the same way here.
struct CounterStyle: Equatable, Sendable {
    var fontDesign: Font.Design
    var radiusSmall: CGFloat
    var radiusMedium: CGFloat
    var radiusLarge: CGFloat
    /// Frosted translucent surfaces vs a solid fill.
    var glass: Bool
    /// A soft drop shadow under panels.
    var shadow: Bool

    /// The shipped look: system font, the static radius scale, glass panels (iOS
    /// has always rendered cards on `.ultraThinMaterial`), no shadow. Used when
    /// no theme is applied, and as the environment default.
    static let standard = CounterStyle(
        fontDesign: .default,
        radiusSmall: CounterRadius.sm,
        radiusMedium: CounterRadius.md,
        radiusLarge: CounterRadius.lg,
        glass: true,
        shadow: false
    )

    /// Map the semantic `--font-design` token onto a SwiftUI font design.
    static func design(from raw: String?) -> Font.Design {
        switch raw {
        case "mono": return .monospaced
        case "serif": return .serif
        case "rounded": return .rounded
        default: return .default
        }
    }

    /// Resolve a style from a theme's variables.
    ///
    /// Surface tokens decide flat vs glass: if either `--surface-blur` or
    /// `--surface-opacity` is present we honour it (blur > 0 or opacity < 1 means
    /// glass), but a theme that carries neither (an old colours-only theme) keeps
    /// the glass default rather than flattening unexpectedly.
    static func resolve(variables: [String: String]) -> CounterStyle {
        func num(_ key: String) -> Double? {
            guard let raw = variables[key] else { return nil }
            let cleaned = raw.replacingOccurrences(of: "px", with: "").trimmingCharacters(in: .whitespaces)
            return Double(cleaned)
        }

        let radius = num("--radius").map { CGFloat($0) } ?? CounterRadius.md
        let blur = num("--surface-blur")
        let opacity = num("--surface-opacity")
        let hasSurfaceTokens = blur != nil || opacity != nil
        let glass = hasSurfaceTokens ? ((blur ?? 0) > 0 || (opacity ?? 1) < 1) : true
        let shadowRaw = variables["--surface-shadow"]?.trimmingCharacters(in: .whitespaces)
        let shadow = shadowRaw != nil && shadowRaw != "none" && shadowRaw != ""

        return CounterStyle(
            fontDesign: design(from: variables["--font-design"]),
            // Keep the scale in proportion, mirroring the web's derivation.
            radiusSmall: max(0, (radius * 0.6).rounded()),
            radiusMedium: radius,
            radiusLarge: (radius * 1.6).rounded(),
            glass: glass,
            shadow: shadow
        )
    }
}

// MARK: - Theme authoring (presets + expansion)

/// CSS font stacks mirroring the web's `FONT_STACKS`, so a theme authored on iOS
/// renders the same face when opened on the web.
enum ThemeFontStacks {
    static let sans = "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, Helvetica, sans-serif"
    static let mono = "'Berkeley Mono', ui-monospace, 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace"
    static let serif = "ui-serif, Georgia, Cambria, \"Times New Roman\", serif"
    static let rounded = "\"SF Pro Rounded\", ui-rounded, \"Hiragino Maru Gothic ProN\", system-ui, sans-serif"
}

/// Derive the dependent tokens (`--font`, `--font-heading`, the radius scale)
/// from the canonical knobs, mirroring the web's `expandThemeVars`.
///
/// iOS posts straight to the API with no server-side expansion, so themes
/// authored here must carry the resolved tokens or the web would render them
/// with the wrong font and corners. iOS itself reads the canonical keys.
func expandThemeVariables(_ vars: [String: String]) -> [String: String] {
    var out = vars

    let design = vars["--font-design"] ?? "default"
    let stack: String
    switch design {
    case "mono": stack = ThemeFontStacks.mono
    case "serif": stack = ThemeFontStacks.serif
    case "rounded": stack = ThemeFontStacks.rounded
    default: stack = ThemeFontStacks.sans
    }
    out["--font"] = design == "default" ? ThemeFontStacks.sans : stack
    out["--font-heading"] = design == "default" ? ThemeFontStacks.mono : stack

    let r = Double((vars["--radius"] ?? "3").replacingOccurrences(of: "px", with: "")) ?? 3
    out["--radius-sm"] = "\(Int((r * 0.6).rounded()))px"
    out["--radius-lg"] = "\(Int((r * 1.6).rounded()))px"
    out["--radius-pill"] = "999px"

    return out
}

// MARK: - Environment

private struct CounterThemeKey: EnvironmentKey {
    // Dark is the product default, and keeps previews and any unwired view
    // rendering with real colors before the store injects the live palette.
    static let defaultValue = CounterPalette.dark
}

private struct CounterStyleKey: EnvironmentKey {
    static let defaultValue = CounterStyle.standard
}

extension EnvironmentValues {
    /// The active resolved palette. Injected at the app root from `ThemeStore`.
    var counterTheme: CounterPalette {
        get { self[CounterThemeKey.self] }
        set { self[CounterThemeKey.self] = newValue }
    }

    /// The active resolved style (type, geometry, surface). Injected alongside
    /// `counterTheme` at the app root.
    var counterStyle: CounterStyle {
        get { self[CounterStyleKey.self] }
        set { self[CounterStyleKey.self] = newValue }
    }
}

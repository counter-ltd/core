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
}

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

// MARK: - Environment

private struct CounterThemeKey: EnvironmentKey {
    // Dark is the product default, and keeps previews and any unwired view
    // rendering with real colors before the store injects the live palette.
    static let defaultValue = CounterPalette.dark
}

extension EnvironmentValues {
    /// The active resolved palette. Injected at the app root from `ThemeStore`.
    var counterTheme: CounterPalette {
        get { self[CounterThemeKey.self] }
        set { self[CounterThemeKey.self] = newValue }
    }
}

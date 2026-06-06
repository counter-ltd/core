/**
 Reusable SwiftUI view modifiers for the Counter design language.

 `.counterPanel()` is the primary surface treatment: system material blur,
 hairline border, rounded corners. Every card uses this instead of a plain fill.

 `.counterInput()` is the standard form field background (login, settings).
 `.counterGlassInput()` is for fields that sit on an already-blurred surface
 (e.g. the conversation send bar) and layer another glass plane on top.

 Colors here come from `@Environment(\.counterTheme)`, not the old static
 asset symbols. A `ViewModifier` / `ButtonStyle` is the only place outside a
 `View` that can read the environment, which is why each style is a struct
 rather than a free `View` extension method.
 */

import SwiftUI

// MARK: - Panel surface

private struct CounterPanelModifier: ViewModifier {
    @Environment(\.counterTheme) private var theme
    @Environment(\.counterStyle) private var style

    func body(content: Content) -> some View {
        content.modifier(PanelSurface(theme: theme, style: style))
    }
}

/// The panel's surface, split out so the `#available` branch doesn't block
/// inferring `some View` (same pattern as `GlassInputBackground`).
///
/// Glass on iOS 26 uses the native liquid-glass material (real specular
/// highlights and chromatic fringing); older OS falls back to a frosted
/// `.ultraThinMaterial`. Flat themes get a solid surface fill. Radius and the
/// drop shadow follow the theme either way.
private struct PanelSurface: ViewModifier {
    let theme: CounterPalette
    let style: CounterStyle

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: style.radiusMedium)
        let shadowColor: Color = style.shadow ? .black.opacity(0.45) : .clear

        if style.glass, #available(iOS 26, *) {
            content
                .glassEffect(in: shape)
                .shadow(color: shadowColor, radius: style.shadow ? 16 : 0, y: style.shadow ? 8 : 0)
        } else if style.glass {
            content
                .background(.ultraThinMaterial)
                .clipShape(shape)
                .overlay(shape.strokeBorder(theme.border, lineWidth: 0.5))
                .shadow(color: shadowColor, radius: style.shadow ? 16 : 0, y: style.shadow ? 8 : 0)
        } else {
            content
                .background(theme.surface)
                .clipShape(shape)
                .overlay(shape.strokeBorder(theme.border, lineWidth: 0.5))
                .shadow(color: shadowColor, radius: style.shadow ? 16 : 0, y: style.shadow ? 8 : 0)
        }
    }
}

extension View {
    /// Applies the Counter card surface: system material blur + hairline border.
    func counterPanel() -> some View {
        modifier(CounterPanelModifier())
    }
}

// MARK: - Input field

private struct CounterInputModifier: ViewModifier {
    @Environment(\.counterTheme) private var theme
    @Environment(\.counterStyle) private var style

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, CounterSpacing.md)
            .padding(.vertical, CounterSpacing.sm)
            .background(theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: style.radiusSmall))
            .overlay(
                RoundedRectangle(cornerRadius: style.radiusSmall)
                    .strokeBorder(theme.border, lineWidth: 0.5)
            )
    }
}

extension View {
    /// Standard form field background used in login, register, and settings.
    func counterInput() -> some View {
        modifier(CounterInputModifier())
    }
}

// MARK: - Glass input field

private struct CounterGlassInputModifier: ViewModifier {
    @Environment(\.counterTheme) private var theme

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, CounterSpacing.md)
            .padding(.vertical, CounterSpacing.sm)
            .modifier(GlassInputBackground(theme: theme))
    }
}

// Separated out so the #available branch doesn't block inferring `some View`.
private struct GlassInputBackground: ViewModifier {
    let theme: CounterPalette

    func body(content: Content) -> some View {
        if #available(iOS 26, *) {
            // Native liquid glass: the system picks up surrounding color and
            // renders specular highlights + chromatic fringing automatically.
            content
                .glassEffect(in: Capsule())
        } else {
            content
                .background(.ultraThinMaterial)
                .clipShape(RoundedRectangle(cornerRadius: CounterRadius.lg))
                .overlay(
                    RoundedRectangle(cornerRadius: CounterRadius.lg)
                        .strokeBorder(theme.border.opacity(0.6), lineWidth: 0.5)
                )
        }
    }
}

extension View {
    /// Liquid glass text field. Uses iOS 26 `glassEffect` where available; falls
    /// back to ultraThinMaterial on older OS.
    func counterGlassInput() -> some View {
        modifier(CounterGlassInputModifier())
    }
}

// MARK: - Primary button

/// Full-width amber button styling, applied as a `ButtonStyle` rather than a
/// plain modifier. This matters: a modifier wrapped around a `Button` decorates
/// the frame but leaves the tap area as just the label's glyphs, so most of the
/// bar is dead to touches. A ButtonStyle styles `configuration.label`, so the
/// whole bar is the button's interactive region.
private struct CounterPrimaryButtonStyle: ButtonStyle {
    @Environment(\.counterTheme) private var theme
    @Environment(\.counterStyle) private var style
    let isLoading: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity)
            .padding(.vertical, CounterSpacing.md)
            .background(theme.accent)
            // Text on the accent fill uses the theme's contrast color so it
            // stays legible on both the amber default and custom accents.
            .foregroundStyle(theme.accentContrast)
            .fontWeight(.semibold)
            .clipShape(RoundedRectangle(cornerRadius: style.radiusSmall))
            .contentShape(Rectangle())
            // Dim while loading, plus a small press-down cue.
            .opacity(isLoading ? 0.7 : (configuration.isPressed ? 0.85 : 1))
    }
}

extension View {
    /// Full-width amber primary button style. Apply to a `Button`.
    func counterPrimaryButton(isLoading: Bool = false) -> some View {
        buttonStyle(CounterPrimaryButtonStyle(isLoading: isLoading))
    }
}

// MARK: - Secondary button

private struct CounterSecondaryButtonStyle: ButtonStyle {
    @Environment(\.counterTheme) private var theme
    @Environment(\.counterStyle) private var style

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(maxWidth: .infinity)
            .padding(.vertical, CounterSpacing.md)
            .background(theme.surface)
            .foregroundStyle(theme.text)
            .clipShape(RoundedRectangle(cornerRadius: style.radiusSmall))
            .overlay(
                RoundedRectangle(cornerRadius: style.radiusSmall)
                    .strokeBorder(theme.border, lineWidth: 0.5)
            )
            .contentShape(Rectangle())
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}

extension View {
    /// Full-width surface-colored button with a hairline border. Use for secondary actions.
    func counterSecondaryButton() -> some View {
        buttonStyle(CounterSecondaryButtonStyle())
    }
}

// MARK: - Brand logo

extension Image {
    /// Sizes a brand-logo asset (GitHub, Discord) as a tintable glyph.
    ///
    /// The asset ships as a template SVG, so the tint follows the surrounding
    /// `foregroundStyle`. That's what lets a logo sit in a button or a list row
    /// and pick up the same theme color as the text next to it, the same way
    /// the web buttons use `fill="currentColor"`.
    func brandLogo(size: CGFloat = 16) -> some View {
        renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
    }
}

// MARK: - List row

private struct CounterListRowModifier: ViewModifier {
    @Environment(\.counterTheme) private var theme

    func body(content: Content) -> some View {
        content
            .listRowBackground(theme.bg)
            .listRowSeparator(.visible)
            .listRowSeparatorTint(theme.border)
            .listRowInsets(EdgeInsets())
    }
}

extension View {
    /// Full-bleed list row with a hairline separator. Content handles its own internal padding.
    func counterListRow() -> some View {
        modifier(CounterListRowModifier())
    }
}

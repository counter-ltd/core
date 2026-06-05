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

    func body(content: Content) -> some View {
        content
            // The glass blur stays tied to the light/dark base by design; a
            // custom theme recolors the border, not the translucent surface.
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: CounterRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: CounterRadius.md)
                    .strokeBorder(theme.border, lineWidth: 0.5)
            )
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

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, CounterSpacing.md)
            .padding(.vertical, CounterSpacing.sm)
            .background(theme.surface)
            .clipShape(RoundedRectangle(cornerRadius: CounterRadius.sm))
            .overlay(
                RoundedRectangle(cornerRadius: CounterRadius.sm)
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
            .clipShape(RoundedRectangle(cornerRadius: CounterRadius.sm))
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

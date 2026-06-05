/**
 Counter design tokens: typography and spacing.

 Colors are defined in Assets.xcassets and exposed as Color extensions by
 Xcode's generated asset symbols (GeneratedAssetSymbols.swift). All values
 mirror the CSS custom properties defined in the web app's root layout.
 Dark appearance is primary; light values are the web's light-theme variables.
 */

import SwiftUI

// MARK: - Typography

enum CounterFont {
    /// Post bodies, bios, message text: system default.
    static func body(_ size: CGFloat = 16) -> Font {
        .system(size: size)
    }

    /// Secondary text: timestamps, handles, counts. Same font as body, smaller by default.
    static func mono(_ size: CGFloat = 13) -> Font {
        .system(size: size)
    }

    /// Section headings: medium weight, slightly tighter tracking.
    static func heading(_ size: CGFloat = 18) -> Font {
        .system(size: size, weight: .medium)
    }
}

// MARK: - Spacing

enum CounterSpacing {
    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
}

// MARK: - Corner radius

enum CounterRadius {
    static let sm: CGFloat = 6
    static let md: CGFloat = 8
    static let lg: CGFloat = 12
    static let full: CGFloat = 9999
}

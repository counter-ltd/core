/**
 A text view that displays a relative timestamp and refreshes automatically.

 Wraps `timeAgo()` in a SwiftUI `Text` with a `TimelineView` so the display
 updates as time passes — e.g., "now" becomes "1m" after a minute.
 */

import SwiftUI

struct RelativeTimeText: View {
    @Environment(\.counterTheme) private var theme
    let isoString: String

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { _ in
            Text(timeAgo(from: isoString))
                .font(CounterFont.mono(12))
                .foregroundStyle(theme.textDim)
        }
    }
}

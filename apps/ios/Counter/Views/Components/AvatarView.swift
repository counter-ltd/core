/**
 Circular user avatar with an initials fallback.

 Uses `AsyncImage` for remote URLs and falls back to a generated initial
 if the URL is nil or fails to load. Matches the web's avatar rendering:
 a circle with a muted background colour and the first character of the
 display name or username.
 */

import SwiftUI

struct AvatarView: View {
    @Environment(\.counterTheme) private var theme
    let user: PublicUser
    var size: CGFloat = 40

    var body: some View {
        Group {
            if let urlString = user.avatarUrl, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        fallbackView
                    }
                }
            } else {
                fallbackView
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var fallbackView: some View {
        ZStack {
            theme.surface
            Text(initial)
                .font(.system(size: size * 0.4, weight: .medium, design: .monospaced))
                .foregroundStyle(theme.textDim)
        }
    }

    private var initial: String {
        let name = user.displayName ?? user.username
        return String(name.prefix(1)).uppercased()
    }
}

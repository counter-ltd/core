/**
 Grid of media attachments for a post.

 Handles 1-4 items. A single image fills the full width; two images sit
 side-by-side; three or four use a 2-column grid. Aspect ratio is 16:9
 for the single case and square for multi-image grids.
 */

import SwiftUI

struct MediaGridView: View {
    @Environment(\.counterTheme) private var theme
    let items: [MediaItem]

    var body: some View {
        switch items.count {
        case 1:
            mediaCell(items[0])
                .aspectRatio(16 / 9, contentMode: .fill)
                .clipShape(RoundedRectangle(cornerRadius: CounterRadius.sm))

        case 2:
            HStack(spacing: 2) {
                ForEach(items) { item in
                    mediaCell(item)
                        .aspectRatio(1, contentMode: .fill)
                        .clipShape(RoundedRectangle(cornerRadius: CounterRadius.sm))
                }
            }

        case 3...:
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 2) {
                ForEach(items.prefix(4)) { item in
                    mediaCell(item)
                        .aspectRatio(1, contentMode: .fill)
                        .clipShape(RoundedRectangle(cornerRadius: CounterRadius.sm))
                }
            }

        default:
            EmptyView()
        }
    }

    private func mediaCell(_ item: MediaItem) -> some View {
        AsyncImage(url: URL(string: item.url)) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .scaledToFill()
            case .failure:
                theme.surface
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundStyle(theme.textDim)
                    )
            case .empty:
                theme.surface
                    .overlay(ProgressView())
            @unknown default:
                theme.surface
            }
        }
        .accessibilityLabel(item.altText ?? "Image")
    }
}

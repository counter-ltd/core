/**
 Grid of media attachments for a post.

 Handles 1-4 items. A single image fills the full width at a fixed display
 height; two images sit side-by-side; three or four use a 2-column grid. Every
 cell is given a definite frame and clipped, so a tall or huge source image is
 cropped to a consistent box instead of expanding to its natural pixel size.
 */

import SwiftUI

struct MediaGridView: View {
    @Environment(\.counterTheme) private var theme
    let items: [MediaItem]

    // Display heights per layout. Cells fill the available width and crop to
    // these, so the feed stays scannable regardless of source dimensions.
    private let singleHeight: CGFloat = 260
    private let pairHeight: CGFloat = 200
    private let gridHeight: CGFloat = 160

    var body: some View {
        switch items.count {
        case 1:
            cell(items[0], height: singleHeight)

        case 2:
            HStack(spacing: 2) {
                ForEach(items) { item in cell(item, height: pairHeight) }
            }

        case 3...:
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 2) {
                ForEach(items.prefix(4)) { item in cell(item, height: gridHeight) }
            }

        default:
            EmptyView()
        }
    }

    /// One media cell: full available width, fixed height, cropped to a rounded box.
    private func cell(_ item: MediaItem, height: CGFloat) -> some View {
        mediaImage(item)
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: CounterRadius.sm))
    }

    private func mediaImage(_ item: MediaItem) -> some View {
        AsyncImage(url: URL(string: item.url)) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    // Fill the cell and let the frame + clip crop the overflow,
                    // so the image keeps its aspect ratio without warping.
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

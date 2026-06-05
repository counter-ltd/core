/**
 Home feed: public timeline, following feed, or a topic feed.

 The title button in the nav bar opens a menu for switching between feed
 sources. Available sources are loaded by the view model alongside the first
 post page, so the menu is populated by the time the feed appears.
 */

import SwiftUI

struct FeedView: View {
    @Environment(\.counterTheme) private var theme
    @State var vm: FeedViewModel

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            if vm.posts.isEmpty && vm.isLoading {
                ProgressView()
            } else {
                list
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                sourceMenu
            }
        }
        .task { await vm.loadInitial() }
        .alert("Error", isPresented: .constant(vm.errorMessage != nil)) {
            Button("OK") { vm.errorMessage = nil }
        } message: {
            Text(vm.errorMessage ?? "")
        }
    }

    // MARK: - Source picker

    private var sourceMenu: some View {
        Menu {
            ForEach(vm.availableSources, id: \.self) { src in
                Button {
                    Task { await vm.switchSource(src) }
                } label: {
                    if src == vm.source {
                        Label(src.label, systemImage: "checkmark")
                    } else {
                        Text(src.label)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(vm.source.label)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(theme.text)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.textDim)
            }
            // Widen the tap target without changing the visual footprint.
            .contentShape(Rectangle())
        }
    }

    // MARK: - Post list

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(vm.posts) { post in
                    PostRowView(
                        post: post,
                        onLike: { Task { await vm.toggleLike(postId: post.id) } },
                        onRepost: { Task { await vm.toggleRepost(postId: post.id) } }
                    )
                    // Load more when the last row appears.
                    .onAppear {
                        if post.id == vm.posts.last?.id {
                            Task { await vm.loadMore() }
                        }
                    }
                    Divider().overlay(theme.border)
                }

                if vm.isLoading && !vm.posts.isEmpty {
                    ProgressView().padding()
                }
            }
        }
        .refreshable { await vm.refresh() }
        .background(theme.bg)
    }
}

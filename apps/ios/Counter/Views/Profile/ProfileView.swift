/**
 User profile page: header with stats and follow button, then the user's posts.

 Both the profile data and initial post page are fetched in parallel via
 `ProfileViewModel.load()`. Subsequent post pages load on scroll via
 `loadMorePosts()`.
 */

import SwiftUI

struct ProfileView: View {
    @Environment(\.counterTheme) private var theme
    @State var vm: ProfileViewModel

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            if vm.user == nil && vm.isLoading {
                ProgressView()
            } else {
                content
            }
        }
        .navigationTitle(vm.user.map { "@\($0.username)" } ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load() }
    }

    private var content: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                if let user = vm.user {
                    ProfileHeaderView(
                        user: user,
                        onFollow: { Task { await vm.toggleFollow() } }
                    )
                    Divider().overlay(theme.border)
                }

                ForEach(vm.posts) { post in
                    PostRowView(post: post)
                        .onAppear {
                            if post.id == vm.posts.last?.id {
                                Task { await vm.loadMorePosts() }
                            }
                        }
                    Divider().overlay(theme.border)
                }

                if vm.isLoading && !vm.posts.isEmpty {
                    ProgressView().padding()
                }
            }
        }
        .background(theme.bg)
    }
}

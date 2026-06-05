/**
 User profile page: header with stats and follow button, then the user's posts.

 Both the profile data and initial post page are fetched in parallel via
 `ProfileViewModel.load()`. Subsequent post pages load on scroll via
 `loadMorePosts()`. A filter bar between the header and the list lets the
 viewer switch between root posts only (default) and all posts including replies.
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
                    filterBar
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

    private var filterBar: some View {
        HStack(spacing: 0) {
            ForEach(ProfilePostFilter.allCases, id: \.self) { option in
                Button {
                    guard vm.filter != option else { return }
                    vm.filter = option
                    Task { await vm.reloadPosts() }
                } label: {
                    Text(option.label)
                        .font(.system(size: 14, weight: vm.filter == option ? .semibold : .regular))
                        .foregroundStyle(vm.filter == option ? theme.text : theme.textDim)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        // Underline on the active tab.
                        .overlay(alignment: .bottom) {
                            if vm.filter == option {
                                Rectangle()
                                    .frame(height: 2)
                                    .foregroundStyle(theme.accent)
                            }
                        }
                }
                .buttonStyle(.plain)
            }
        }
        .background(theme.bg)
    }
}

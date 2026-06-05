/**
 Post thread: ancestor chain above the focused post, replies below.

 Ancestors are rendered without action bars (read-only context). The focused
 post has its full action bar. Replies are each a tappable `PostRowView`.
 The compose-reply button appears in the toolbar when authenticated.
 */

import SwiftUI

struct ThreadView: View {
    @Environment(\.counterTheme) private var theme
    @State var vm: ThreadViewModel
    @Environment(AppEnvironment.self) private var env
    @State private var showReply = false

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            if vm.thread == nil && vm.isLoading {
                ProgressView()
            } else if let thread = vm.thread {
                threadContent(thread)
            }
        }
        .navigationTitle("Post")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if env.authStore.isAuthenticated {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showReply = true
                    } label: {
                        Image(systemName: "arrowshape.turn.up.left")
                    }
                    .tint(theme.accent)
                }
            }
        }
        .sheet(isPresented: $showReply) {
            if let postId = vm.thread?.post.id {
                ComposeView(vm: ComposeViewModel(parentId: postId, env: env))
            }
        }
        .task { await vm.load() }
        .alert("Error", isPresented: .constant(vm.errorMessage != nil)) {
            Button("OK") { vm.errorMessage = nil }
        } message: {
            Text(vm.errorMessage ?? "")
        }
    }

    private func threadContent(_ thread: Thread) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: CounterSpacing.sm) {
                // Ancestors: each is a condensed PostRowView without action bars.
                if !thread.ancestors.isEmpty {
                    ForEach(thread.ancestors) { ancestor in
                        PostRowView(post: ancestor)
                            .padding(.horizontal, CounterSpacing.lg)
                        // Thread line connector between ancestors.
                        Rectangle()
                            .fill(theme.border)
                            .frame(width: 2, height: CounterSpacing.sm)
                            .padding(.leading, CounterSpacing.lg + 20)
                    }
                }

                // Focused post: full-size with action bar.
                PostRowView(
                    post: thread.post,
                    onLike: env.authStore.isAuthenticated ? { Task { await vm.toggleLike() } } : nil,
                    onRepost: env.authStore.isAuthenticated ? { Task { await vm.toggleRepost() } } : nil,
                    onReply: { showReply = true }
                )
                .padding(.horizontal, CounterSpacing.lg)

                if !thread.replies.isEmpty {
                    Divider()
                        .background(theme.border)
                        .padding(.vertical, CounterSpacing.sm)

                    Text("Replies")
                        .font(CounterFont.mono(12))
                        .foregroundStyle(theme.textDim)
                        .padding(.horizontal, CounterSpacing.lg)

                    ForEach(thread.replies) { reply in
                        PostRowView(post: reply)
                            .padding(.horizontal, CounterSpacing.lg)
                    }
                }
            }
            .padding(.vertical, CounterSpacing.md)
        }
    }
}

/**
 Messages inbox: a list of conversations sorted by most recent activity.

 Unread counts per conversation are shown as amber badges. Opening a
 conversation marks it read and decrements the inbox badge.
 */

import SwiftUI

struct MessagesView: View {
    @Environment(\.counterTheme) private var theme
    @State var vm: MessagesViewModel

    @State private var conversationToClear: Conversation?
    @State private var conversationToDelete: Conversation?

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            if vm.conversations.isEmpty && vm.isLoading {
                ProgressView()
            } else if vm.conversations.isEmpty {
                emptyState
            } else {
                list
            }
        }
        .navigationTitle("Messages")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.loadInitial() }
        .refreshable { await vm.loadInitial() }
        .confirmationDialog(
            "Clear chat with @\(conversationToClear?.partner.username ?? "")?",
            isPresented: .init(
                get: { conversationToClear != nil },
                set: { if !$0 { conversationToClear = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Clear for everyone", role: .destructive) {
                guard let c = conversationToClear else { return }
                conversationToClear = nil
                Task { await vm.clearConversation(username: c.partner.username) }
            }
        } message: {
            Text("All messages will be deleted for both parties. This cannot be undone.")
        }
        .confirmationDialog(
            "Delete conversation with @\(conversationToDelete?.partner.username ?? "")?",
            isPresented: .init(
                get: { conversationToDelete != nil },
                set: { if !$0 { conversationToDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete for everyone", role: .destructive) {
                guard let c = conversationToDelete else { return }
                conversationToDelete = nil
                Task { await vm.deleteConversation(username: c.partner.username) }
            }
        } message: {
            Text("The conversation will be permanently removed for both parties.")
        }
    }

    private var list: some View {
        List {
            ForEach(vm.conversations) { conversation in
                ConversationRowView(conversation: conversation)
                    .counterListRow()
                    .onAppear {
                        if conversation.id == vm.conversations.last?.id {
                            Task { await vm.loadMore() }
                        }
                    }
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button {
                            conversationToDelete = conversation
                        } label: {
                            Label("Delete", systemImage: "trash.fill")
                        }
                        .tint(.red)

                        Button {
                            conversationToClear = conversation
                        } label: {
                            Label("Clear", systemImage: "eraser.fill")
                        }
                        .tint(.orange)
                    }
            }
        }
        .listStyle(.plain)
        .background(theme.bg)
        .scrollContentBackground(.hidden)
    }

    private var emptyState: some View {
        VStack(spacing: CounterSpacing.md) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 40))
                .foregroundStyle(theme.textDim)
            Text("No messages yet")
                .font(CounterFont.body(16))
                .foregroundStyle(theme.textDim)
        }
    }
}

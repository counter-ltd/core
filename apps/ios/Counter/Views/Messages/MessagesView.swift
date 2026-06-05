/**
 Messages inbox: active conversations in one tab, inbound message requests in another.

 Unread counts are shown as badges on conversation rows. The Requests tab shows
 a count badge when there are pending inbound requests. Opening any conversation
 marks it read and decrements the badge.
 */

import SwiftUI

struct MessagesView: View {
    @Environment(\.counterTheme) private var theme
    @State var vm: MessagesViewModel

    @State private var selectedTab: InboxTab = .messages
    @State private var conversationToClear: Conversation?
    @State private var conversationToDelete: Conversation?
    @State private var showNewMessage = false

    enum InboxTab { case messages, requests }

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                tabPicker
                    .padding(.horizontal, CounterSpacing.md)
                    .padding(.vertical, CounterSpacing.sm)

                ZStack {
                    if selectedTab == .messages {
                        if vm.conversations.isEmpty && vm.isLoading {
                            ProgressView()
                        } else if vm.conversations.isEmpty {
                            emptyState(
                                icon: "bubble.left.and.bubble.right",
                                text: "No messages yet"
                            )
                        } else {
                            conversationList
                        }
                    } else {
                        if vm.requests.isEmpty {
                            emptyState(
                                icon: "tray",
                                text: "No message requests"
                            )
                        } else {
                            requestList
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .navigationTitle("Messages")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showNewMessage = true
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .tint(theme.accent)
            }
        }
        .sheet(isPresented: $showNewMessage) {
            NewMessageView()
        }
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

    // MARK: - Tab picker

    private var tabPicker: some View {
        HStack(spacing: 0) {
            tabButton(title: "Messages", tab: .messages, badge: nil)
            tabButton(
                title: "Requests",
                tab: .requests,
                badge: vm.requests.isEmpty ? nil : "\(vm.requests.count)"
            )
        }
        .background(theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    @ViewBuilder
    private func tabButton(title: String, tab: InboxTab, badge: String?) -> some View {
        Button {
            selectedTab = tab
        } label: {
            HStack(spacing: 4) {
                Text(title)
                    .font(CounterFont.body(14).weight(selectedTab == tab ? .semibold : .regular))
                if let badge {
                    Text(badge)
                        .font(CounterFont.mono(11).weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(theme.accent)
                        .foregroundStyle(theme.accentContrast)
                        .clipShape(Capsule())
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, CounterSpacing.sm)
            .background(selectedTab == tab ? theme.bg : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .foregroundStyle(selectedTab == tab ? theme.text : theme.textDim)
        .buttonStyle(.plain)
        .padding(3)
    }

    // MARK: - Lists

    private var conversationList: some View {
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

    private var requestList: some View {
        List {
            ForEach(vm.requests) { request in
                ConversationRowView(conversation: request)
                    .counterListRow()
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button {
                            conversationToDelete = request
                        } label: {
                            Label("Decline", systemImage: "xmark")
                        }
                        .tint(.red)
                    }
            }
        }
        .listStyle(.plain)
        .background(theme.bg)
        .scrollContentBackground(.hidden)
    }

    private func emptyState(icon: String, text: String) -> some View {
        VStack(spacing: CounterSpacing.md) {
            Image(systemName: icon)
                .font(.system(size: 40))
                .foregroundStyle(theme.textDim)
            Text(text)
                .font(CounterFont.body(16))
                .foregroundStyle(theme.textDim)
        }
    }
}

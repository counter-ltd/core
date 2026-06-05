/**
 Notification inbox: likes, reposts, replies, follows, and mentions.

 Each row is tappable: post-related notifications push to the thread view.
 Follow notifications push to the actor's profile. The toolbar button marks
 all visible notifications as read with a single tap.
 */

import SwiftUI

struct NotificationsView: View {
    @Environment(\.counterTheme) private var theme
    @State var vm: NotificationsViewModel

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            if vm.notifications.isEmpty && vm.isLoading {
                ProgressView()
            } else if vm.notifications.isEmpty {
                emptyState
            } else {
                list
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if vm.unreadCount > 0 {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Mark all read") {
                        Task {
                            for n in vm.notifications where !n.read {
                                await vm.markRead(id: n.id)
                            }
                        }
                    }
                    .font(CounterFont.mono(12))
                    .foregroundStyle(theme.accent)
                }
            }
        }
        .task { await vm.loadInitial() }
        .refreshable { await vm.loadInitial() }
    }

    private var list: some View {
        List {
            ForEach(vm.notifications) { notification in
                notificationRow(notification)
                    .counterListRow()
                    .onAppear {
                        if notification.id == vm.notifications.last?.id {
                            Task { await vm.loadMore() }
                        }
                    }
            }
        }
        .listStyle(.plain)
        .background(theme.bg)
        .scrollContentBackground(.hidden)
    }

    @ViewBuilder
    private func notificationRow(_ notification: AppNotification) -> some View {
        let destination: AppDestination? = {
            // A message opens the conversation; a post-bearing notification opens
            // the thread; everything else (a follow) opens the actor's profile.
            if let partner = notification.conversation?.partner {
                return .conversation(username: partner.username)
            }
            if let postId = notification.post?.id {
                return .thread(postId: postId)
            }
            return .profile(username: notification.actor.username)
        }()

        if let destination {
            NavigationLink(value: destination) {
                NotificationRowView(notification: notification)
            }
            .buttonStyle(.plain)
            .task { await vm.markRead(id: notification.id) }
        } else {
            NotificationRowView(notification: notification)
        }
    }

    private var emptyState: some View {
        VStack(spacing: CounterSpacing.md) {
            Image(systemName: "bell.slash")
                .font(.system(size: 40))
                .foregroundStyle(theme.textDim)
            Text("No notifications yet")
                .font(CounterFont.body(16))
                .foregroundStyle(theme.textDim)
        }
    }
}

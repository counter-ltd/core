/**
 The primary tab bar shown after authentication.

 Five tabs: Home, Search, Messages, Notifications, Profile. The compose FAB
 floats above the tab bar as an overlay; it is not a tab itself so it doesn't
 shift tab selection state when tapped.

 Navigation state is per-tab: each tab has its own `NavigationPath` so drilling
 into a thread on the Feed tab doesn't affect the Search tab's history.
 */

import SwiftUI

struct MainTabView: View {
    @Environment(\.counterTheme) private var theme
    @Environment(AppEnvironment.self) private var env

    @State private var feedPath = NavigationPath()
    @State private var searchPath = NavigationPath()
    @State private var messagesPath = NavigationPath()
    @State private var notificationsPath = NavigationPath()
    @State private var profilePath = NavigationPath()

    @State private var showCompose = false
    @State private var selectedTab: Tab = .home

    // Settings is pushed via a value-less NavigationLink, so it never lands in
    // profilePath. Track its presence directly to hide the compose FAB while it's up.
    @State private var showingSettings = false

    @State private var notifVM: NotificationsViewModel?
    @State private var messagesVM: MessagesViewModel?
    // One live socket for the whole session, feeding the tab badges and lists.
    @State private var notificationLive: NotificationLiveClient?

    enum Tab { case home, search, messages, notifications, profile }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            TabView(selection: $selectedTab) {
                feedTab
                searchTab
                messagesTab
                notificationsTab
                profileTab
            }
            .tint(theme.accent)

            // Only show on Home and Profile; hide on Settings too.
            if !showingSettings && (selectedTab == .home || selectedTab == .profile) {
                composeFAB
            }
        }
        .sheet(isPresented: $showCompose) {
            ComposeView(vm: ComposeViewModel(env: env))
        }
        .onAppear {
            // Lazy-init so VMs start their loads after the tab bar appears.
            if notifVM == nil { notifVM = NotificationsViewModel(env: env) }
            if messagesVM == nil { messagesVM = MessagesViewModel(env: env) }
            startNotificationLive()
        }
        .onDisappear { notificationLive?.close(); notificationLive = nil }
        .onChange(of: env.pushRouter.pending) { _, destination in
            guard let destination else { return }
            route(to: destination)
            // Consume it so the same tap can't fire twice.
            env.pushRouter.pending = nil
        }
    }

    /// Open the live notification socket once and route each arrival to the
    /// right place: the notifications list/badge, or a refresh of the inbox
    /// badge for a message. Safe to call repeatedly; the guard keeps one socket.
    private func startNotificationLive() {
        guard notificationLive == nil else { return }
        let token = env.authStore.accessToken ?? ""
        guard !token.isEmpty else { return }

        let client = NotificationLiveClient(token: token)
        client.onNotification = { n in
            if n.type == .message {
                // A new message bumps the inbox badge; reload to recompute it.
                Task { await messagesVM?.loadInitial() }
            } else {
                notifVM?.receiveLive(n)
            }
        }
        notificationLive = client
        client.connect()
    }

    /// Switch to the relevant tab and push the destination a tapped notification
    /// pointed at. Messages land on the Messages tab; everything else on
    /// Notifications, which is where the user expects activity to live.
    private func route(to destination: AppDestination) {
        switch destination {
        case .conversation:
            selectedTab = .messages
            messagesPath.append(destination)
        default:
            selectedTab = .notifications
            notificationsPath.append(destination)
        }
    }

    // MARK: - Tabs

    private var feedTab: some View {
        NavigationStack(path: $feedPath) {
            FeedView(vm: FeedViewModel(env: env))
                .navigationDestinations(env: env)
        }
        .tabItem { Label("Home", systemImage: "house.fill") }
        .tag(Tab.home)
    }

    private var searchTab: some View {
        NavigationStack(path: $searchPath) {
            SearchView(vm: SearchViewModel(env: env))
                .navigationDestinations(env: env)
        }
        .tabItem { Label("Search", systemImage: "magnifyingglass") }
        .tag(Tab.search)
    }

    private var messagesTab: some View {
        NavigationStack(path: $messagesPath) {
            if let vm = messagesVM {
                MessagesView(vm: vm)
                    .navigationDestinations(env: env)
            }
        }
        .tabItem {
            Label("Messages", systemImage: "bubble.left.and.bubble.right.fill")
        }
        .badge(messagesVM?.totalUnread ?? 0)
        .tag(Tab.messages)
    }

    private var notificationsTab: some View {
        NavigationStack(path: $notificationsPath) {
            if let vm = notifVM {
                NotificationsView(vm: vm)
                    .navigationDestinations(env: env)
            }
        }
        .tabItem { Label("Notifications", systemImage: "bell.fill") }
        .badge(notifVM?.unreadCount ?? 0)
        .tag(Tab.notifications)
    }

    private var profileTab: some View {
        NavigationStack(path: $profilePath) {
            if let username = env.authStore.currentUser?.username {
                ProfileView(vm: ProfileViewModel(username: username, env: env))
                    .navigationDestinations(env: env)
                    // The gear lives on the tab root, which is always the current
                    // user's own profile. ProfileView reached as an AppDestination
                    // for someone else gets no toolbar, so it stays self-only.
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            NavigationLink {
                                SettingsView()
                                    // Drive FAB visibility off the push/pop of this
                                    // leaf screen. The add-account sheet keeps Settings
                                    // "appeared", so the FAB stays hidden through it.
                                    .onAppear { showingSettings = true }
                                    .onDisappear { showingSettings = false }
                            } label: {
                                Image(systemName: "gearshape")
                            }
                            .tint(theme.accent)
                        }
                    }
            }
        }
        .tabItem { Label("Profile", systemImage: "person.fill") }
        .tag(Tab.profile)
    }

    // MARK: - Compose FAB

    private var composeFAB: some View {
        Button {
            showCompose = true
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.black)
                .frame(width: 52, height: 52)
                .background(theme.accent)
                .clipShape(Circle())
                .shadow(color: .black.opacity(0.3), radius: 8, y: 4)
        }
        .padding(.trailing, CounterSpacing.xl)
        // Sits above the tab bar; 83pt is the standard tab bar height on modern iPhones.
        .padding(.bottom, 83 + CounterSpacing.lg)
    }
}

// MARK: - Shared navigation destinations

/// Applied to every `NavigationStack` in the tab bar so all tabs can push
/// the same destination types.
private extension View {
    func navigationDestinations(env: AppEnvironment) -> some View {
        self
            .navigationDestination(for: AppDestination.self) { destination in
                switch destination {
                case .thread(let id):
                    ThreadView(vm: ThreadViewModel(postId: id, env: env))
                case .profile(let username):
                    ProfileView(vm: ProfileViewModel(username: username, env: env))
                case .followers(let username):
                    FollowListView(username: username, mode: .followers, env: env)
                case .following(let username):
                    FollowListView(username: username, mode: .following, env: env)
                case .conversation(let username):
                    ConversationView(vm: ConversationViewModel(partnerUsername: username, env: env))
                case .topic:
                    // Topics navigation deferred to v2.
                    EmptyView()
                }
            }
    }
}

// MARK: - Navigation destination type

enum AppDestination: Hashable {
    case thread(postId: String)
    case profile(username: String)
    case followers(username: String)
    case following(username: String)
    case conversation(username: String)
    case topic(slug: String)
}

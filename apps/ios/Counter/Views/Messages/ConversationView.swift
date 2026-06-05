/**
 A conversation thread between the current user and one partner.

 Messages are displayed oldest-first (the view model reverses the API order).
 The send field sits at the bottom. The view marks the conversation as read
 immediately on appear, so the inbox badge decrements without a pull-to-refresh.

 A lock button in the nav bar shows the current encryption level; tapping it
 opens a popover with a short explanation.
 */

import SwiftUI

// Derived from ConversationViewModel state; purely a view-layer concept.
private enum EncryptionLevel: Equatable {
    /// Keys haven't been fetched yet.
    case loading
    /// Full E2EE with multiple devices registered on both sides.
    case e2ee
    /// E2EE active, but only one device is registered so other sessions won't
    /// receive copies of messages.
    case e2eeSingle
    /// One party has no device keys; messages fall back to server-side AES.
    case serverSide

    var icon: String {
        switch self {
        case .loading, .e2ee, .e2eeSingle: "lock.fill"
        case .serverSide: "lock.trianglebadge.exclamationmark.fill"
        }
    }

    var color: Color {
        switch self {
        case .loading:    .gray.opacity(0.4)
        case .e2ee:       .green
        case .e2eeSingle: .green
        case .serverSide: .orange
        }
    }

    var title: String {
        switch self {
        case .loading:    "Checking encryption"
        case .e2ee:       "End-to-end encrypted"
        case .e2eeSingle: "End-to-end encrypted"
        case .serverSide: "Server encrypted"
        }
    }

    var detail: String {
        switch self {
        case .loading:
            "Verifying encryption status."
        case .e2ee:
            "Messages are encrypted on your device and can only be read by you and the recipient."
        case .e2eeSingle:
            "Messages are end-to-end encrypted, but only this device is registered. Open Counter on your other devices so they can receive copies of future messages."
        case .serverSide:
            "One party hasn't set up encryption keys yet. Messages are encrypted in storage by Counter's servers, not on your device."
        }
    }
}

struct ConversationView: View {
    @Environment(\.counterTheme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State var vm: ConversationViewModel
    @Environment(AppEnvironment.self) private var env

    @State private var showEncryptionInfo = false
    @State private var showClearConfirm = false
    @State private var showDeleteConfirm = false

    private var encryptionLevel: EncryptionLevel {
        guard vm.partnerDeviceKeys != nil else { return .loading }
        if vm.isServerEncryptedFallback { return .serverSide }
        if vm.hasSingleDeviceWarning    { return .e2eeSingle }
        return .e2ee
    }

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()
            // safeAreaInset overlays the send bar on top of the scroll view so
            // glassEffect has message content to refract, while still reserving
            // enough inset that the last message isn't hidden behind the bar.
            messageList
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    sendBar
                }

            if vm.isLoading && vm.messages.isEmpty {
                decryptingOverlay
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                presenceTitle
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showEncryptionInfo = true
                } label: {
                    Image(systemName: encryptionLevel.icon)
                        .foregroundStyle(encryptionLevel.color)
                }
                .popover(isPresented: $showEncryptionInfo) {
                    encryptionPopover
                        // Keep it as a popover on compact (iPhone) instead of
                        // adapting to a sheet.
                        .presentationCompactAdaptation(.popover)
                }
            }
        }
        .task {
            await vm.loadInitial()
            // Mark read on appear rather than on each message load to avoid
            // multiple API calls when paginating back through history.
            await vm.markRead()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in
            Task { await vm.reportScreenshot() }
        }
        .alert("Error", isPresented: .constant(vm.errorMessage != nil)) {
            Button("OK") { vm.errorMessage = nil }
        } message: {
            Text(vm.errorMessage ?? "")
        }
        .confirmationDialog("Clear chat?", isPresented: $showClearConfirm, titleVisibility: .visible) {
            Button("Clear for everyone", role: .destructive) {
                Task { await vm.clearChat() }
            }
        } message: {
            Text("All messages will be deleted for both you and @\(vm.partnerUsername). This cannot be undone.")
        }
        .confirmationDialog("Delete conversation?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete for everyone", role: .destructive) {
                Task {
                    await vm.deleteChat()
                    dismiss()
                }
            }
        } message: {
            Text("The entire conversation with @\(vm.partnerUsername) will be permanently deleted for both parties.")
        }
    }

    // MARK: - Presence title

    /// Navigation bar center item: username + online dot or last-seen subtitle.
    private var presenceTitle: some View {
        VStack(spacing: 1) {
            HStack(spacing: 5) {
                Text("@\(vm.partnerUsername)")
                    .font(CounterFont.body(15))
                    .fontWeight(.semibold)

                if vm.partnerProfile?.presence?.isOnline == true {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 7, height: 7)
                }
            }

            // Show last seen only when the user is offline and the field is visible.
            if vm.partnerProfile?.presence?.isOnline != true,
               let lastSeenAt = vm.partnerProfile?.presence?.lastSeenAt {
                Text(timeAgo(lastSeenAt))
                    .font(CounterFont.mono(11))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func timeAgo(_ iso: String) -> String {
        guard let date = parseISO(iso) else { return "" }
        let diff = Int(Date().timeIntervalSince(date))
        if diff < 60 { return "just now" }
        if diff < 3600 { return "\(diff / 60)m ago" }
        if diff < 86400 { return "\(diff / 3600)h ago" }
        return "\(diff / 86400)d ago"
    }

    // MARK: - Encryption popover

    private var encryptionPopover: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: CounterSpacing.md) {
                HStack(spacing: CounterSpacing.sm) {
                    Image(systemName: encryptionLevel.icon)
                        .foregroundStyle(encryptionLevel.color)
                    Text(encryptionLevel.title)
                        .font(CounterFont.body(15).weight(.medium))
                        .foregroundStyle(theme.text)
                }

                if encryptionLevel == .e2ee || encryptionLevel == .e2eeSingle {
                    deviceTable
                } else {
                    Text(encryptionLevel.detail)
                        .font(CounterFont.body(14))
                        .foregroundStyle(theme.textDim)
                }
            }
            .padding(CounterSpacing.lg)

            Divider()

            HStack(spacing: CounterSpacing.sm) {
                Button {
                    showEncryptionInfo = false
                    showClearConfirm = true
                } label: {
                    Text("Clear")
                        .font(CounterFont.mono(13))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.orange)

                Button {
                    showEncryptionInfo = false
                    showDeleteConfirm = true
                } label: {
                    Text("Delete")
                        .font(CounterFont.mono(13))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.red)
            }
            .padding(CounterSpacing.lg)
        }
        .frame(maxWidth: 300)
    }

    private var deviceTable: some View {
        VStack(alignment: .leading, spacing: CounterSpacing.xs) {
            Text("Messages available on:")
                .font(CounterFont.mono(11))
                .foregroundStyle(theme.textDim)
                .padding(.bottom, 2)

            deviceSection(label: "You", keys: vm.myDeviceKeys)

            if let partnerKeys = vm.partnerDeviceKeys, !partnerKeys.isEmpty {
                deviceSection(label: "@\(vm.partnerUsername)", keys: partnerKeys)
            }
        }
    }

    private func deviceSection(label: String, keys: [DeviceKeyEntry]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(CounterFont.mono(11).weight(.medium))
                .foregroundStyle(theme.textDim)

            ForEach(keys, id: \.deviceId) { entry in
                HStack(spacing: CounterSpacing.sm) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.system(size: 13))

                    if entry.deviceId == vm.currentDeviceId {
                        Text("This device")
                            .font(CounterFont.mono(12))
                            .foregroundStyle(theme.text)
                    } else {
                        Text(entry.deviceId)
                            .font(CounterFont.mono(11))
                            .foregroundStyle(theme.textDim)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
        }
    }

    // MARK: - Decrypting overlay

    // Shown on initial load before any messages are ready. Pagination ("load
    // older") reuses isLoading but messages is already populated, so this
    // overlay only fires on the blank first-open gap.
    private var decryptingOverlay: some View {
        VStack(spacing: CounterSpacing.lg) {
            Image(systemName: "lock.fill")
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(theme.accent)
                .symbolEffect(.pulse, options: .repeating)

            Text("Decrypting")
                .font(CounterFont.mono(15))
                .foregroundStyle(theme.textDim)

            ProgressView()
                .progressViewStyle(.linear)
                .tint(theme.accent)
                .frame(width: 160)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Message list

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: CounterSpacing.sm) {
                    // "Load older" trigger at the top.
                    if vm.hasMore {
                        Button("Load older messages") {
                            Task { await vm.loadOlder() }
                        }
                        .font(CounterFont.mono(12))
                        .foregroundStyle(theme.accent)
                        .padding(.top, CounterSpacing.md)
                    }

                    ForEach(vm.messages) { message in
                        messageBubble(message)
                            .id(message.id)
                    }
                }
                .padding(.horizontal, CounterSpacing.lg)
                .padding(.vertical, CounterSpacing.md)
            }
            .onChange(of: vm.messages.count) {
                // Scroll to the latest message when a new one arrives.
                if let last = vm.messages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    // MARK: - Message bubble

    @ViewBuilder
    private func messageBubble(_ message: DirectMessage) -> some View {
        switch message.kind {
        case .screenshot:
            systemNotice(message, icon: "camera.fill", label: {
                let isOwn = message.sender.id == env.authStore.currentUser?.id
                return isOwn ? "You took a screenshot" : "@\(message.sender.username) took a screenshot"
            }())
        case .cleared:
            systemNotice(message, icon: "eraser.fill", label: {
                let isOwn = message.sender.id == env.authStore.currentUser?.id
                return isOwn ? "You cleared the chat" : "@\(message.sender.username) cleared their history"
            }())
        case .deleted:
            systemNotice(message, icon: "trash.fill", label: {
                let isOwn = message.sender.id == env.authStore.currentUser?.id
                return isOwn ? "You deleted the conversation" : "@\(message.sender.username) deleted the conversation"
            }())
        case .message:
            regularBubble(message)
        }
    }

    // Centered pill shown for system events (screenshot, clear, delete).
    private func systemNotice(_ message: DirectMessage, icon: String, label: String) -> some View {
        HStack {
            Spacer()
            HStack(spacing: CounterSpacing.xs) {
                Image(systemName: icon)
                    .font(.system(size: 11))
                Text(label)
                    .font(CounterFont.mono(12))
            }
            .foregroundStyle(theme.textDim)
            .padding(.horizontal, CounterSpacing.md)
            .padding(.vertical, CounterSpacing.xs)
            .background(theme.surface)
            .clipShape(Capsule())
            Spacer()
        }
    }

    private func regularBubble(_ message: DirectMessage) -> some View {
        let isOwn = message.sender.id == env.authStore.currentUser?.id
        return HStack {
            if isOwn { Spacer(minLength: 60) }

            VStack(alignment: isOwn ? .trailing : .leading, spacing: 2) {
                Text(message.body)
                    .font(CounterFont.body(15))
                    .foregroundStyle(isOwn ? Color.black : theme.text)
                    .padding(.horizontal, CounterSpacing.md)
                    .padding(.vertical, CounterSpacing.sm)
                    .background(isOwn ? theme.accent : theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: CounterRadius.lg))

                RelativeTimeText(isoString: message.createdAt)
            }

            if !isOwn { Spacer(minLength: 60) }
        }
    }

    // MARK: - Send bar

    private var sendBar: some View {
        HStack(spacing: CounterSpacing.md) {
            TextField("Message", text: $vm.draftBody, axis: .vertical)
                .font(CounterFont.body(15))
                .lineLimit(1...4)
                .counterGlassInput()

            Button {
                Task { await vm.send() }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(
                        vm.draftBody.trimmingCharacters(in: .whitespaces).isEmpty
                            ? theme.border
                            : theme.accent
                    )
            }
            .disabled(vm.draftBody.trimmingCharacters(in: .whitespaces).isEmpty || vm.isSending)
        }
        .padding(.horizontal, CounterSpacing.lg)
        .padding(.top, CounterSpacing.md)
        .padding(.bottom, CounterSpacing.lg)
        // On iOS 26 the glass capsule is the visual anchor; no container fill.
        // Below iOS 26 a material bar keeps the field legible over dark content.
        .background {
            if #available(iOS 26, *) {
                Color.clear.ignoresSafeArea(edges: .bottom)
            } else {
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .ignoresSafeArea(edges: .bottom)
            }
        }
    }
}

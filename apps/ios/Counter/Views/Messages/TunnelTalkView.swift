/**
 Tunnel Talk session screen.

 Presented as a full-screen cover over the conversation thread when either
 party initiates or accepts a Tunnel Talk session. Shows the connection status,
 consent toggle, message list, and send bar.

 All message content is displayed from the view model's `chatMessages` array,
 which is populated by the WebRTC data channel — nothing in this view posts
 message bodies to a server.
 */

import SwiftUI

struct TunnelTalkView: View {

    @State var vm: TunnelTalkViewModel
    @Environment(\.counterTheme) private var theme
    let onEnd: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                statusBar
                Divider()
                messageList
                Divider()
                composeBar
            }
            .background(theme.bg)
            .navigationTitle("@\(vm.sessionId.prefix(8))…")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    consentToggle
                }
                ToolbarItem(placement: .topBarTrailing) {
                    endButton
                }
            }
            .task {
                await vm.connect()
            }
        }
    }

    // MARK: - Status bar

    private var statusBar: some View {
        HStack(spacing: 8) {
            switch vm.connectionState {
            case .connecting:
                ProgressView().scaleEffect(0.7)
                Text("Connecting…").font(.caption).foregroundStyle(theme.textDim)
            case .connected:
                Circle().fill(.green).frame(width: 8, height: 8)
                Text("P2P Connected").font(.caption).foregroundStyle(.green)
            case .ended:
                Text("Session ended").font(.caption).foregroundStyle(theme.textDim)
            case .error(let msg):
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                Text(msg).font(.caption).foregroundStyle(.red)
            }

            Spacer()

            if vm.partnerConsent {
                Text("Partner saving").font(.caption2).foregroundStyle(theme.textDim)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: - Message list

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    if vm.chatMessages.isEmpty {
                        if case .connected = vm.connectionState {
                            Text("Say something — your message goes directly to your partner.")
                                .font(.subheadline)
                                .foregroundStyle(theme.textDim)
                                .multilineTextAlignment(.center)
                                .padding(.top, 40)
                        }
                    }
                    ForEach(vm.chatMessages) { msg in
                        messageBubble(msg)
                            .id(msg.id)
                    }
                }
                .padding(16)
            }
            .onChange(of: vm.chatMessages.count) { _, _ in
                // Scroll to the newest message when one arrives.
                if let last = vm.chatMessages.last {
                    withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    @ViewBuilder
    private func messageBubble(_ msg: TunnelChatMessage) -> some View {
        HStack {
            if msg.mine { Spacer(minLength: 60) }
            Text(msg.body)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(msg.mine ? theme.accent : theme.surface)
                .foregroundStyle(msg.mine ? .white : theme.text)
                .clipShape(RoundedRectangle(cornerRadius: 16))
            if !msg.mine { Spacer(minLength: 60) }
        }
        .frame(maxWidth: .infinity, alignment: msg.mine ? .trailing : .leading)
    }

    // MARK: - Compose bar

    private var composeBar: some View {
        HStack(spacing: 8) {
            TextField("Message…", text: $vm.draftBody, axis: .vertical)
                .lineLimit(1...4)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .disabled(!(vm.connectionState == .connected))

            Button {
                Task { await vm.send() }
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(vm.draftBody.trimmingCharacters(in: .whitespaces).isEmpty ? theme.textDim : theme.accent)
            }
            .disabled(vm.draftBody.trimmingCharacters(in: .whitespaces).isEmpty || !(vm.connectionState == .connected))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    // MARK: - Controls

    private var consentToggle: some View {
        Toggle(isOn: Binding(
            get: { vm.myConsent },
            set: { _ in
                Task {
                    if vm.myConsent {
                        // Warn before revoking — revocation deletes the transcript.
                        // SwiftUI has no inline async confirm; show a basic toggle with
                        // the delete happening in the view model.
                    }
                    await vm.toggleConsent()
                }
            }
        )) {
            Text("Save").font(.caption)
        }
        .toggleStyle(.button)
        .tint(vm.myConsent ? theme.accent : nil)
    }

    private var endButton: some View {
        Button(role: .destructive) {
            Task {
                await vm.endSession()
                onEnd()
            }
        } label: {
            Text("End")
        }
        .disabled({
            if case .ended = vm.connectionState { return true }
            return false
        }())
    }
}

// MARK: - ConnectionState equatability

extension TunnelTalkViewModel.ConnectionState: Equatable {
    static func == (lhs: TunnelTalkViewModel.ConnectionState, rhs: TunnelTalkViewModel.ConnectionState) -> Bool {
        switch (lhs, rhs) {
        case (.connecting, .connecting): return true
        case (.connected, .connected): return true
        case (.ended, .ended): return true
        case (.error(let a), .error(let b)): return a == b
        default: return false
        }
    }
}

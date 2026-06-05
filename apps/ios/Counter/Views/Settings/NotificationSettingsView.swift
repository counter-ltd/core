/**
 Notification preferences: per-type toggles for in-app and push alerts.

 Turning a type off stops it everywhere — both in-app banners and push
 notifications sent to registered devices. The view model starts with all
 toggles on so the screen renders immediately, then replaces them once the
 server responds.
 */

import SwiftUI

struct NotificationSettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme
    @State private var vm: NotificationSettingsViewModel?

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            List {
                notificationsSection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if vm == nil {
                let newVM = NotificationSettingsViewModel(env: env)
                vm = newVM
                Task { await newVM.load() }
            }
        }
    }

    @ViewBuilder
    private var notificationsSection: some View {
        Section {
            if let vm {
                @Bindable var vm = vm
                Toggle("Likes", isOn: $vm.prefs.like)
                Toggle("Reposts", isOn: $vm.prefs.repost)
                Toggle("Replies", isOn: $vm.prefs.reply)
                Toggle("New followers", isOn: $vm.prefs.follow)
                Toggle("Mentions", isOn: $vm.prefs.mention)
                Toggle("Direct messages", isOn: $vm.prefs.message)

                if let error = vm.errorMessage {
                    Text(error)
                        .font(CounterFont.body(13))
                        .foregroundStyle(theme.danger)
                }

                Button {
                    Task { await vm.save() }
                } label: {
                    if vm.isSaving {
                        ProgressView().tint(.black)
                    } else {
                        Text("Save")
                    }
                }
                .counterPrimaryButton(isLoading: vm.isSaving)
                .disabled(vm.isSaving)
            }
        } footer: {
            Text("Choose what you're notified about, in the app and on your phone. Turning a type off stops it everywhere.")
        }
        .tint(theme.accent)
        .font(CounterFont.body(14))
        .foregroundStyle(theme.text)
        .listRowBackground(theme.surface)
    }
}

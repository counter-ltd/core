/**
 Online-status and last-seen settings.

 Both features are off by default. Each has an independent toggle and a
 visibility picker. The heartbeat interval slider controls how often the
 client signals activity and how long the server waits before marking
 the user offline.
 */

import SwiftUI

struct PresenceSettingsView: View {
    @Environment(\.counterTheme) private var theme
    @State private var vm: PresenceSettingsViewModel?

    @Environment(AppEnvironment.self) private var env

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            List {
                if let vm {
                    onlineStatusSection(vm: vm)
                    lastSeenSection(vm: vm)
                    heartbeatSection(vm: vm)
                    saveSection(vm: vm)
                } else {
                    Section {
                        ProgressView()
                            .listRowBackground(theme.surface)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Online Status")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if vm == nil {
                let newVM = PresenceSettingsViewModel(env: env)
                vm = newVM
                Task { await newVM.load() }
            }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private func onlineStatusSection(vm: PresenceSettingsViewModel) -> some View {
        @Bindable var vm = vm
        Section {
            Toggle("Show online status", isOn: $vm.settings.onlineStatusEnabled)
                .font(CounterFont.body(14))
                .foregroundStyle(theme.text)

            visibilityPicker(
                label: "Visible to",
                selection: $vm.settings.onlineStatusVisibility
            )
        } header: {
            Text("Online Status")
        } footer: {
            Text("Shows a live indicator on your profile when you're active. Off by default.")
                .font(CounterFont.body(12))
        }
        .tint(theme.accent)
        .listRowBackground(theme.surface)
    }

    @ViewBuilder
    private func lastSeenSection(vm: PresenceSettingsViewModel) -> some View {
        @Bindable var vm = vm
        Section {
            Toggle("Show last seen", isOn: $vm.settings.lastSeenEnabled)
                .font(CounterFont.body(14))
                .foregroundStyle(theme.text)

            visibilityPicker(
                label: "Visible to",
                selection: $vm.settings.lastSeenVisibility
            )
        } header: {
            Text("Last Seen")
        } footer: {
            Text("Shows how long ago you were last active. Off by default.")
                .font(CounterFont.body(12))
        }
        .tint(theme.accent)
        .listRowBackground(theme.surface)
    }

    @ViewBuilder
    private func heartbeatSection(vm: PresenceSettingsViewModel) -> some View {
        @Bindable var vm = vm
        Section {
            VStack(alignment: .leading, spacing: CounterSpacing.sm) {
                HStack {
                    Text("Interval")
                        .font(CounterFont.body(14))
                        .foregroundStyle(theme.text)
                    Spacer()
                    Text("\(vm.settings.heartbeatIntervalSeconds)s")
                        .font(CounterFont.mono(13))
                        .foregroundStyle(theme.textDim)
                }
                // 60–3600 seconds; step 30 keeps the slider manageable.
                Slider(
                    value: Binding(
                        get: { Double(vm.settings.heartbeatIntervalSeconds) },
                        set: { vm.settings.heartbeatIntervalSeconds = Int($0) }
                    ),
                    in: 60...3600,
                    step: 30
                )
                .tint(theme.accent)
            }
            .padding(.vertical, CounterSpacing.xs)
        } header: {
            Text("Heartbeat Interval")
        } footer: {
            Text("How often the app signals you're active. Shorter intervals update your status faster.")
                .font(CounterFont.body(12))
        }
        .listRowBackground(theme.surface)
    }

    @ViewBuilder
    private func saveSection(vm: PresenceSettingsViewModel) -> some View {
        Section {
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
        .listRowBackground(theme.surface)
    }

    // MARK: - Helpers

    @ViewBuilder
    private func visibilityPicker(label: String, selection: Binding<PresenceVisibility>) -> some View {
        Picker(label, selection: selection) {
            ForEach(PresenceVisibility.allCases, id: \.self) { option in
                Text(option.label).tag(option)
            }
        }
        .font(CounterFont.body(14))
        .foregroundStyle(theme.text)
        .pickerStyle(.menu)
        .tint(theme.accent)
    }
}

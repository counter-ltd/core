/**
 Privacy > Devices: list registered push devices, register this one, remove old ones.

 Registration is explicitly opt-in here. The app never auto-uploads a push token;
 the user comes to this screen and taps "Register this device" when they want
 notifications on it. Removing a device stops push delivery immediately.
 */

import SwiftUI

struct DevicesView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme
    @State private var vm: DevicesViewModel?

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            Group {
                if let vm {
                    deviceList(vm: vm)
                } else {
                    ProgressView()
                        .tint(theme.textDim)
                }
            }
        }
        .navigationTitle("Devices")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if vm == nil {
                let model = DevicesViewModel(env: env)
                vm = model
                Task { await model.load() }
            }
        }
    }

    @ViewBuilder
    private func deviceList(vm: DevicesViewModel) -> some View {
        @Bindable var vm = vm
        List {
            // --- registered devices ---
            Section {
                if vm.isLoading && vm.devices.isEmpty {
                    HStack {
                        Spacer()
                        ProgressView().tint(theme.textDim)
                        Spacer()
                    }
                    .listRowBackground(theme.surface)
                } else if vm.devices.isEmpty {
                    Text("No devices registered.")
                        .font(CounterFont.body(14))
                        .foregroundStyle(theme.textDim)
                        .listRowBackground(theme.surface)
                } else {
                    ForEach(vm.devices) { device in
                        deviceRow(device, vm: vm)
                    }
                }
            } header: {
                Text("Registered devices")
            } footer: {
                Text("Each device in this list can receive push notifications for your account. Remove devices you no longer use.")
            }
            .font(CounterFont.body(14))
            .foregroundStyle(theme.text)
            .listRowBackground(theme.surface)

            // --- register this device ---
            if vm.canRegister {
                Section {
                    Button {
                        Task { await vm.registerThisDevice() }
                    } label: {
                        if vm.isRegistering {
                            ProgressView().tint(.black)
                        } else {
                            Text("Register this device")
                        }
                    }
                    .counterPrimaryButton(isLoading: vm.isRegistering)
                    .disabled(vm.isRegistering)
                    .listRowBackground(theme.surface)
                    .listRowInsets(.init(top: 12, leading: 16, bottom: 12, trailing: 16))
                } footer: {
                    Text("Registering sends your device's push address to Counter so notifications can be delivered to this phone.")
                }
            }

            if let error = vm.errorMessage {
                Section {
                    Text(error)
                        .font(CounterFont.body(13))
                        .foregroundStyle(theme.danger)
                        .listRowBackground(theme.surface)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(theme.bg)
        .refreshable { await vm.load() }
    }

    @ViewBuilder
    private func deviceRow(_ device: DeviceRecord, vm: DevicesViewModel) -> some View {
        HStack(spacing: CounterSpacing.md) {
            Image(systemName: device.platform == "ios" ? "iphone" : "desktopcomputer")
                .font(.system(size: 18))
                .foregroundStyle(theme.textDim)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: CounterSpacing.sm) {
                    Text(device.name ?? device.platform)
                        .font(CounterFont.body(14))
                        .foregroundStyle(theme.text)
                    // "This device" badge shown when the cached device id matches.
                    if device.id == vm.thisDeviceId {
                        Text("This device")
                            .font(CounterFont.mono(11))
                            .foregroundStyle(theme.accent)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .overlay(
                                RoundedRectangle(cornerRadius: 4)
                                    .stroke(theme.accent, lineWidth: 1)
                            )
                    }
                }
                Text("Last seen \(shortDate(device.lastSeenAt))")
                    .font(CounterFont.mono(11))
                    .foregroundStyle(theme.textDim)
            }

            Spacer()
        }
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                Task { await vm.deleteDevice(id: device.id) }
            } label: {
                Label("Remove", systemImage: "trash")
            }
        }
    }

    private func shortDate(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) else { return iso }
        let fmt = DateFormatter()
        fmt.dateStyle = .medium
        fmt.timeStyle = .none
        return fmt.string(from: date)
    }
}

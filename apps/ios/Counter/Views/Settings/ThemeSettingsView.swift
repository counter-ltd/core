/**
 Appearance settings: pick the light/dark base and the applied custom theme.

 The base picker writes straight through to `ThemeStore`, which persists it and
 recomputes the palette; the whole app recolors live because the palette rides
 the environment. The gallery link pushes `ThemeGalleryView` for browsing and
 applying published themes.
 */

import SwiftUI

struct ThemeSettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme

    var body: some View {
        let store = env.themeStore

        ZStack {
            theme.bg.ignoresSafeArea()

            List {
                baseSection(store: store)
                themeSection(store: store)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Appearance")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Sections

    private func baseSection(store: ThemeStore) -> some View {
        // Re-derive a bindable handle here: the `$` projection only exists in
        // the scope that declares `@Bindable`, so it can't cross the call from
        // `body`.
        @Bindable var store = store
        return Section {
            Picker("Base", selection: $store.base) {
                Text("Dark").tag(BaseScheme.dark)
                Text("Light").tag(BaseScheme.light)
            }
            .pickerStyle(.segmented)
            .listRowBackground(theme.surface)
        } header: {
            Text("Base")
        } footer: {
            Text("The starting palette. A custom theme layers on top, overriding only the colors it defines.")
        }
    }

    private func themeSection(store: ThemeStore) -> some View {
        Section("Theme") {
            NavigationLink {
                ThemeGalleryView()
            } label: {
                HStack {
                    Text("Themes")
                        .font(CounterFont.body(14))
                        .foregroundStyle(theme.text)
                    Spacer()
                    // Surface the active selection inline so the row doubles as
                    // a status readout, not just a navigation affordance.
                    Text(store.selectedTheme?.name ?? "Default")
                        .font(CounterFont.mono(12))
                        .foregroundStyle(theme.textDim)
                }
            }
            .listRowBackground(theme.surface)

            if store.selectedTheme != nil {
                Button("Use default") {
                    store.useDefault()
                }
                .font(CounterFont.body(14))
                .foregroundStyle(theme.accent)
                .listRowBackground(theme.surface)
            }
        }
    }
}

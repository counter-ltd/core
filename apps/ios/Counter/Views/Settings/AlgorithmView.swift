/**
 The algorithm, in the open: live feed-ranking config and its change history.

 Counter's feed is ranked by a single shared formula with no per-user
 personalization. This view fetches the exact config the server uses and shows
 the weights, parameters, and every version change so anyone can audit how
 ranking decisions are made.
 */

import SwiftUI

struct AlgorithmView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme
    @State private var state: AlgorithmState?
    @State private var changelog: [AlgorithmChangelogEntry] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            Group {
                if isLoading {
                    ProgressView()
                        .tint(theme.accent)
                } else {
                    List {
                        if let state {
                            configSection(state)
                        }
                        if !changelog.isEmpty {
                            changelogSection
                        }
                        if let error = errorMessage {
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
                }
            }
        }
        .navigationTitle("The algorithm")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    // MARK: - Sections

    @ViewBuilder
    private func configSection(_ s: AlgorithmState) -> some View {
        Section {
            // Version + live badge on the same row.
            HStack(spacing: CounterSpacing.sm) {
                Text("v\(s.version)")
                    .font(CounterFont.mono(14).weight(.semibold))
                    .foregroundStyle(theme.text)
                Text("live")
                    .font(CounterFont.mono(11))
                    .foregroundStyle(theme.accent)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(theme.accent.opacity(0.12))
                    .clipShape(Capsule())
            }
            .listRowBackground(theme.surface)

            Text(s.description)
                .font(CounterFont.body(13))
                .foregroundStyle(theme.textDim)
                .listRowBackground(theme.surface)
        } header: {
            Text("Live config")
        } footer: {
            Text("The same weights the server ranks with. No personalization profile, no individual tracking.")
        }

        Section("Weights") {
            ForEach(s.weights.keys.sorted(), id: \.self) { key in
                kvRow(key: key, value: formatWeight(s.weights[key]!))
            }
        }

        Section("Parameters") {
            ForEach(s.parameters.keys.sorted(), id: \.self) { key in
                kvRow(key: key, value: s.parameters[key]!.displayString)
            }
        }
    }

    private var changelogSection: some View {
        Section("Changelog") {
            ForEach(changelog) { entry in
                VStack(alignment: .leading, spacing: CounterSpacing.xs) {
                    HStack {
                        Text("v\(entry.version) — \(entry.summary)")
                            .font(CounterFont.body(14))
                            .foregroundStyle(theme.text)
                        Spacer()
                        Text(timeAgo(from: entry.deployedAt))
                            .font(CounterFont.mono(11))
                            .foregroundStyle(theme.textDim)
                    }
                    if let detail = entry.detail {
                        Text(detail)
                            .font(CounterFont.body(13))
                            .foregroundStyle(theme.textDim)
                    }
                    HStack(spacing: 4) {
                        Text("by @\(entry.changedBy)")
                            .font(CounterFont.mono(11))
                            .foregroundStyle(theme.textDim)
                        Text("·")
                            .font(CounterFont.mono(11))
                            .foregroundStyle(theme.textDim)
                        Text(String(entry.commitHash.prefix(7)))
                            .font(CounterFont.mono(11))
                            .foregroundStyle(theme.textDim)
                    }
                }
                .padding(.vertical, CounterSpacing.xs)
                .listRowBackground(theme.surface)
            }
        }
    }

    // MARK: - Helpers

    @ViewBuilder
    private func kvRow(key: String, value: String) -> some View {
        HStack {
            Text(key)
                .font(CounterFont.mono(13))
                .foregroundStyle(theme.text)
            Spacer()
            Text(value)
                .font(CounterFont.mono(13).weight(.semibold))
                .foregroundStyle(theme.accent)
        }
        .listRowBackground(theme.surface)
    }

    private func formatWeight(_ v: Double) -> String {
        // Show whole numbers without a decimal point for cleaner display.
        v.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(v))" : "\(v)"
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        async let stateResult: APIResult<AlgorithmState> =
            env.apiClient.request(.algorithm)
        async let changelogResult: APIResult<Page<AlgorithmChangelogEntry>> =
            env.apiClient.request(.algorithmChangelog)

        let (s, c) = await (stateResult, changelogResult)

        if case .success(let v) = s {
            state = v
        } else if case .apiError(let e) = s {
            errorMessage = e.message
        } else {
            errorMessage = s.errorMessage
        }

        if case .success(let page) = c {
            changelog = page.data
        }
    }
}

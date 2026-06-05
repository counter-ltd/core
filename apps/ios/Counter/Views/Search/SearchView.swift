/**
 Search screen: find posts, users, and tags.

 A segmented picker switches between Posts and Users result modes. The query
 is debounced in the view model so calls don't fire on every keystroke.
 */

import SwiftUI

struct SearchView: View {
    @Environment(\.counterTheme) private var theme
    @State var vm: SearchViewModel

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            VStack(spacing: 0) {
                Picker("Type", selection: $vm.selectedType) {
                    ForEach(SearchViewModel.ResultType.allCases, id: \.self) { type in
                        Text(type.rawValue).tag(type)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, CounterSpacing.lg)
                .padding(.vertical, CounterSpacing.md)

                if vm.isLoading {
                    ProgressView().padding(.top, CounterSpacing.xl)
                    Spacer()
                } else {
                    results
                }
            }
        }
        .navigationTitle("Search")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $vm.query, prompt: "Search Counter")
        .onChange(of: vm.selectedType) {
            // Re-run the current query when switching tabs.
            Task { await vm.search() }
        }
    }

    @ViewBuilder
    private var results: some View {
        switch vm.selectedType {
        case .posts:
            if vm.posts.isEmpty && !vm.query.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(vm.posts) { post in
                        PostRowView(post: post)
                            .counterListRow()
                    }
                }
                .listStyle(.plain)
                .background(theme.bg)
                .scrollContentBackground(.hidden)
            }

        case .users:
            if vm.users.isEmpty && !vm.query.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(vm.users) { user in
                        NavigationLink(value: AppDestination.profile(username: user.username)) {
                            UserRowView(user: user)
                        }
                        .buttonStyle(.plain)
                        .counterListRow()
                    }
                }
                .listStyle(.plain)
                .background(theme.bg)
                .scrollContentBackground(.hidden)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: CounterSpacing.md) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 40))
                .foregroundStyle(theme.textDim)
            Text("No results for \"\(vm.query)\"")
                .font(CounterFont.body(15))
                .foregroundStyle(theme.textDim)
            Spacer()
        }
        .padding(.top, CounterSpacing.xl)
    }
}

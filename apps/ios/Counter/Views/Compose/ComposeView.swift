/**
 Compose sheet for creating a new post or a reply.

 Presented as a `.sheet` from the FAB or the reply toolbar button. In reply
 mode `vm.parentId` is set and the header says "Reply" instead of "New post".
 On successful submission the sheet dismisses automatically.
 */

import SwiftUI

struct ComposeView: View {
    @Environment(\.counterTheme) private var theme
    @State var vm: ComposeViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                theme.bg.ignoresSafeArea()

                VStack(alignment: .leading, spacing: CounterSpacing.lg) {
                    TextEditor(text: $vm.body)
                        .font(CounterFont.body(16))
                        .foregroundStyle(theme.text)
                        .scrollContentBackground(.hidden)
                        .background(Color.clear)
                        .frame(minHeight: 120)
                        .padding(.horizontal, CounterSpacing.md)

                    if let error = vm.errorMessage {
                        Text(error)
                            .font(CounterFont.body(13))
                            .foregroundStyle(theme.danger)
                            .padding(.horizontal, CounterSpacing.lg)
                    }

                    Spacer()

                    HStack {
                        // Character counter turns red when near the limit.
                        Text("\(vm.remainingCharacters)")
                            .font(CounterFont.mono(13))
                            .foregroundStyle(
                                vm.remainingCharacters < 50
                                    ? theme.danger
                                    : theme.textDim
                            )

                        Spacer()
                    }
                    .padding(.horizontal, CounterSpacing.lg)
                    .padding(.bottom, CounterSpacing.md)
                }
            }
            .navigationTitle(vm.parentId == nil ? "New post" : "Reply")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(theme.textDim)
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Post") {
                        Task {
                            await vm.post()
                            if vm.body.isEmpty { dismiss() }
                        }
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(vm.canPost ? theme.accent : theme.textDim)
                    .disabled(!vm.canPost)
                }
            }
        }
        .onAppear {
            // Notify the parent when the post succeeds.
            vm.onSuccess = { _ in dismiss() }
        }
    }
}

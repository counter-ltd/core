/**
 Compose sheet for creating a new post or a reply.

 Presented as a `.sheet` from the FAB or the reply toolbar button. In reply
 mode `vm.parentId` is set and the header says "Reply" instead of "New post".
 On successful submission the sheet dismisses automatically.

 Photos are picked with `PhotosPicker` and uploaded the moment they're chosen,
 so by the time Post is tapped the view model already holds their object ids.
 */

import SwiftUI
import PhotosUI

struct ComposeView: View {
    @Environment(\.counterTheme) private var theme
    @State var vm: ComposeViewModel
    @Environment(\.dismiss) private var dismiss

    // Bound to the picker; cleared after each pick so the same photo can be
    // re-selected and the change handler always fires.
    @State private var pickerItems: [PhotosPickerItem] = []

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

                    if !vm.attachments.isEmpty {
                        attachmentStrip
                    }

                    if let error = vm.errorMessage {
                        Text(error)
                            .font(CounterFont.body(13))
                            .foregroundStyle(theme.danger)
                            .padding(.horizontal, CounterSpacing.lg)
                    }

                    Spacer()

                    HStack(spacing: CounterSpacing.md) {
                        // Photo picker, disabled once the 4-photo cap is hit.
                        PhotosPicker(
                            selection: $pickerItems,
                            maxSelectionCount: max(1, ComposeViewModel.maxAttachments - vm.attachments.count),
                            matching: .images
                        ) {
                            Image(systemName: "photo.on.rectangle")
                                .font(.system(size: 20))
                                .foregroundStyle(vm.canAddPhoto ? theme.accent : theme.textDim)
                        }
                        .disabled(!vm.canAddPhoto)

                        if vm.isUploading {
                            ProgressView().controlSize(.small)
                        }

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
                        Task { await vm.post() }
                    }
                    .fontWeight(.semibold)
                    .foregroundStyle(vm.canPost ? theme.accent : theme.textDim)
                    .disabled(!vm.canPost)
                }
            }
            .onChange(of: pickerItems) { _, items in
                guard !items.isEmpty else { return }
                Task { await uploadPicked(items) }
            }
        }
        .onAppear {
            // Notify the parent when the post succeeds.
            vm.onSuccess = { _ in dismiss() }
        }
    }

    // MARK: - Attachments

    private var attachmentStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: CounterSpacing.sm) {
                ForEach(vm.attachments) { attachment in
                    ZStack(alignment: .topTrailing) {
                        if let image = UIImage(data: attachment.preview) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 72, height: 72)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        Button {
                            vm.removeAttachment(attachment.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 18))
                                .foregroundStyle(.white, .black.opacity(0.6))
                        }
                        .padding(2)
                    }
                }
            }
            .padding(.horizontal, CounterSpacing.lg)
        }
    }

    /// Load each picked item's bytes and hand them to the view model to upload,
    /// then clear the selection so the picker is ready for the next add.
    private func uploadPicked(_ items: [PhotosPickerItem]) async {
        for item in items {
            if let data = try? await item.loadTransferable(type: Data.self) {
                await vm.addAttachment(data)
            }
        }
        pickerItems = []
    }
}

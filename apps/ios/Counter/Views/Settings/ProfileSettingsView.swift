/**
 Profile settings: display name, bio, avatar photo, and badge visibility.

 Badges show only verified integrations. The user can toggle whether each
 badge appears on their public profile. Connect platforms from Connections
 settings to get verified badges here.
 */

import SwiftUI
import PhotosUI

struct ProfileSettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.counterTheme) private var theme
    @State private var displayName: String = ""
    @State private var bio: String = ""
    @State private var isSaving: Bool = false
    @State private var saveError: String?
    @State private var integrationsList: [Integration] = []

    // Avatar picker state. `avatarObjectId` is set once an upload lands; the
    // `avatarCleared` flag distinguishes "remove it" from "leave it alone", so a
    // save with neither touched keeps the existing avatar.
    @State private var avatarPickerItem: PhotosPickerItem?
    @State private var avatarPreview: Data?
    @State private var avatarObjectId: String?
    @State private var avatarCleared: Bool = false
    @State private var isUploadingAvatar: Bool = false

    var body: some View {
        ZStack {
            theme.bg.ignoresSafeArea()

            List {
                profileSection
                badgesSection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bg)
        }
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { prefillProfile() }
        .task { await loadIntegrations() }
        .onChange(of: avatarPickerItem) { _, item in
            guard let item else { return }
            Task { await uploadAvatar(item) }
        }
    }

    // MARK: - Avatar field

    private var avatarField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Avatar")
                .font(CounterFont.mono(11))
                .foregroundStyle(theme.textDim)
            HStack(spacing: CounterSpacing.md) {
                avatarThumbnail
                PhotosPicker(selection: $avatarPickerItem, matching: .images) {
                    Text(isUploadingAvatar ? "Uploading…" : "Choose photo")
                        .font(CounterFont.body(13))
                        .foregroundStyle(theme.accent)
                }
                .disabled(isUploadingAvatar)
                if hasAvatar {
                    Button("Remove") { clearAvatar() }
                        .font(CounterFont.body(13))
                        .foregroundStyle(theme.danger)
                }
            }
        }
    }

    /// The 56pt circle preview: a freshly-picked image, the saved avatar, or a
    /// blank placeholder when cleared or unset.
    @ViewBuilder
    private var avatarThumbnail: some View {
        if let data = avatarPreview, let image = UIImage(data: data) {
            Image(uiImage: image).resizable().scaledToFill()
                .frame(width: 56, height: 56).clipShape(Circle())
        } else if !avatarCleared, let urlString = env.authStore.currentUser?.avatarUrl,
                  let url = URL(string: urlString) {
            AsyncImage(url: url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Circle().fill(theme.surface)
            }
            .frame(width: 56, height: 56).clipShape(Circle())
        } else {
            Circle().fill(theme.surface).frame(width: 56, height: 56)
        }
    }

    /// True when there's an avatar to remove: a saved one (not yet cleared) or a
    /// just-picked one.
    private var hasAvatar: Bool {
        if avatarPreview != nil { return true }
        return !avatarCleared && env.authStore.currentUser?.avatarUrl != nil
    }

    // MARK: - Sections

    private var profileSection: some View {
        Section {
            VStack(alignment: .leading, spacing: CounterSpacing.md) {
                avatarField
                labeledField("Display name", text: $displayName)
                labeledField("Bio", text: $bio)

                if let error = saveError {
                    Text(error)
                        .font(CounterFont.body(13))
                        .foregroundStyle(theme.danger)
                }

                Button {
                    Task { await saveProfile() }
                } label: {
                    if isSaving {
                        ProgressView().tint(.black)
                    } else {
                        Text("Save changes")
                    }
                }
                .counterPrimaryButton(isLoading: isSaving)
                .disabled(isSaving)
            }
            .padding(.vertical, CounterSpacing.sm)
            .listRowBackground(theme.surface)
        }
    }

    private var badgesSection: some View {
        let verified = integrationsList.filter { $0.verified }
        return Section("Badges") {
            if verified.isEmpty {
                Text("No verified badges yet. Connect platforms from Connections settings.")
                    .font(CounterFont.body(13))
                    .foregroundStyle(theme.textDim)
                    .listRowBackground(theme.surface)
            } else {
                ForEach(verified) { integration in
                    badgeRow(integration)
                }
            }
        }
    }

    @ViewBuilder
    private func badgeRow(_ integration: Integration) -> some View {
        HStack {
            badgePlatformIcon(integration.platform)
                .frame(width: 20, height: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(platformDisplayName(integration.platform))
                    .font(CounterFont.body(14))
                    .foregroundStyle(theme.text)
                if let username = integration.username {
                    Text("@\(username)")
                        .font(CounterFont.mono(12))
                        .foregroundStyle(theme.textDim)
                }
            }
            Spacer()
            Button(integration.displayed ? "Hide" : "Show") {
                Task { await toggleBadge(integration) }
            }
            .font(CounterFont.body(13))
            .foregroundStyle(theme.accent)
        }
        .listRowBackground(theme.surface)
    }

    @ViewBuilder
    private func badgePlatformIcon(_ platform: String) -> some View {
        switch platform {
        case "github":
            Image("github-logo").brandLogo(size: 18).foregroundStyle(theme.text)
        case "discord":
            Image("discord-logo").brandLogo(size: 18).foregroundStyle(theme.text)
        default:
            // Text fallback for platforms without a dedicated image asset.
            Text("✦").font(.system(size: 13)).foregroundStyle(theme.textDim)
        }
    }

    private func platformDisplayName(_ platform: String) -> String {
        switch platform {
        case "github": return "GitHub"
        case "discord": return "Discord"
        case "bandcamp": return "Bandcamp"
        case "soundcloud": return "SoundCloud"
        case "letterboxd": return "Letterboxd"
        case "goodreads": return "Goodreads"
        case "strava": return "Strava"
        case "itch": return "itch.io"
        case "website": return "Website"
        default: return platform
        }
    }

    // MARK: - Helpers

    private func labeledField(_ label: String, text: Binding<String>, keyboard: UIKeyboardType = .default) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(CounterFont.mono(11))
                .foregroundStyle(theme.textDim)
            TextField(label, text: text)
                .font(CounterFont.body(14))
                .keyboardType(keyboard)
                .autocapitalization(.none)
                .counterInput()
        }
    }

    private func prefillProfile() {
        guard let user = env.authStore.currentUser else { return }
        displayName = user.displayName ?? ""
        bio = user.bio ?? ""
    }

    /// Upload the picked image and point the avatar at the returned object.
    private func uploadAvatar(_ item: PhotosPickerItem) async {
        isUploadingAvatar = true
        saveError = nil
        defer { isUploadingAvatar = false }

        guard let data = try? await item.loadTransferable(type: Data.self) else {
            saveError = "Could not read that image."
            return
        }
        // The server sniffs the real format, so the part's content type is just a
        // hint; jpeg covers the common case from the photo library.
        let result = await env.apiClient.upload(data, mimeType: "image/jpeg")
        switch result {
        case .success(let media):
            avatarObjectId = media.id
            avatarPreview = data
            avatarCleared = false
        case .apiError(let e):
            saveError = e.message
        case .networkError:
            saveError = result.errorMessage
        }
    }

    /// Mark the avatar for removal on the next save.
    private func clearAvatar() {
        avatarObjectId = nil
        avatarPreview = nil
        avatarPickerItem = nil
        avatarCleared = true
    }

    private func saveProfile() async {
        isSaving = true
        saveError = nil
        defer { isSaving = false }

        // Only send an avatar change when the picker actually touched it.
        let avatar: AvatarChange
        if let objectId = avatarObjectId {
            avatar = .set(objectId)
        } else if avatarCleared {
            avatar = .clear
        } else {
            avatar = .keep
        }

        let result: APIResult<PrivateUser> = await env.apiClient.request(
            .updateProfile(
                displayName: displayName.isEmpty ? nil : displayName,
                bio: bio.isEmpty ? nil : bio,
                avatar: avatar
            )
        )
        switch result {
        case .success(let user):
            env.authStore.updateUser(user)
            // Reset the local picker state so the preview tracks the saved value.
            avatarObjectId = nil
            avatarPreview = nil
            avatarCleared = false
        case .apiError(let e):
            saveError = e.message
        case .networkError:
            saveError = result.errorMessage
        }
    }

    private func loadIntegrations() async {
        let result: APIResult<[Integration]> = await env.apiClient.request(.integrations)
        if case .success(let list) = result { integrationsList = list }
    }

    private func toggleBadge(_ integration: Integration) async {
        let result: APIResult<Integration> = await env.apiClient.request(
            .patchIntegration(id: integration.id, displayed: !integration.displayed)
        )
        if case .success(let updated) = result {
            integrationsList = integrationsList.map { $0.id == updated.id ? updated : $0 }
        }
    }
}

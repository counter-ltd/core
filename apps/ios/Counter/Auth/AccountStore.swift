/**
 Multi-account management: the list of signed-in accounts in Keychain.

 Mirrors the web's `counter_accounts` cookie system. The account list is a
 JSON array stored under `counter.accounts`; the first entry is always the
 active account. Switching reorders the array and forces a token refresh on
 the next API call by clearing the new active account's access token.

 `AccountStore` is `@Observable` so `SettingsView` can display the list and
 react to switches/removes without a separate fetch.
 */

import Foundation
import Observation

/// One entry in the stored accounts list.
struct StoredAccount: Codable, Identifiable, Sendable {
    let id: String
    let username: String
    let displayName: String?
    let avatarUrl: String?
    /// Short-lived; may be nil after an account switch (triggers refresh).
    var accessToken: String?
    /// Long-lived; always present for a valid stored account.
    let refreshToken: String
}

@Observable
final class AccountStore {

    private(set) var accounts: [StoredAccount] = []

    /// The account at index 0, if any.
    var activeAccount: StoredAccount? { accounts.first }

    // MARK: - Load

    /// Reads the account list from Keychain. Call once at app launch.
    func load() {
        guard
            let data = try? KeychainStore.loadData(forKey: KeychainStore.Key.accounts),
            let loaded = try? JSONDecoder().decode([StoredAccount].self, from: data)
        else { return }
        accounts = loaded
    }

    // MARK: - Add / update

    /// Adds a new account or updates an existing entry, then makes it active
    /// by moving it to the front of the list.
    func upsert(_ account: StoredAccount) {
        accounts.removeAll { $0.id == account.id }
        // New account goes to the front so it becomes active immediately.
        accounts.insert(account, at: 0)
        persist()
    }

    // MARK: - Switch

    /// Moves the account with the given ID to the front of the list and clears
    /// its access token so the next request triggers a refresh.
    ///
    /// Returns the new active account, or nil if the ID wasn't found.
    @discardableResult
    func switchTo(id: String) -> StoredAccount? {
        guard let idx = accounts.firstIndex(where: { $0.id == id }), idx != 0 else {
            return accounts.first
        }
        var account = accounts.remove(at: idx)
        // Clearing the access token forces a refresh on the next API call.
        // The refresh token is still valid, so this is seamless.
        account.accessToken = nil
        accounts.insert(account, at: 0)
        persist()
        return account
    }

    // MARK: - Update tokens after refresh

    /// Updates the stored tokens for the active account after a rotation.
    func updateActiveTokens(_ pair: TokenPair) {
        guard !accounts.isEmpty else { return }
        accounts[0].accessToken = pair.accessToken
        persist()
    }

    // MARK: - Remove

    /// Removes an account from the list. If it was active, the next account
    /// (if any) becomes active — the caller must update `AuthStore` accordingly.
    func remove(id: String) {
        accounts.removeAll { $0.id == id }
        persist()
    }

    // MARK: - Persistence

    private func persist() {
        guard let data = try? JSONEncoder().encode(accounts) else { return }
        try? KeychainStore.saveData(data, forKey: KeychainStore.Key.accounts)
    }
}

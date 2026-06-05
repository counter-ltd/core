/**
 Central auth state: tokens, current user, and session lifecycle.

 `AuthStore` is `@Observable` so SwiftUI views automatically re-render when
 auth state changes. It owns the Keychain writes for the active account's
 tokens; `AccountStore` owns the multi-account list.

 The separation matters: `AuthStore` is the source of truth the UI reads from
 second to second. `AccountStore` is for managing the list of stored accounts.
 */

import Foundation
import Observation

@Observable
final class AuthStore {

    // MARK: - Published state

    private(set) var currentUser: PrivateUser?
    private(set) var accessToken: String?
    private(set) var refreshToken: String?

    var isAuthenticated: Bool { accessToken != nil }

    // MARK: - Session management

    /// Stores a new token pair and user after a successful login or refresh.
    func storeSession(tokens: TokenPair, user: PrivateUser) {
        accessToken = tokens.accessToken
        refreshToken = tokens.refreshToken
        currentUser = user

        try? KeychainStore.save(tokens.accessToken, forKey: KeychainStore.Key.accessToken)
        try? KeychainStore.save(tokens.refreshToken, forKey: KeychainStore.Key.refreshToken)
    }

    /// Updates tokens in memory and Keychain after a refresh rotation.
    /// Does not update `currentUser` because the user hasn't changed.
    func updateTokens(_ pair: TokenPair) {
        accessToken = pair.accessToken
        refreshToken = pair.refreshToken

        try? KeychainStore.save(pair.accessToken, forKey: KeychainStore.Key.accessToken)
        try? KeychainStore.save(pair.refreshToken, forKey: KeychainStore.Key.refreshToken)
    }

    /// Called when the user logs out or a refresh fails.
    /// Clears in-memory state and removes this account's tokens from Keychain.
    func clearSession() {
        accessToken = nil
        refreshToken = nil
        currentUser = nil

        KeychainStore.delete(forKey: KeychainStore.Key.accessToken)
        KeychainStore.delete(forKey: KeychainStore.Key.refreshToken)
    }

    /// Updates just the in-memory user (after a profile edit, for example).
    func updateUser(_ user: PrivateUser) {
        currentUser = user
    }

    // MARK: - App launch restore

    /// Loads tokens from Keychain, returning them for the caller to validate
    /// against the API. Does not set `currentUser` (that requires an API call).
    func loadFromKeychain() -> (access: String?, refresh: String?) {
        let access = try? KeychainStore.load(forKey: KeychainStore.Key.accessToken)
        let refresh = try? KeychainStore.load(forKey: KeychainStore.Key.refreshToken)
        accessToken = access
        refreshToken = refresh
        return (access, refresh)
    }

    /// Sets the in-memory access token after account switching.
    /// The refresh token is loaded by `AccountStore` from the full account entry.
    func setTokensForSwitch(access: String?, refresh: String) {
        accessToken = access
        refreshToken = refresh
    }
}

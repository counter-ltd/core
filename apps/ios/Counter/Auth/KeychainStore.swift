/**
 Low-level Keychain read/write/delete helpers.

 Uses the Security framework directly. All operations are synchronous and
 performed on whatever thread calls them; callers are responsible for not
 blocking the main thread with large payloads (none of our values are large).

 Keys are namespaced under the app's bundle ID to avoid collisions when running
 multiple schemes (debug vs release) on the same device.
 */

import Foundation
import Security

enum KeychainStore {

    private static let service = Bundle.main.bundleIdentifier ?? "ltd.counter.app"

    // MARK: - String values (tokens)

    /// Writes a string value to the Keychain, creating or updating the entry.
    static func save(_ value: String, forKey key: String) throws {
        guard let data = value.data(using: .utf8) else {
            throw KeychainError.encodingFailed
        }
        try saveData(data, forKey: key)
    }

    /// Reads a string value from the Keychain.
    /// Returns nil if the key doesn't exist.
    static func load(forKey key: String) throws -> String? {
        guard let data = try loadData(forKey: key) else { return nil }
        guard let string = String(data: data, encoding: .utf8) else {
            throw KeychainError.decodingFailed
        }
        return string
    }

    // MARK: - Data values (account list JSON)

    /// Writes raw data to the Keychain.
    static func saveData(_ data: Data, forKey key: String) throws {
        let query = baseQuery(forKey: key)

        // Try updating an existing item first.
        let updateStatus = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData: data] as CFDictionary
        )

        if updateStatus == errSecSuccess { return }

        // Item doesn't exist; add it.
        var addQuery = query
        addQuery[kSecValueData as String] = data
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)

        guard addStatus == errSecSuccess else {
            throw KeychainError.writeFailed(addStatus)
        }
    }

    /// Reads raw data from the Keychain.
    static func loadData(forKey key: String) throws -> Data? {
        var query = baseQuery(forKey: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw KeychainError.readFailed(status)
        }
        return result as? Data
    }

    /// Deletes a Keychain entry. Silently succeeds if the key doesn't exist.
    static func delete(forKey key: String) {
        SecItemDelete(baseQuery(forKey: key) as CFDictionary)
    }

    // MARK: - Helpers

    private static func baseQuery(forKey key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}

// MARK: - Keychain keys

extension KeychainStore {
    enum Key {
        static let accessToken = "counter.accessToken"
        static let refreshToken = "counter.refreshToken"
        /// JSON-encoded array of `StoredAccount` for multi-account support.
        static let accounts = "counter.accounts"
    }
}

// MARK: - Errors

enum KeychainError: Error {
    case encodingFailed
    case decodingFailed
    case writeFailed(OSStatus)
    case readFailed(OSStatus)
}

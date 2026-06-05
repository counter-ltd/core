/**
 Client-side end-to-end encryption for Counter direct messages.

 Algorithm: ECDH P-256 + HKDF-SHA256 + AES-256-GCM. A fresh ephemeral key pair
 is generated for every outgoing message, so past ciphertexts cannot be
 decrypted even if the long-term private key is later compromised.

 Multi-device format (v3): the sender encrypts a separate copy of each message
 for every registered device key on both sides. Each copy is a v2 envelope.
 All copies are stored as a base64-encoded JSON array in the `v3:` payload.
 The recipient (and sender's other devices) find their copy by matching their
 stable device ID.

 Key storage: the private key is kept in the Keychain. The device ID (a stable
 UUID that survives key rotation) is stored in UserDefaults alongside it. If
 either is missing a new pair is generated. Messages encrypted for the old key
 will show "[Encrypted with a previous key]" after the rotation.
 */

import Foundation
import CryptoKit
import Security

// MARK: - Errors

enum E2EEError: Error {
    case keychainStore(OSStatus)
    case keychainLoad(OSStatus)
    case malformedCiphertext
    case base64Decode
    /// v3 message has no copy encrypted for this device.
    case noDeviceCopy
}

// MARK: - Service

/// Singleton that owns the local P-256 key pair and performs message crypto.
final class E2EEService {

    static let shared = E2EEService()
    private init() {}

    private let keychainService = "counter.e2ee"
    private let keychainAccount = "private-key"
    private let deviceIdKey = "counter.e2ee.deviceId"
    private let hkdfInfo = Data("counter-dm-v1".utf8)

    // MARK: - Key management

    /**
     Load the private key and device ID from storage, or generate fresh ones.

     Returns the key, a stable device UUID, and whether the pair is freshly
     generated. When `isNew` is true the caller should upload the public key
     via POST /auth/keys so other users can encrypt messages for this device.
     */
    func loadOrGenerateKeyPair() throws -> (
        privateKey: P256.KeyAgreement.PrivateKey,
        deviceId: String,
        isNew: Bool
    ) {
        // Device ID is stable across key rotations; store it in UserDefaults
        // (not Keychain) because it is not secret — it is sent to the server.
        let deviceId: String
        if let stored = UserDefaults.standard.string(forKey: deviceIdKey) {
            deviceId = stored
        } else {
            deviceId = UUID().uuidString
            UserDefaults.standard.set(deviceId, forKey: deviceIdKey)
        }

        if let existing = try loadPrivateKey() {
            return (existing, deviceId, false)
        }
        let newKey = P256.KeyAgreement.PrivateKey()
        try storePrivateKey(newKey)
        return (newKey, deviceId, true)
    }

    /**
     Export the public key as SPKI-DER base64, matching the format WebCrypto
     uses for `crypto.subtle.exportKey('spki', key)`.
     */
    func exportPublicKey(_ key: P256.KeyAgreement.PrivateKey) -> String {
        // CryptoKit's derRepresentation for P-256 public keys is SubjectPublicKeyInfo
        // DER, which is exactly what the web client and server store.
        key.publicKey.derRepresentation.base64EncodedString()
    }

    // MARK: - Encrypt

    /**
     Encrypt `plaintext` for every device in `recipientKeys` and `senderKeys`,
     returning a `v3:` ciphertext suitable for the API.

     Including `senderKeys` lets the sender read their own messages on every
     registered device. The current device should be in `senderKeys` even if
     its registration hasn't been reflected in the server's data yet.

     - Parameters:
       - plaintext: The raw message body.
       - recipientKeys: All device keys registered by the recipient.
       - senderKeys: All device keys the sender wants copies for.
     */
    func encryptForDevices(
        plaintext: String,
        recipientKeys: [DeviceKeyEntry],
        senderKeys: [DeviceKeyEntry]
    ) throws -> String {
        // Combine and deduplicate on deviceId (handles the self-message test case).
        var seen = Set<String>()
        let targets = (recipientKeys + senderKeys).filter { seen.insert($0.deviceId).inserted }

        let copies: [[String: String]] = try targets.map { target in
            let v2 = try encryptForKey(plaintext: plaintext, recipientPublicKeyB64: target.publicKey)
            return ["d": target.deviceId, "b": v2]
        }

        let jsonData = try JSONSerialization.data(withJSONObject: copies)
        return "v3:\(jsonData.base64EncodedString())"
    }

    // MARK: - Decrypt

    /**
     Decrypt a ciphertext using the local private key.

     Handles both `v2:` (single-device, legacy) and `v3:` (multi-device) formats.
     For v3, finds the copy matching `myDeviceId` and decrypts it.
     Non-encrypted strings are returned as-is.

     - Parameters:
       - ciphertext: The body field from a DirectMessage with `encrypted == true`.
       - privateKey: The key from `loadOrGenerateKeyPair`.
       - myDeviceId: The stable device ID from `loadOrGenerateKeyPair`. Required for v3.
     */
    func decrypt(
        ciphertext: String,
        privateKey: P256.KeyAgreement.PrivateKey,
        myDeviceId: String
    ) throws -> String {
        if ciphertext.hasPrefix("v3:") {
            return try decryptV3(ciphertext: ciphertext, privateKey: privateKey, myDeviceId: myDeviceId)
        }
        if ciphertext.hasPrefix("v2:") {
            return try decryptV2(ciphertext: ciphertext, privateKey: privateKey)
        }
        // Pre-encryption plaintext; return unchanged.
        return ciphertext
    }

    // MARK: - Private helpers

    private func encryptForKey(plaintext: String, recipientPublicKeyB64: String) throws -> String {
        guard let recipientDER = Data(base64Encoded: recipientPublicKeyB64) else {
            throw E2EEError.base64Decode
        }
        let recipientPub = try P256.KeyAgreement.PublicKey(derRepresentation: recipientDER)

        let ephemeral = P256.KeyAgreement.PrivateKey()
        let ephPubB64 = ephemeral.publicKey.derRepresentation.base64EncodedString()

        let aesKey = try deriveAesKey(myPrivate: ephemeral, theirPublic: recipientPub)
        let iv = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(Data(plaintext.utf8), using: aesKey, nonce: iv)

        // Append tag to ciphertext to match WebCrypto's AES-GCM output layout,
        // which concatenates them. WebCrypto appends tag; CryptoKit separates them.
        let combined = sealed.ciphertext + sealed.tag
        let ivB64 = Data(iv).base64EncodedString()
        let ctB64 = combined.base64EncodedString()

        return "v2:\(ephPubB64):\(ivB64):\(ctB64)"
    }

    private func decryptV3(
        ciphertext: String,
        privateKey: P256.KeyAgreement.PrivateKey,
        myDeviceId: String
    ) throws -> String {
        let b64Part = String(ciphertext.dropFirst(3))
        guard let jsonData = Data(base64Encoded: b64Part) else { throw E2EEError.base64Decode }
        guard let copies = try? JSONSerialization.jsonObject(with: jsonData) as? [[String: String]]
        else { throw E2EEError.malformedCiphertext }

        // Find the copy encrypted for this device.
        guard let myCopy = copies.first(where: { $0["d"] == myDeviceId }),
              let v2Body = myCopy["b"]
        else { throw E2EEError.noDeviceCopy }

        return try decryptV2(ciphertext: v2Body, privateKey: privateKey)
    }

    private func decryptV2(
        ciphertext: String,
        privateKey: P256.KeyAgreement.PrivateKey
    ) throws -> String {
        // Format: v2:<ephPubB64>:<ivB64>:<ctB64>
        // Base64 never contains ':', so splitting on ':' yields exactly 4 parts.
        let parts = ciphertext.components(separatedBy: ":")
        guard parts.count == 4 else { throw E2EEError.malformedCiphertext }

        guard
            let ephDER = Data(base64Encoded: parts[1]),
            let ivData = Data(base64Encoded: parts[2]),
            let combined = Data(base64Encoded: parts[3])
        else { throw E2EEError.base64Decode }

        let ephPub = try P256.KeyAgreement.PublicKey(derRepresentation: ephDER)
        let aesKey = try deriveAesKey(myPrivate: privateKey, theirPublic: ephPub)

        // WebCrypto appends the 16-byte GCM tag to the ciphertext; split them.
        let tagLength = 16
        guard combined.count > tagLength else { throw E2EEError.malformedCiphertext }
        let ct = combined.prefix(combined.count - tagLength)
        let tag = combined.suffix(tagLength)

        let nonce = try AES.GCM.Nonce(data: ivData)
        let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ct, tag: tag)
        let plaintext = try AES.GCM.open(box, using: aesKey)

        return String(decoding: plaintext, as: UTF8.self)
    }

    private func deriveAesKey(
        myPrivate: P256.KeyAgreement.PrivateKey,
        theirPublic: P256.KeyAgreement.PublicKey
    ) throws -> SymmetricKey {
        let shared = try myPrivate.sharedSecretFromKeyAgreement(with: theirPublic)
        // HKDF-SHA256 with an empty salt and a domain-specific info string so
        // the derived key is scoped to Counter DMs and can't be reused elsewhere.
        return shared.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(),
            sharedInfo: hkdfInfo,
            outputByteCount: 32
        )
    }

    private func storePrivateKey(_ key: P256.KeyAgreement.PrivateKey) throws {
        let data = key.rawRepresentation
        // Delete-then-add is more reliable than SecItemUpdate for this use case.
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        guard status == errSecSuccess else { throw E2EEError.keychainStore(status) }
    }

    private func loadPrivateKey() throws -> P256.KeyAgreement.PrivateKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: keychainAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw E2EEError.keychainLoad(status)
        }
        return try P256.KeyAgreement.PrivateKey(rawRepresentation: data)
    }
}

/**
 Passkey (WebAuthn) ceremonies on iOS.

 Wraps ASAuthorizationController so the rest of the app can run a registration or
 assertion with a single async call. The server (via @simplewebauthn) speaks the
 WebAuthn JSON shapes, so this file also holds the small Codable models that map
 between Apple's `Data` blobs and the base64url JSON the API expects.

 The relying-party identifier must match the web origin's domain and the app's
 `webcredentials:` associated domain entitlement, otherwise the system refuses
 the ceremony. It is the same value as the API's WEBAUTHN_RP_ID.
 */

import Foundation
import AuthenticationServices

// MARK: - Configuration

enum PasskeyConfig {
    /// The relying-party identifier (registrable domain). Overridable in debug
    /// builds so a dev pointing at a tunnelled domain can test on-device without
    /// a rebuild. Must match the `webcredentials:` associated domain.
    static var relyingPartyIdentifier: String {
        #if DEBUG
        if let override = ProcessInfo.processInfo.environment["DEBUG_RP_ID"], !override.isEmpty {
            return override
        }
        #endif
        return "counter.ltd"
    }
}

// MARK: - Option models (decoded from the API)

/// Registration options from POST /auth/passkeys/register/options. Only the
/// fields the platform provider needs are decoded; the rest of the WebAuthn
/// options object is irrelevant to ASAuthorization and ignored.
struct PasskeyRegistrationOptions: Decodable, Sendable {
    let challenge: String          // base64url
    let user: UserEntity

    struct UserEntity: Decodable, Sendable {
        let id: String             // base64url
        let name: String
    }
}

/// Authentication options from POST /auth/passkeys/authenticate/options.
struct PasskeyAuthenticationOptions: Decodable, Sendable {
    let challenge: String          // base64url
}

// MARK: - Response models (encoded back to the API)

/// The RegistrationResponseJSON the server verifies. Mirrors what
/// @simplewebauthn/browser produces; all blobs are base64url.
struct PasskeyRegistrationResponseJSON: Encodable, Sendable {
    let id: String
    let rawId: String
    let type = "public-key"
    let response: Response
    let clientExtensionResults = ClientExtensionResults()

    struct Response: Encodable, Sendable {
        let attestationObject: String
        let clientDataJSON: String
    }
}

/// The AuthenticationResponseJSON the server verifies.
struct PasskeyAuthenticationResponseJSON: Encodable, Sendable {
    let id: String
    let rawId: String
    let type = "public-key"
    let response: Response
    let clientExtensionResults = ClientExtensionResults()

    struct Response: Encodable, Sendable {
        let authenticatorData: String
        let clientDataJSON: String
        let signature: String
        let userHandle: String?
    }
}

/// Empty extension results object; WebAuthn requires the key to be present.
struct ClientExtensionResults: Encodable, Sendable {}

/// Body for POST /auth/passkeys/register/verify. The nickname key is omitted
/// when empty: the server schema accepts it as optional-or-absent, and a null
/// would fail validation.
struct PasskeyRegisterVerifyBody: Encodable, Sendable {
    let response: PasskeyRegistrationResponseJSON
    let nickname: String?

    enum CodingKeys: String, CodingKey { case response, nickname }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(response, forKey: .response)
        if let nickname, !nickname.isEmpty { try c.encode(nickname, forKey: .nickname) }
    }
}

/// Body for POST /auth/passkeys/authenticate/verify.
struct PasskeyAuthVerifyBody: Encodable, Sendable {
    let response: PasskeyAuthenticationResponseJSON
}

/// A registered passkey as listed by GET /auth/passkeys.
struct PasskeySummary: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let nickname: String?
    let createdAt: String
    let lastUsedAt: String?
    let deviceType: String?
}

// MARK: - Manager

/// Drives a single WebAuthn ceremony and bridges the delegate callbacks into an
/// async result. One instance is created per ceremony and retained by the caller
/// for its duration (ASAuthorizationController holds only weak references).
final class PasskeyManager: NSObject {

    private var continuation: CheckedContinuation<ASAuthorization, Error>?

    /// Register a new passkey for the signed-in user.
    func register(options: PasskeyRegistrationOptions) async throws -> PasskeyRegistrationResponseJSON {
        guard
            let challenge = Data(base64URLEncoded: options.challenge),
            let userID = Data(base64URLEncoded: options.user.id)
        else { throw PasskeyError.malformedOptions }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: PasskeyConfig.relyingPartyIdentifier,
        )
        let request = provider.createCredentialRegistrationRequest(
            challenge: challenge,
            name: options.user.name,
            userID: userID,
        )

        let authorization = try await perform(request)
        guard
            let cred = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
            let attestation = cred.rawAttestationObject
        else { throw PasskeyError.unexpectedCredential }

        let id = cred.credentialID.base64URLEncodedString()
        return PasskeyRegistrationResponseJSON(
            id: id,
            rawId: id,
            response: .init(
                attestationObject: attestation.base64URLEncodedString(),
                clientDataJSON: cred.rawClientDataJSON.base64URLEncodedString(),
            ),
        )
    }

    /// Sign in with an existing passkey. `allowCredentials` is empty on the
    /// server side, so the system offers any passkey enrolled for this RP.
    func authenticate(options: PasskeyAuthenticationOptions) async throws -> PasskeyAuthenticationResponseJSON {
        guard let challenge = Data(base64URLEncoded: options.challenge) else {
            throw PasskeyError.malformedOptions
        }

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
            relyingPartyIdentifier: PasskeyConfig.relyingPartyIdentifier,
        )
        let request = provider.createCredentialAssertionRequest(challenge: challenge)

        let authorization = try await perform(request)
        guard let cred = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            throw PasskeyError.unexpectedCredential
        }

        let id = cred.credentialID.base64URLEncodedString()
        return PasskeyAuthenticationResponseJSON(
            id: id,
            rawId: id,
            response: .init(
                authenticatorData: cred.rawAuthenticatorData.base64URLEncodedString(),
                clientDataJSON: cred.rawClientDataJSON.base64URLEncodedString(),
                signature: cred.signature.base64URLEncodedString(),
                // userHandle is our Counter user id bytes; the server resolves the
                // account from the credential, so it's informational here.
                userHandle: cred.userID.base64URLEncodedString(),
            ),
        )
    }

    // MARK: - Controller bridge

    private func perform(_ request: ASAuthorizationRequest) async throws -> ASAuthorization {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }
}

extension PasskeyManager: ASAuthorizationControllerDelegate {
    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization authorization: ASAuthorization,
    ) {
        continuation?.resume(returning: authorization)
        continuation = nil
    }

    func authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithError error: Error,
    ) {
        continuation?.resume(throwing: error)
        continuation = nil
    }
}

extension PasskeyManager: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? UIWindow()
    }
}

// MARK: - Errors

enum PasskeyError: LocalizedError {
    case malformedOptions
    case unexpectedCredential
    /// True when the user simply cancelled the system sheet, so callers can stay
    /// silent instead of flashing an error.
    static func isCancellation(_ error: Error) -> Bool {
        (error as? ASAuthorizationError)?.code == .canceled
    }

    var errorDescription: String? {
        switch self {
        case .malformedOptions: return "The server sent an invalid passkey challenge."
        case .unexpectedCredential: return "The passkey response was not in the expected form."
        }
    }
}

// MARK: - base64url

extension Data {
    /// base64url (RFC 4648 §5): standard base64 with +/ swapped for -_ and no
    /// padding. WebAuthn JSON uses this everywhere, and it is NOT interchangeable
    /// with plain base64.
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Decode a base64url string, restoring the +/ alphabet and padding first.
    init?(base64URLEncoded input: String) {
        var s = input
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        // Re-pad to a multiple of 4, which base64 decoding requires.
        let remainder = s.count % 4
        if remainder > 0 { s += String(repeating: "=", count: 4 - remainder) }
        self.init(base64Encoded: s)
    }
}

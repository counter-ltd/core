/**
 Concrete WebRTC peer for Tunnel Talk, backed by the Google WebRTC SDK.

 Implements `TunnelWebRTCPeer`: sets up an `RTCPeerConnection` with a single
 reliable, ordered `RTCDataChannel` labelled "tunnel". All message content
 flows over that data channel directly between the two devices and never
 reaches Counter's servers.

 Signaling (SDP offer/answer and ICE candidates) is emitted as JSON via the
 `onSignal` callback in the exact wire format the web client and the signaling
 Durable Object expect (`@counter/types` SignalingMessage), so an iOS peer and
 a web peer can connect to each other.

 Messages are E2EE with the same P-256 ECDH + AES-256-GCM scheme as regular
 DMs (via `E2EEService`), so the ciphertext format matches and saved
 transcripts decrypt with the existing code paths.
 */

import Foundation
import CryptoKit
import WebRTC

final class WebRTCPeer: NSObject, TunnelWebRTCPeer {

    // MARK: - TunnelWebRTCPeer callbacks

    var onSignal: ((Data) -> Void)?
    var onConnected: (() -> Void)?
    var onDisconnected: (() -> Void)?
    var onMessage: ((TunnelChatMessage) -> Void)?
    var onConsent: ((Bool) -> Void)?
    var onEnd: (() -> Void)?

    private(set) var sentBuffer: [TranscriptEntry] = []

    // MARK: - WebRTC state

    // One shared factory for the whole app. RTCInitializeSSL must run once
    // before any factory is created.
    private static let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        return RTCPeerConnectionFactory()
    }()

    private let connection: RTCPeerConnection
    private var dataChannel: RTCDataChannel?

    // MARK: - Encryption material

    private let partnerDeviceKeys: [DeviceKeyEntry]
    private let myDeviceKeys: [DeviceKeyEntry]
    private let privateKey: P256.KeyAgreement.PrivateKey?
    private let deviceId: String?

    private let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    // MARK: - Init

    init(iceServers: [RTCIceServer], partnerDeviceKeys: [DeviceKeyEntry], myDeviceKeys: [DeviceKeyEntry]) {
        self.partnerDeviceKeys = partnerDeviceKeys
        self.myDeviceKeys = myDeviceKeys

        // Load the same Keychain key pair the conversation uses, so transcript
        // messages encrypt and decrypt with the existing E2EE paths.
        if let loaded = try? E2EEService.shared.loadOrGenerateKeyPair() {
            self.privateKey = loaded.privateKey
            self.deviceId = loaded.deviceId
        } else {
            self.privateKey = nil
            self.deviceId = nil
        }

        let config = RTCConfiguration()
        config.iceServers = iceServers
        config.sdpSemantics = .unifiedPlan
        // Keep gathering candidates after the initial batch so trickle ICE can
        // recover a connection that the first set of candidates couldn't make.
        config.continualGatheringPolicy = .gatherContinually

        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        guard let pc = WebRTCPeer.factory.peerConnection(with: config, constraints: constraints, delegate: nil) else {
            fatalError("Failed to create RTCPeerConnection")
        }
        self.connection = pc
        super.init()
        self.connection.delegate = self
    }

    // MARK: - Offer / answer (initiator)

    func createOffer() async throws {
        // The initiator creates the data channel; the participant receives it
        // via the didOpen delegate callback.
        dataChannel = makeDataChannel()

        let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let offer = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<RTCSessionDescription, Error>) in
            connection.offer(for: constraints) { sdp, error in
                if let sdp { cont.resume(returning: sdp) }
                else { cont.resume(throwing: error ?? PeerError.sdpFailed) }
            }
        }
        try await setLocal(offer)
        emit(["type": "offer", "sdp": offer.sdp])
    }

    // MARK: - Incoming signal handling

    func receiveSignal(_ data: Data) async throws {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }

        switch type {
        case "offer":
            guard let sdp = obj["sdp"] as? String else { return }
            try await setRemote(RTCSessionDescription(type: .offer, sdp: sdp))
            // Answer the offer and send it back through signaling.
            let constraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
            let answer = try await withCheckedThrowingContinuation { (cont: CheckedContinuation<RTCSessionDescription, Error>) in
                connection.answer(for: constraints) { sdp, error in
                    if let sdp { cont.resume(returning: sdp) }
                    else { cont.resume(throwing: error ?? PeerError.sdpFailed) }
                }
            }
            try await setLocal(answer)
            emit(["type": "answer", "sdp": answer.sdp])

        case "answer":
            guard let sdp = obj["sdp"] as? String else { return }
            try await setRemote(RTCSessionDescription(type: .answer, sdp: sdp))

        case "ice":
            guard let cand = obj["candidate"] as? [String: Any],
                  let candidateStr = cand["candidate"] as? String else { return }
            let sdpMid = cand["sdpMid"] as? String
            let sdpMLineIndex = (cand["sdpMLineIndex"] as? NSNumber)?.int32Value ?? 0
            let candidate = RTCIceCandidate(sdp: candidateStr, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)
            try await addIce(candidate)

        default:
            break
        }
    }

    // MARK: - Data channel send

    func sendMessage(_ plaintext: String, tempId: String, bufferForTranscript: Bool) async throws {
        let ciphertext = try encrypt(plaintext)
        sendRaw(["type": "message", "body": ciphertext, "tempId": tempId])
        if bufferForTranscript {
            // Buffer the ciphertext (not plaintext) so the uploaded transcript
            // is the same E2EE format as regular DMs.
            sentBuffer.append(TranscriptEntry(body: ciphertext, sentAt: isoFormatter.string(from: Date())))
        }
    }

    func sendConsent(_ value: Bool) {
        sendRaw(["type": "consent", "value": value])
    }

    func end() {
        sendRaw(["type": "end"])
        dataChannel?.close()
        connection.close()
    }

    // MARK: - Private: WebRTC bridging

    private func makeDataChannel() -> RTCDataChannel? {
        let config = RTCDataChannelConfiguration()
        config.isOrdered = true
        let channel = connection.dataChannel(forLabel: "tunnel", configuration: config)
        channel?.delegate = self
        return channel
    }

    private func setLocal(_ sdp: RTCSessionDescription) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            connection.setLocalDescription(sdp) { error in
                if let error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
    }

    private func setRemote(_ sdp: RTCSessionDescription) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            connection.setRemoteDescription(sdp) { error in
                if let error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
    }

    private func addIce(_ candidate: RTCIceCandidate) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            connection.add(candidate) { error in
                if let error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
    }

    private func sendRaw(_ object: [String: Any]) {
        guard let channel = dataChannel, channel.readyState == .open,
              let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        channel.sendData(RTCDataBuffer(data: data, isBinary: false))
    }

    private func emit(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        onSignal?(data)
    }

    // MARK: - Private: encryption

    private func encrypt(_ plaintext: String) throws -> String {
        try E2EEService.shared.encryptForDevices(
            plaintext: plaintext,
            recipientKeys: partnerDeviceKeys,
            senderKeys: myDeviceKeys
        )
    }

    private func decrypt(_ ciphertext: String) -> String {
        guard let privateKey, let deviceId else { return ciphertext }
        return (try? E2EEService.shared.decrypt(
            ciphertext: ciphertext,
            privateKey: privateKey,
            myDeviceId: deviceId
        )) ?? "[Could not decrypt message]"
    }

    // MARK: - Private: incoming data channel messages

    private func handleIncoming(_ data: Data) {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }

        switch type {
        case "message":
            guard let body = obj["body"] as? String, let tempId = obj["tempId"] as? String else { return }
            // Received messages are NOT buffered here: each peer uploads only the
            // messages it sent, so the union of both uploads is the full
            // transcript with no duplicates. The other peer buffers this one.
            let plain = decrypt(body)
            main { self.onMessage?(TunnelChatMessage(id: tempId, body: plain, mine: false, sentAt: Date())) }
            // Acknowledge delivery so the sender could show a tick.
            sendRaw(["type": "delivered", "tempId": tempId])

        case "consent":
            let value = obj["value"] as? Bool ?? false
            main { self.onConsent?(value) }

        case "end":
            main { self.onEnd?() }

        default:
            // 'delivered' acks are not surfaced in this version.
            break
        }
    }

    // Hop to the main thread: WebRTC delegate callbacks arrive on its own
    // signaling thread, but the view model state they touch drives SwiftUI.
    private func main(_ block: @escaping () -> Void) {
        DispatchQueue.main.async(execute: block)
    }

    enum PeerError: Error { case sdpFailed }
}

// MARK: - RTCPeerConnectionDelegate

extension WebRTCPeer: RTCPeerConnectionDelegate {

    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        // Emit the candidate in the canonical RTCIceCandidateInit shape so a web
        // peer (which expects { candidate, sdpMid, sdpMLineIndex }) can add it.
        var cand: [String: Any] = ["candidate": candidate.sdp, "sdpMLineIndex": candidate.sdpMLineIndex]
        if let mid = candidate.sdpMid { cand["sdpMid"] = mid }
        emit(["type": "ice", "candidate": cand])
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {
        // Participant side: the data channel is created by the initiator and
        // surfaced here.
        self.dataChannel = dataChannel
        dataChannel.delegate = self
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {
        switch newState {
        case .disconnected, .failed, .closed:
            main { self.onDisconnected?() }
        default:
            break
        }
    }

    // Remaining delegate methods are required by the protocol but unused here.
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
}

// MARK: - RTCDataChannelDelegate

extension WebRTCPeer: RTCDataChannelDelegate {

    func dataChannelDidChangeState(_ dataChannel: RTCDataChannel) {
        switch dataChannel.readyState {
        case .open:
            main { self.onConnected?() }
        case .closed:
            main { self.onDisconnected?() }
        default:
            break
        }
    }

    func dataChannel(_ dataChannel: RTCDataChannel, didReceiveMessageWith buffer: RTCDataBuffer) {
        handleIncoming(buffer.data)
    }
}

/**
 Models for the public feed-ranking algorithm transparency endpoints.

 The web publishes the live algorithm config at GET /algorithm and every change
 to it at GET /algorithm/changelog. These types mirror the TypeScript shapes in
 @counter/types so both clients decode the same wire format.
 */

import Foundation

// MARK: - Live config

/// The current state of the feed-ranking algorithm.
struct AlgorithmState: Decodable, Sendable {
    /// Semver string that bumps with every tuning change.
    let version: String
    /// Human-readable description of the ranking strategy.
    let description: String
    /// Engagement signal weights, keyed by signal name.
    let weights: [String: Double]
    /// Tuning parameters — numbers and booleans. See AlgorithmParamValue.
    let parameters: [String: AlgorithmParamValue]
}

/// A parameter value in the algorithm config. Can be a number or a boolean.
///
/// JSON doesn't carry type annotations, so this enum tries Bool first (true/false
/// literals) then falls back to Double. That order avoids misreading 1/0 as
/// booleans, which don't appear in practice.
enum AlgorithmParamValue: Decodable, Sendable {
    case number(Double)
    case bool(Bool)

    /// Display string for the value, shown in the settings UI.
    var displayString: String {
        switch self {
        case .number(let v):
            // Show whole numbers without a decimal point.
            return v.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(v))" : "\(v)"
        case .bool(let v):
            return v ? "true" : "false"
        }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? c.decode(Double.self) {
            self = .number(n)
        } else {
            throw DecodingError.typeMismatch(
                AlgorithmParamValue.self,
                .init(codingPath: decoder.codingPath, debugDescription: "Expected number or bool")
            )
        }
    }
}

// MARK: - Changelog

/// One entry in the public history of changes to the feed-ranking algorithm.
struct AlgorithmChangelogEntry: Decodable, Identifiable, Sendable {
    let id: String
    let version: String
    let summary: String
    /// Longer write-up. Nil when the summary says it all.
    let detail: String?
    /// Username of whoever deployed the change.
    let changedBy: String
    /// Git commit hash that introduced the change.
    let commitHash: String
    let deployedAt: Date
}

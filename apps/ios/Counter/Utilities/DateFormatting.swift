/**
 Date formatting utilities used across the app.

 `timeAgo` mirrors the logic in `apps/web/src/lib/format.ts` so timestamps
 read the same way on iOS as on the web. Relative formatting up to 7 days,
 then a short absolute date.
 */

import Foundation

// MARK: - Relative time

/// Formats an ISO 8601 date string as a human-readable relative time.
/// Returns strings like "3m", "2h", "5d", or "Mar 4".
func timeAgo(from isoString: String) -> String {
    guard let date = parseISO(isoString) else { return "" }
    return timeAgo(from: date)
}

/// Formats a `Date` as a human-readable relative time.
func timeAgo(from date: Date) -> String {
    let now = Date()
    let seconds = Int(now.timeIntervalSince(date))

    if seconds < 60 { return "now" }

    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes)m" }

    let hours = minutes / 60
    if hours < 24 { return "\(hours)h" }

    let days = hours / 24
    // Switch to absolute date after a week, same threshold as the web client.
    if days < 7 { return "\(days)d" }

    return shortDate(date)
}

// MARK: - Compact numbers

/// Formats a count with SI suffixes: 1200 -> "1.2k", 1500000 -> "1.5M".
func compact(_ n: Int) -> String {
    switch n {
    case ..<1000:
        return "\(n)"
    case ..<1_000_000:
        let k = Double(n) / 1000
        return k.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(k))k"
            : String(format: "%.1fk", k)
    default:
        let m = Double(n) / 1_000_000
        return m.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(m))M"
            : String(format: "%.1fM", m)
    }
}

// MARK: - Helpers

private let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    // The API returns fractional seconds ("2024-01-15T12:00:00.000Z").
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

private let isoFormatterNoFractional: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

/// Parses an ISO 8601 string, tolerating both with and without fractional seconds.
func parseISO(_ string: String) -> Date? {
    isoFormatter.date(from: string) ?? isoFormatterNoFractional.date(from: string)
}

private let shortDateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "MMM d"
    return f
}()

private func shortDate(_ date: Date) -> String {
    shortDateFormatter.string(from: date)
}

/**
 Post body text processing: linkify @mentions and #hashtags into tappable spans.

 Produces an `AttributedString` with `.link` attributes on mentions and tags.
 The scheme is synthetic ("counter://profile/username" etc.) so the app can
 intercept taps via `openURL` environment and push the right destination.
 */

import Foundation

// MARK: - Linkification

/// Converts a plain post body into an `AttributedString` with tappable
/// @mention and #hashtag spans.
func linkify(_ body: String) -> AttributedString {
    var result = AttributedString(body)

    applyPattern(
        #"@([a-z0-9_]{2,30})"#,
        in: body,
        to: &result,
        urlScheme: { "counter://profile/\($0)" }
    )

    applyPattern(
        #"#([a-zA-Z0-9_]+)"#,
        in: body,
        to: &result,
        urlScheme: { "counter://tag/\($0)" }
    )

    return result
}

// MARK: - Helpers

private func applyPattern(
    _ pattern: String,
    in body: String,
    to attributed: inout AttributedString,
    urlScheme: (String) -> String
) {
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
    let nsBody = body as NSString
    let fullRange = NSRange(location: 0, length: nsBody.length)

    for match in regex.matches(in: body, range: fullRange).reversed() {
        // Group 1 is the capture without the sigil.
        let captureRange = match.range(at: 1)
        let fullMatchRange = match.range(at: 0)

        guard
            captureRange.location != NSNotFound,
            let swiftRange = Range(fullMatchRange, in: body),
            let attrRange = Range(swiftRange, in: attributed),
            let url = URL(string: urlScheme(nsBody.substring(with: captureRange)))
        else { continue }

        // Reversed iteration means earlier ranges stay valid as we insert.
        // Setting only .link; SwiftUI's Text renders linked runs in the tint colour,
        // which is CounterAccent set on the root window. No extra colour attribute needed.
        attributed[attrRange].link = url
    }
}

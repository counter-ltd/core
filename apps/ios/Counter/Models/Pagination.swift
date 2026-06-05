/**
 Pagination shapes used across every list endpoint.

 The API uses keyset pagination: every paginated response includes a `nextCursor`
 which is the ID of the last item returned. Pass it as `after` on the next call.
 A null cursor means you've reached the end of the list.
 */

// MARK: - Response shape

/// A single page of results from any cursor-paginated endpoint.
struct Page<T: Decodable & Sendable>: Decodable, Sendable {
    let data: [T]
    /// Nil when there are no more pages.
    let nextCursor: String?
}

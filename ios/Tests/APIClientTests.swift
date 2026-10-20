import Foundation

// Standalone Foundation regression checks; deliberately outside both Xcode targets.
// Run with swiftc -parse-as-library Shared/{APIClient,Models,BuildConfig}.swift
// Tests/APIClientTests.swift -o /tmp/bridge-api-tests && /tmp/bridge-api-tests

private struct CheckFailure: Error, CustomStringConvertible, LocalizedError {
    let description: String
    var errorDescription: String? { description }
}

private func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw CheckFailure(description: message) }
}

private final class RequestProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var handler: ((URLRequest) throws -> Data)?

    static func respond(using handler: @escaping (URLRequest) throws -> Data) {
        lock.lock()
        defer { lock.unlock() }
        self.handler = handler
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        let handler = Self.handler
        Self.lock.unlock()
        do {
            guard let handler else { throw CheckFailure(description: "No request handler") }
            let data = try handler(request)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: 200, httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            print("REQUEST CHECK FAILED: \(error)")
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

@main
private enum APIClientTests {
    private static let statusJSON = """
    {"pk":"BRICKELL","status":"UP","statusChangedAt":"2026-10-13T03:51:59.518Z",
     "lastPolledAt":"2026-10-13T03:56:59.411Z","metadata":{"roadway":"US-1","lat":25.770124,"lon":-80.190208},
     "nearbyAlerts":[],"feedLastUpdatedAt":"2026-10-13T03:51:00.000Z","rawSnapshotPointer":null}
    """
    private static let historyJSON = """
    {"events":[{"ts":"2026-10-13T03:51:59.518Z","from":"DOWN","to":"UP","durationOfPrevStateSec":1080}]}
    """
    private static let statsJSON = """
    {"windowDays":7,"opens":151,"avgOpenDurationSec":554,"longestOpenDurationSec":1500,
     "currentStatus":"UP","currentStatusSinceSec":327,"predictedNextOpenAt":null,
     "predictedNextCloseAt":"2026-10-13T04:01:13.518Z","isOpen":true,"tz":"America/New_York","breakdown":{}}
    """

    private static func client(
        path: String, query: [String: String], response: String,
        baseURL: String = "https://bridge.test"
    ) -> APIClient {
        RequestProtocol.respond { request in
            let url = try requireURL(request)
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
            let items = components.queryItems ?? []
            let actual = Dictionary(items.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, rhs in rhs })
            try check(request.httpMethod == "GET", "Expected GET")
            try check(url.path == path, "Expected path \(path), got \(url.path)")
            try check(actual == query && items.count == query.count,
                      "Expected query \(query), got \(actual); URL=\(url.absoluteString)")
            return Data(response.utf8)
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RequestProtocol.self]
        return APIClient(baseURL: URL(string: baseURL)!, session: URLSession(configuration: config))
    }

    private static func requireURL(_ request: URLRequest) throws -> URL {
        guard let url = request.url else { throw CheckFailure(description: "Missing URL") }
        return url
    }

    static func main() async {
        let tests: [(String, () async throws -> Void)] = [
            ("status request and payload decoding", {
                let api = client(path: "/api/bridges/brickell", query: [:], response: statusJSON)
                let state = try await api.getStatus()
                try check(state.status == .up && state.pk == "BRICKELL", "Status payload was not decoded")
            }),
            ("stats preserves days query and decodes payload", {
                let api = client(path: "/api/bridges/brickell/stats", query: ["days": "7"], response: statsJSON)
                let stats = try await api.getStats(days: 7)
                try check(stats.windowDays == 7 && stats.opens == 151 && stats.predictedNextCloseAt != nil,
                          "Stats payload was not decoded")
            }),
            ("history preserves days and flap filter and decodes payload", {
                let api = client(path: "/api/bridges/brickell/history",
                                 query: ["days": "7", "minDurationSec": "60"], response: historyJSON)
                let events = try await api.getHistory(days: 7, minDurationSec: 60)
                try check(events.count == 1 && events[0].from == .down && events[0].durationOfPrevStateSec == 1080,
                          "History payload was not decoded")
            }),
            ("custom history filters preserve base URL path", {
                let api = client(path: "/proxy/api/bridges/brickell/history",
                                 query: ["days": "1", "minDurationSec": "3600"],
                                 response: historyJSON, baseURL: "https://bridge.test/proxy")
                _ = try await api.getHistory(days: 1, minDurationSec: 3600)
            }),
            ("custom stats window is sent", {
                let api = client(path: "/api/bridges/brickell/stats", query: ["days": "1"], response: statsJSON)
                _ = try await api.getStats(days: 1)
            }),
        ]
        var failures = 0
        for (name, test) in tests {
            do {
                try await test()
                print("PASS: \(name)")
            } catch {
                failures += 1
                print("FAIL: \(name): \(error)")
            }
        }
        print("\(tests.count - failures)/\(tests.count) APIClient checks passed")
        if failures > 0 { exit(EXIT_FAILURE) }
    }
}

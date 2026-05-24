import Foundation

public struct HistoryResponse: Codable, Sendable { public let events: [BridgeEvent] }
public struct DeviceRegistrationRequest: Codable, Sendable {
    public let deviceId: String
    public let apnsToken: String?
    public let bundleId: String
    public let appVersion: String
}
public struct ActivityRegistrationRequest: Codable, Sendable {
    public let activityId: String
    public let activityPushToken: String
}

public enum APIError: Error, LocalizedError {
    case badResponse(Int)
    case decodingFailed(Error)
    case transport(Error)

    public var errorDescription: String? {
        switch self {
        case .badResponse(let code): return "Server returned HTTP \(code)"
        case .decodingFailed(let e): return "Decoding failed: \(e.localizedDescription)"
        case .transport(let e): return e.localizedDescription
        }
    }
}

public actor APIClient {
    public static let shared = APIClient()

    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(baseURL: URL? = nil, session: URLSession = .shared) {
        self.baseURL = baseURL ?? APIClient.resolveBaseURL()
        self.session = session

        let dec = JSONDecoder()
        dec.dateDecodingStrategy = .iso8601
        self.decoder = dec

        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .iso8601
        self.encoder = enc
    }

    private static func resolveBaseURL() -> URL {
        URL(string: BuildConfig.apiBaseURL)!
    }

    public func getStatus() async throws -> BridgeState {
        try await get("/api/bridges/brickell")
    }

    public func getHistory(days: Int = 7) async throws -> [BridgeEvent] {
        let resp: HistoryResponse = try await get("/api/bridges/brickell/history?days=\(days)")
        return resp.events
    }

    public func getStats(days: Int = 7) async throws -> BridgeStats {
        try await get("/api/bridges/brickell/stats?days=\(days)")
    }

    public func registerDevice(_ req: DeviceRegistrationRequest) async throws {
        _ = try await post("/api/devices", body: req) as EmptyResponse
    }

    public func registerActivity(deviceId: String, _ req: ActivityRegistrationRequest) async throws {
        _ = try await post("/api/devices/\(deviceId)/activity", body: req) as EmptyResponse
    }

    public func endActivity(deviceId: String, activityId: String) async throws {
        _ = try await delete("/api/devices/\(deviceId)/activity/\(activityId)") as EmptyResponse
    }

    private struct EmptyResponse: Codable {}

    private func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(path, method: "GET", body: Optional<EmptyResponse>.none)
    }
    private func post<Body: Encodable, T: Decodable>(_ path: String, body: Body) async throws -> T {
        try await request(path, method: "POST", body: body)
    }
    private func delete<T: Decodable>(_ path: String) async throws -> T {
        try await request(path, method: "DELETE", body: Optional<EmptyResponse>.none)
    }

    private func request<Body: Encodable, T: Decodable>(
        _ path: String, method: String, body: Body?
    ) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body = body {
            req.httpBody = try encoder.encode(body)
        }
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.badResponse((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
        if T.self == EmptyResponse.self { return EmptyResponse() as! T }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decodingFailed(error)
        }
    }
}

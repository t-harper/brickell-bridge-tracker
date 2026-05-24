import Foundation

public enum BridgeStatus: String, Codable, Sendable, Hashable {
    case up = "UP"
    case down = "DOWN"
    case unknown = "UNKNOWN"

    public var label: String {
        switch self {
        case .up: return "Up"
        case .down: return "Down"
        case .unknown: return "Unknown"
        }
    }

    public var symbolName: String {
        switch self {
        case .up: return "arrow.up.circle.fill"
        case .down: return "arrow.down.circle.fill"
        case .unknown: return "questionmark.circle.fill"
        }
    }

    public var isTrafficStopped: Bool { self == .up }
}

public struct BridgeMetadata: Codable, Sendable, Hashable {
    public let roadway: String?
    public let location: String?
    public let direction: String?
    public let county: String?
    public let waterway: String?
    public let lat: Double?
    public let lon: Double?

    public init(
        roadway: String? = nil, location: String? = nil, direction: String? = nil,
        county: String? = nil, waterway: String? = nil, lat: Double? = nil, lon: Double? = nil
    ) {
        self.roadway = roadway; self.location = location; self.direction = direction
        self.county = county; self.waterway = waterway; self.lat = lat; self.lon = lon
    }
}

public struct NearbyAlert: Codable, Sendable, Hashable, Identifiable {
    public let id: String
    public let type: String?
    public let description: String?
    public let location: String?
    public let updatedAt: String?
}

public struct BridgeState: Codable, Sendable, Hashable {
    public let pk: String
    public let status: BridgeStatus
    public let statusChangedAt: Date
    public let lastPolledAt: Date
    public let metadata: BridgeMetadata
    public let nearbyAlerts: [NearbyAlert]

    enum CodingKeys: String, CodingKey {
        case pk, status, statusChangedAt, lastPolledAt, metadata, nearbyAlerts
    }
}

public struct BridgeEvent: Codable, Sendable, Hashable, Identifiable {
    public var id: String { ts.ISO8601Format() }
    public let ts: Date
    public let from: BridgeStatus
    public let to: BridgeStatus
    public let durationOfPrevStateSec: Int?
}

public struct BridgeStats: Codable, Sendable, Hashable {
    public let windowDays: Int
    public let opens: Int
    public let avgOpenDurationSec: Int?
    public let longestOpenDurationSec: Int?
    public let currentStatus: BridgeStatus
    public let currentStatusSinceSec: Int
    public let predictedNextOpenAt: Date?
    public let predictedNextCloseAt: Date?
}

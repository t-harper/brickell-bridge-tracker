import ActivityKit
import Foundation

public struct BridgeActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable, Sendable {
        public var status: BridgeStatus
        public var statusChangedAt: Date
        public var lastPolledAt: Date

        public init(status: BridgeStatus, statusChangedAt: Date, lastPolledAt: Date) {
            self.status = status
            self.statusChangedAt = statusChangedAt
            self.lastPolledAt = lastPolledAt
        }
    }

    public var bridgeName: String
    public var roadway: String?

    public init(bridgeName: String = "Brickell Avenue Bridge", roadway: String? = "US-1") {
        self.bridgeName = bridgeName
        self.roadway = roadway
    }
}

public extension BridgeActivityAttributes.ContentState {
    func statusDurationString(now: Date = Date()) -> String {
        let secs = Int(max(0, now.timeIntervalSince(statusChangedAt)))
        if secs < 60 { return "\(secs)s" }
        let m = secs / 60
        if m < 60 { return "\(m)m" }
        let h = m / 60
        return "\(h)h \(m % 60)m"
    }
}

import ActivityKit
import Foundation

public struct BridgeActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable, Sendable {
        public var status: BridgeStatus
        public var statusChangedAt: Date
        public var lastPolledAt: Date
        // When status is DOWN (open to traffic): predicted next opening.
        // When status is UP (traffic stopped): predicted next close.
        // Either may be nil if there's not enough history to predict.
        public var predictedNextOpenAt: Date?
        public var predictedNextCloseAt: Date?

        public init(
            status: BridgeStatus,
            statusChangedAt: Date,
            lastPolledAt: Date,
            predictedNextOpenAt: Date? = nil,
            predictedNextCloseAt: Date? = nil
        ) {
            self.status = status
            self.statusChangedAt = statusChangedAt
            self.lastPolledAt = lastPolledAt
            self.predictedNextOpenAt = predictedNextOpenAt
            self.predictedNextCloseAt = predictedNextCloseAt
        }
    }

    public var bridgeName: String
    public var roadway: String?

    public init(bridgeName: String = "Brickell Avenue Bridge", roadway: String? = "US-1") {
        self.bridgeName = bridgeName
        self.roadway = roadway
    }
}

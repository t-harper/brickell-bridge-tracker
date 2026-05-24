import Foundation

// Local dev default; CI overwrites this file before archiving for TestFlight.
enum BuildConfig {
    static let apiBaseURL = "http://localhost:3001"
}

import Foundation
import CoreGraphics
import XCTest

private struct FixtureRequest: Decodable {
    let method: String
    let path: String
    let query: [String: [String]]
}

private struct FixtureAudit: Decodable {
    let requests: [FixtureRequest]
}

private struct FixtureFailure: Error, CustomStringConvertible {
    let description: String
}

final class BridgeTrackerUITests: XCTestCase {
    private static let fixtureURL = URL(string: "http://127.0.0.1:8001")!

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func test01LaunchRefreshStatusStatsHistoryAndFilteredRequests() async throws {
        try await Self.control("reset", scenario: "down")
        let app = launchApp()
        defer { app.terminate() }
        await captureSettledScreen("baseline-down", in: app)

        await expectLabel("bridge.status", contains: "Down", in: app)
        await expectLabel("bridge.traffic", contains: "Open to traffic", in: app)
        XCTAssertTrue(app.staticTexts["US-1"].exists)
        XCTAssertTrue(app.staticTexts["Brickell Avenue"].exists)
        XCTAssertTrue(app.buttons["Open in Maps"].exists)
        reveal(element("bridge.stats-window", in: app), in: app)
        await expectLabel("bridge.stats-window", contains: "Last 7 days", in: app)
        await expectLabel("bridge.stats-openings", contains: "42", in: app)
        reveal(element("bridge.history", in: app), in: app)
        XCTAssertTrue(app.staticTexts["Up → Down"].exists)
        XCTAssertTrue(app.staticTexts["Down → Up"].exists)

        reveal(element("bridge.status", in: app), in: app, scrollingDown: true)
        try await refresh(afterSwitchingTo: "empty-history", in: app)
        let emptyHistory = app.staticTexts["No status changes recorded yet."]
        XCTAssertTrue(emptyHistory.waitForExistence(timeout: 15),
                      "Successful empty history must remain distinct from a failed history request.")
        reveal(emptyHistory, in: app)
        XCTAssertFalse(app.staticTexts["Up → Down"].exists)
        XCTAssertFalse(app.staticTexts["Down → Up"].exists)

        reveal(element("bridge.status", in: app), in: app, scrollingDown: true)
        try await refresh(afterSwitchingTo: "up", in: app)
        await expectLabel("bridge.status", contains: "Up", in: app)
        await expectLabel("bridge.traffic", contains: "Traffic stopped", in: app)
        reveal(element("bridge.stats-window", in: app), in: app)
        await expectLabel("bridge.stats-openings", contains: "43", in: app)

        let audit: FixtureAudit = try await Self.readControl("requests")
        let reads = audit.requests.filter { $0.method == "GET" }
        XCTAssertGreaterThanOrEqual(reads.filter { $0.path == "/api/bridges/brickell" }.count, 2)
        let history = reads.filter { $0.path == "/api/bridges/brickell/history" }
        XCTAssertGreaterThanOrEqual(history.count, 2)
        XCTAssertTrue(history.allSatisfy {
            $0.query == ["days": ["7"], "minDurationSec": ["60"]]
        }, "History must keep its seven-day window and flap filter in real URL query items.")
        let stats = reads.filter { $0.path == "/api/bridges/brickell/stats" }
        XCTAssertGreaterThanOrEqual(stats.count, 2)
        XCTAssertTrue(stats.allSatisfy { $0.query == ["days": ["7"]] })
        XCTAssertFalse(reads.contains { $0.path.contains("?") || $0.path.lowercased().contains("%3f") })
    }

    @MainActor
    func test02UnknownStatusDoesNotClaimTrafficIsOpen() async throws {
        try await Self.control("reset", scenario: "unknown")
        let app = launchApp()
        defer { app.terminate() }
        await captureSettledScreen("unknown-status", in: app)

        await expectLabel("bridge.status", contains: "Unknown", in: app)
        await expectLabel("bridge.traffic", contains: "Status unavailable", in: app)
        XCTAssertFalse(app.staticTexts["Open to traffic"].exists)
        XCTAssertFalse(app.staticTexts["Traffic stopped"].exists)
    }

    @MainActor
    func test03HistoryFailureKeepsCurrentStatusAndShowsWarning() async throws {
        try await Self.control("reset", scenario: "history-error")
        let app = launchApp()
        defer { app.terminate() }
        await captureSettledScreen("history-failure", in: app)

        await expectLabel("bridge.status", contains: "Down", in: app)
        await expectLabel("bridge.warning", contains: "history", in: app, caseInsensitive: true)
        reveal(element("bridge.stats-window", in: app), in: app)
        await expectLabel("bridge.stats-openings", contains: "42", in: app)
        XCTAssertFalse(app.staticTexts["No status changes recorded yet."].exists,
                       "A failed history request must not be presented as a successful empty history.")
    }

    @MainActor
    func test04StatsFailureKeepsCurrentStatusAndHistory() async throws {
        try await Self.control("reset", scenario: "stats-error")
        let app = launchApp()
        defer { app.terminate() }
        await captureSettledScreen("stats-failure", in: app)

        await expectLabel("bridge.status", contains: "Down", in: app)
        await expectLabel("bridge.warning", contains: "stats", in: app, caseInsensitive: true)
        XCTAssertFalse(element("bridge.stats-openings", in: app).exists)
        reveal(element("bridge.history", in: app), in: app)
        XCTAssertTrue(app.staticTexts["Up → Down"].exists)
        XCTAssertTrue(app.staticTexts["Down → Up"].exists)
    }

    @MainActor
    func test05RefreshFailureRetainsLastStatusAndRecovers() async throws {
        try await Self.control("reset", scenario: "all-error")
        let app = launchApp()
        defer { app.terminate() }
        await captureSettledScreen("cold-load-error", in: app)

        XCTAssertTrue(app.staticTexts["Couldn’t load"].waitForExistence(timeout: 15),
                      "A first-load HTTP failure must produce a recoverable error screen.")
        try await refresh(afterSwitchingTo: "down", in: app)
        await expectLabel("bridge.status", contains: "Down", in: app)
        try await refresh(afterSwitchingTo: "all-error", in: app)
        await expectLabel("bridge.warning", contains: "503", in: app)
        await expectLabel("bridge.status", contains: "Down", in: app)
        XCTAssertFalse(element("bridge.stats-openings", in: app).exists,
                       "Failed statistics must not keep presenting an old value as current.")
        attachScreenshot("refresh-failure-with-last-known-status", in: app)

        try await refresh(afterSwitchingTo: "up", in: app)
        await expectLabel("bridge.status", contains: "Up", in: app)
        reveal(element("bridge.stats-window", in: app), in: app)
        await expectLabel("bridge.stats-openings", contains: "43", in: app)
        let warning = element("bridge.warning", in: app)
        let cleared = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: warning)
        let result = await XCTWaiter.fulfillment(of: [cleared], timeout: 10)
        XCTAssertEqual(result, .completed, "A successful retry must clear the stale-data warning.")
    }

    @MainActor
    func test06LocalLiveActivityStartsAndStopsWhenSupported() async throws {
        try await Self.control("reset", scenario: "down")
        let app = launchApp()
        defer { app.terminate() }
        await captureSettledScreen("live-activity-initial", in: app)

        await expectLabel("bridge.status", contains: "Down", in: app)
        let toggle = element("bridge.live-activity", in: app)
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        reveal(toggle, in: app)
        toggle.tap()

        let started = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label CONTAINS %@", "Stop Live Activity"),
            object: toggle
        )
        let result = await XCTWaiter.fulfillment(of: [started], timeout: 10)
        if result != .completed {
            let alert = app.alerts["Couldn’t start Live Activity"]
            if alert.exists {
                let reason = alert.staticTexts.allElementsBoundByIndex.map { $0.label }.joined(separator: " ")
                let normalized = reason.lowercased()
                if normalized.contains("live activities are turned off")
                    || normalized.contains("unsupported target")
                    || normalized.contains("not supported on this device") {
                    throw XCTSkip("Simulator Live Activity capability unavailable: " + reason)
                }
                XCTFail("Live Activity failed for an unexpected reason: " + reason)
            } else {
                XCTFail("The Live Activity neither started nor explained why it could not start.")
            }
            return
        }

        toggle.tap()
        await expectLabel("bridge.live-activity", contains: "Track on Lock Screen", in: app)
        // The fixture receives any APNs/activity registration locally. This verifies
        // the app's local start/stop flow; it does not verify remote push delivery.
    }

    @MainActor
    private func launchApp() -> XCUIApplication {
        addUIInterruptionMonitor(withDescription: "Notification permission") { alert in
            for label in ["Don’t Allow", "Don't Allow"] {
                if alert.buttons[label].exists {
                    alert.buttons[label].tap()
                    return true
                }
            }
            return false
        }
        let app = XCUIApplication()
        // Standard OS locale arguments only; the product has no test-mode flags.
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let deny = springboard.buttons.matching(NSPredicate(
            format: "label == %@ OR label == %@", "Don’t Allow", "Don't Allow"
        )).firstMatch
        if deny.waitForExistence(timeout: 2) { deny.tap() }
        return app
    }

    @MainActor
    private func element(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    @MainActor
    private func expectLabel(
        _ identifier: String, contains text: String, in app: XCUIApplication,
        caseInsensitive: Bool = false, file: StaticString = #filePath, line: UInt = #line
    ) async {
        let predicate = NSPredicate(
            format: caseInsensitive ? "label CONTAINS[c] %@" : "label CONTAINS %@", text
        )
        let expectation = XCTNSPredicateExpectation(predicate: predicate, object: element(identifier, in: app))
        let result = await XCTWaiter.fulfillment(of: [expectation], timeout: 15)
        XCTAssertEqual(result, .completed, "Expected " + identifier + " to contain " + text, file: file, line: line)
    }

    @MainActor
    private func reveal(_ target: XCUIElement, in app: XCUIApplication, scrollingDown: Bool = false) {
        for _ in 0..<5 {
            if target.exists && target.isHittable { return }
            let scroll = app.scrollViews.firstMatch
            let start = scroll.coordinate(withNormalizedOffset: CGVector(
                dx: 0.98, dy: scrollingDown ? 0.25 : 0.80
            ))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(
                dx: 0.98, dy: scrollingDown ? 0.80 : 0.25
            ))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertTrue(target.exists && target.isHittable, "Expected the requested content to be reachable by scrolling.")
    }

    @MainActor
    private func captureSettledScreen(_ name: String, in app: XCUIApplication) async {
        let ready = app.descendants(matching: .any).matching(NSPredicate(
            format: "identifier == %@ OR label == %@", "bridge.status", "Couldn’t load"
        )).firstMatch
        let settled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"), object: ready)
        _ = await XCTWaiter.fulfillment(of: [settled], timeout: 15)
        attachScreenshot(name, in: app)
    }

    @MainActor
    private func attachScreenshot(_ name: String, in app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    private func refresh(afterSwitchingTo scenario: String, in app: XCUIApplication) async throws {
        let button = element("bridge.refresh", in: app)
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: button)
        let result = await XCTWaiter.fulfillment(of: [ready], timeout: 15)
        XCTAssertEqual(result, .completed, "The previous refresh must finish before changing fixture phase.")
        try await Self.control("scenario", scenario: scenario)
        let stillReady = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: button)
        let readyToTap = await XCTWaiter.fulfillment(of: [stillReady], timeout: 15)
        XCTAssertEqual(readyToTap, .completed)
        button.tap()
    }

    private static func control(_ action: String, scenario: String) async throws {
        _ = try await requestControl(action, method: "POST", body: ["scenario": scenario])
    }

    private static func readControl<T: Decodable>(_ action: String) async throws -> T {
        try JSONDecoder().decode(T.self, from: await requestControl(action, method: "GET"))
    }

    private static func requestControl(
        _ action: String, method: String, body: [String: String]? = nil
    ) async throws -> Data {
        var request = URLRequest(url: fixtureURL.appendingPathComponent("__control/" + action))
        request.httpMethod = method
        request.timeoutInterval = 10
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
            throw FixtureFailure(description: "Loopback fixture control request failed: " + action)
        }
        return data
    }
}

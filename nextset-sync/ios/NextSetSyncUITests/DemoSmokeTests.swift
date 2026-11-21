import XCTest

final class DemoSmokeTests: XCTestCase {
    @MainActor
    func testDemoSync() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-demoMode", "YES"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 15))

        app.tabBars.buttons["Watch"].tap()
        let sync = app.buttons["watch.syncNow"]
        XCTAssertTrue(app.navigationBars["Watch"].waitForExistence(timeout: 10))
        for _ in 0..<3 where !sync.isHittable { app.swipeUp() }
        XCTAssertTrue(sync.waitForExistence(timeout: 15))
        let enabled = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: sync)
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 15), .completed)
        sync.tap()
        let summary = app.staticTexts["watch.syncSummary"]
        for _ in 0..<2 where !summary.isHittable { app.swipeUp() }
        XCTAssertTrue(summary.waitForExistence(timeout: 30))
        XCTAssertTrue(summary.label.contains("3 new sets"))
        capture("01-watch-synced")

        app.tabBars.buttons["History"].tap()
        XCTAssertTrue(app.navigationBars["History"].waitForExistence(timeout: 10))
        let synced = app.descendants(matching: .any).matching(identifier: "history.session.inProgress.3").firstMatch
        XCTAssertTrue(synced.waitForExistence(timeout: 10))
        capture("02-history")

        app.tabBars.buttons["Today"].tap()
        let recovery = app.staticTexts["today.recovery"]
        XCTAssertTrue(recovery.waitForExistence(timeout: 10))
        capture("03-recovery")
        let moments = app.staticTexts["today.moments"]
        for _ in 0..<4 where !moments.isHittable { app.swipeUp() }
        XCTAssertTrue(moments.isHittable)
        capture("04-moments")
    }

    @MainActor
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

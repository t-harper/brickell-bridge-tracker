import SwiftUI
import WidgetKit

@main
struct BridgeWidgetBundle: WidgetBundle {
    var body: some Widget {
        BridgeStatusWidget()
        BridgeLiveActivity()
    }
}

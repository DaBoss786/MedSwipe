import SwiftUI

@main
struct MedSwipeApp: App {
    @StateObject private var container = AppContainer.makeDefault()

    init() {
        FirebaseService.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(container)
        }
    }
}

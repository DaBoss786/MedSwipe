import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var container: AppContainer

    var body: some View {
        RootView(authService: container.authService)
    }
}

#Preview {
    ContentView()
        .environmentObject(AppContainer.makePreview())
}

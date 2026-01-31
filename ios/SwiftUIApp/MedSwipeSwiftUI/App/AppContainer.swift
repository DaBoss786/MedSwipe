import Foundation

@MainActor
final class AppContainer: ObservableObject {
    let authService: AuthService
    let userService: UserService
    let dataService: DataService

    init(authService: AuthService, userService: UserService, dataService: DataService) {
        self.authService = authService
        self.userService = userService
        self.dataService = dataService
    }

    static func makeDefault() -> AppContainer {
        AppContainer(authService: StubAuthService(),
                     userService: StubUserService(),
                     dataService: StubDataService())
    }

    static func makePreview() -> AppContainer {
        makeDefault()
    }
}

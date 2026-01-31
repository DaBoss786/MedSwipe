import Foundation

@MainActor
final class StubAuthService: AuthService {
    private var isSignedIn = false

    func currentAuthState() async -> AuthState {
        isSignedIn ? .loggedIn(userId: "demo-user") : .loggedOut
    }

    func signInWithApple() async throws {
        isSignedIn = true
    }

    func signInWithGoogle() async throws {
        isSignedIn = true
    }

    func signOut() async throws {
        isSignedIn = false
    }
}

@MainActor
final class StubUserService: UserService {
    func fetchCurrentUser() async throws -> UserProfile {
        UserProfile(id: "demo-user", email: "user@example.com")
    }
}

@MainActor
final class StubDataService: DataService {
    func refresh() async throws {
        // Placeholder for initial data fetch.
    }
}

import Foundation

@MainActor
final class AuthViewModel: ObservableObject {
    @Published private(set) var state: AuthState = .unknown

    private let authService: AuthService

    init(authService: AuthService) {
        self.authService = authService
    }

    func load() async {
        state = await authService.currentAuthState()
    }

    func signInWithApple() async {
        do {
            try await authService.signInWithApple()
            state = await authService.currentAuthState()
        } catch {
            state = .loggedOut
        }
    }

    func signInWithGoogle() async {
        do {
            try await authService.signInWithGoogle()
            state = await authService.currentAuthState()
        } catch {
            state = .loggedOut
        }
    }

    func signOut() async {
        do {
            try await authService.signOut()
            state = .loggedOut
        } catch {
            state = .loggedIn(userId: "unknown")
        }
    }
}

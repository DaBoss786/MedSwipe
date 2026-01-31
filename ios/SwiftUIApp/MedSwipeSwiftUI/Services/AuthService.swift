import Foundation

enum AuthState: Equatable {
    case unknown
    case loggedOut
    case loggedIn(userId: String)
}

@MainActor
protocol AuthService {
    func currentAuthState() async -> AuthState
    func signInWithApple() async throws
    func signInWithGoogle() async throws
    func signOut() async throws
}

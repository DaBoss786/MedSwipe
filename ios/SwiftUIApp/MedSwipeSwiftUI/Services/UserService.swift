import Foundation

@MainActor
protocol UserService {
    func fetchCurrentUser() async throws -> UserProfile
}

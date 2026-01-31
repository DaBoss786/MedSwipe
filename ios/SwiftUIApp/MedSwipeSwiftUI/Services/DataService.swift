import Foundation

@MainActor
protocol DataService {
    func refresh() async throws
}

import SwiftUI

struct RootView: View {
    @StateObject private var viewModel: AuthViewModel

    init(authService: AuthService) {
        _viewModel = StateObject(wrappedValue: AuthViewModel(authService: authService))
    }

    var body: some View {
        Group {
            switch viewModel.state {
            case .unknown:
                ProgressView("Loading...")
            case .loggedOut:
                LoggedOutPlaceholderView(signInWithApple: viewModel.signInWithApple,
                                         signInWithGoogle: viewModel.signInWithGoogle)
            case .loggedIn(let userId):
                LoggedInPlaceholderView(userId: userId, signOut: viewModel.signOut)
            }
        }
        .task {
            await viewModel.load()
        }
    }
}

private struct LoggedOutPlaceholderView: View {
    let signInWithApple: () async -> Void
    let signInWithGoogle: () async -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("MedSwipe")
                .font(.largeTitle)
                .bold()
            Text("Logged out placeholder")
                .foregroundStyle(.secondary)
            Button("Continue with Apple") {
                Task { await signInWithApple() }
            }
            Button("Continue with Google") {
                Task { await signInWithGoogle() }
            }
        }
        .padding()
    }
}

private struct LoggedInPlaceholderView: View {
    let userId: String
    let signOut: () async -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("Logged in placeholder")
                .font(.title2)
            Text("User: \(userId)")
                .foregroundStyle(.secondary)
            Button("Sign out") {
                Task { await signOut() }
            }
        }
        .padding()
    }
}

#Preview("Logged out") {
    RootView(authService: StubAuthService())
}

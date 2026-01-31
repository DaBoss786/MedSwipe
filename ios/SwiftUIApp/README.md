# MedSwipe SwiftUI App (Phase 1 Scaffold)

This folder contains the native SwiftUI rewrite scaffold. It is intentionally isolated from the existing Capacitor app.

## Folder structure
- `MedSwipeSwiftUI/App/` — app entry point, root navigation, DI container.
- `MedSwipeSwiftUI/Features/` — feature-oriented modules (MVVM view + view model per feature).
- `MedSwipeSwiftUI/Services/` — Firebase-facing services, protocols, and stubs.
- `MedSwipeSwiftUI/Models/` — data models shared across features.
- `MedSwipeSwiftUI/UIComponents/` — reusable SwiftUI components.
- `MedSwipeSwiftUI/Resources/` — Info.plist, assets, localized strings, etc.

## Conventions
- MVVM with `@MainActor` view models and async/await.
- Feature modules live under `Features/<FeatureName>/`.
- Views are lightweight and depend on protocol-driven services via DI.
- No CME/paywall logic should be added here.

## Adding a new screen
1. Create `Features/<FeatureName>/<FeatureName>View.swift` and `<FeatureName>ViewModel.swift`.
2. Add a protocol to `Services/` if the feature needs data.
3. Provide a stub or mock implementation for previews.
4. Wire the view into `RootView` (or a future router).

## Firebase setup (SPM)
This project uses **Swift Package Manager** for Firebase. In Xcode:
1. Open the project in `ios/SwiftUIApp/MedSwipeSwiftUI.xcodeproj`.
2. Add package: `https://github.com/firebase/firebase-ios-sdk`.
3. Add products to the app target: `FirebaseAuth`, `FirebaseFirestore`, `FirebaseDatabase`, `FirebaseFunctions`, `FirebaseStorage`.
4. Add `GoogleService-Info.plist` to the app target (see below).

### GoogleService-Info.plist
- Download from Firebase console for the existing MedSwipe project.
- Place it at: `ios/SwiftUIApp/MedSwipeSwiftUI/Resources/GoogleService-Info.plist`.
- Ensure it is added to the app target.

## Auth scaffolding
- `AuthService` includes placeholders for Apple Sign-In and Google Sign-In.
- Implementations should use Firebase Auth (no CME gating).

### Required entitlements
- Enable **Sign In with Apple** capability in Xcode.
- Add `com.apple.developer.applesignin` entitlement (Default).

### Required Info.plist entries
- `CFBundleURLTypes` with the **REVERSED_CLIENT_ID** from `GoogleService-Info.plist`.
- (If using Google Sign-In) add URL scheme(s) per Firebase docs.

## Build notes
- The app compiles with stubs; Firebase imports are guarded with `canImport`.
- Once Firebase SDK is linked via SPM, remove guards if desired and implement real services.

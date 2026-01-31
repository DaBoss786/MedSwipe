# MedSwipe SwiftUI Phase 1 Scaffold Report

Date: 2026-01-30

## What was created
- New SwiftUI project scaffold at `ios/SwiftUIApp/MedSwipeSwiftUI.xcodeproj`.
- Source tree under `ios/SwiftUIApp/MedSwipeSwiftUI/` with MVVM + DI stubs.
- Firebase setup placeholder (`FirebaseService`) and `GoogleService-Info.plist` placeholder.
- Auth stubs for Apple/Google Sign-In via Firebase Auth (no CME logic).
- Basic `RootView` showing logged-in vs logged-out placeholder states.
- Resources: `Info.plist`, `LaunchScreen.storyboard`, `Assets.xcassets` (copied AppIcon set), and entitlements.

## Manual steps required
1. Open `ios/SwiftUIApp/MedSwipeSwiftUI.xcodeproj` in Xcode.
2. Add Firebase via Swift Package Manager:
   - Package URL: `https://github.com/firebase/firebase-ios-sdk`
   - Products: `FirebaseAuth`, `FirebaseFirestore`, `FirebaseDatabase`, `FirebaseFunctions`, `FirebaseStorage`.
3. Replace placeholder `GoogleService-Info.plist` with the real file from Firebase console.
4. Update `CFBundleURLTypes` in `Info.plist` with the real `REVERSED_CLIENT_ID`.
5. Enable **Sign In with Apple** capability and confirm entitlements.
6. Set `PRODUCT_BUNDLE_IDENTIFIER` to match the Firebase app registration.

## Notes
- Firebase imports are guarded with `canImport(FirebaseCore)` so the project builds before SPM is configured.
- CME/paywall features are intentionally excluded.

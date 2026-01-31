import Foundation

#if canImport(FirebaseCore)
import FirebaseCore
#endif

enum FirebaseService {
    static func configure() {
        #if canImport(FirebaseCore)
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        #else
        // Firebase SDK not linked yet. Add via SPM, then remove this guard if desired.
        #endif
    }
}

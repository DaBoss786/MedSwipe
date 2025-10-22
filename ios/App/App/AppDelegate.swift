import UIKit
import Capacitor
import FirebaseCore
import FirebaseFirestore
import FirebaseAuth
import FirebaseAppCheck

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        
        // IMPORTANT: Configure App Check BEFORE Firebase initialization
        #if DEBUG
            // For DEBUG builds (simulator testing)
            // You'll need to add a debug token from Firebase Console
            // Go to Firebase Console > App Check > Apps > Your iOS app > Manage debug tokens
            // Add a token and paste it here
            let providerFactory = AppCheckDebugProviderFactory()
        #else
            // For RELEASE builds (TestFlight and App Store)
            // This uses App Attest for iOS 14+
            let providerFactory = CustomAppCheckProviderFactory()
        #endif
        
        AppCheck.setAppCheckProviderFactory(providerFactory)
        
        // Now configure Firebase AFTER App Check is set up
        FirebaseApp.configure()
        
        // Optional: Get an App Check token to verify it's working
        let appCheck = AppCheck.appCheck()
        appCheck.token(forcingRefresh: false) { token, error in
            if let error = error {
                print("❌ App Check token error: \(error)")
            } else if let token = token {
                print("✅ App Check token obtained successfully")
                print("Token (first 10 chars): \(String(token.token.prefix(10)))...")
            }
        }
        
        application.statusBarStyle = .darkContent
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

// Custom App Check Provider Factory that uses App Attest when available
class CustomAppCheckProviderFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        if #available(iOS 14.0, *) {
            // Use App Attest for iOS 14+
            return AppAttestProvider(app: app)
        } else {
            // For iOS < 14, you would need to use DeviceCheck
            // Since you prefer not to use DeviceCheck, we'll return nil
            // This means App Check won't be available for iOS < 14
            print("⚠️ App Check requires iOS 14+ for App Attest")
            return nil
        }
    }
}

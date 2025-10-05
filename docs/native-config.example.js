   // native-config.example.js
   // Duplicate this file to native-config.js and fill in the real keys locally.
   (function exposeNativeConfig() {
    if (!window) return;

    // Replace the placeholder with your actual RevenueCat public API key before
    // building the native app. Leave this file untouched in git.
    window.REVENUECAT_API_KEY = 'REPLACE_WITH_REVENUECAT_API_KEY';
  })();
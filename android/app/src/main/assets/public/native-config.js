// native-config.js
// This file is gitignored so you can safely place environment-specific values here.
// Replace the placeholder value with your real RevenueCat public SDK key for iOS.
// For testing you can keep the provided sandbox key from RevenueCat.

(function exposeNativeConfig() {
  if (typeof window === 'undefined') {
    return;
  }

  // TODO: Replace with your production RevenueCat public API key before shipping.
  window.REVENUECAT_API_KEY = 'appl_tTdsYiMjyUDipmUhhVaiqCXrglK';
})();

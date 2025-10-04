// platform.js
// Centralized helpers for detecting runtime capabilities.

/**
 * Detects whether the current runtime is a native Capacitor environment.
 * This mirrors the heuristic used throughout the app so all billing
 * integrations share a single definition of "native".
 *
 * @returns {boolean}
 */
export function detectNativeApp() {
    const capacitor = typeof window !== 'undefined' ? window.Capacitor : undefined;
    if (!capacitor) return false;
  
    const isNativePlatform = typeof capacitor.isNativePlatform === 'function'
      ? capacitor.isNativePlatform()
      : undefined;
  
    if (isNativePlatform === true) {
      return true;
    }
  
    const platformName = typeof capacitor.getPlatform === 'function'
      ? capacitor.getPlatform()
      : undefined;
  
    return ['ios', 'android'].includes(platformName);
  }
  
  export const isNativeApp = detectNativeApp();
// app-check-config.js
// Unified App Check configuration for web and iOS without bundler requirements

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
  CustomProvider,
  getToken
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js";
import { detectNativeApp } from './platform.js';

let webAppCheckInstance = null;
let nativeTokenListenerHandle = null;

/**
 * Initialize Firebase App Check for the appropriate platform
 * @param {FirebaseApp} app - The initialized Firebase app instance
 */
export async function initializeAppCheckForPlatform(app) {
  const isNative = detectNativeApp();

  if (isNative) {
    const nativeInitialized = await initializeNativeAppCheck(app);
    if (nativeInitialized) {
      return;
    }

    console.warn("Falling back to web App Check after native initialization failed.");
  }

  await initializeWebAppCheck(app);
}

/**
 * Helper function to wait for ReCaptcha to load (web only)
 */
function waitForRecaptcha() {
  return new Promise((resolve, reject) => {
    // Skip if not in browser environment
    if (typeof window === "undefined") {
      reject(new Error("Not in browser environment"));
      return;
    }
    
    let attempts = 0;
    const maxAttempts = 50;
    const checkInterval = 100; // ms
    
    const checkRecaptcha = () => {
      if (window.grecaptcha && window.grecaptcha.enterprise) {
        resolve();
      } else if (++attempts < maxAttempts) {
        setTimeout(checkRecaptcha, checkInterval);
      } else {
        reject(new Error(`ReCAPTCHA timeout after ${maxAttempts * checkInterval / 1000} seconds`));
      }
    };
    
    checkRecaptcha();
  });
}

/**
 * Get current App Check token (works for both web and iOS)
 */
export async function getAppCheckToken(forceRefresh = false) {
  try {
    if (!webAppCheckInstance) {
      console.warn("App Check has not been initialized. Returning null token.");
      return null;
    }

    const tokenResult = await getToken(webAppCheckInstance, forceRefresh);
    return tokenResult?.token ?? null;
  } catch (error) {
    console.error("Error getting App Check token:", error);
    throw error;
  }
}

async function initializeNativeAppCheck(app) {
  console.log("Initializing App Check for native platform via Capacitor...");

  const nativeAppCheck = getNativeFirebaseAppCheck();
  if (!nativeAppCheck) {
    console.warn("Capacitor Firebase App Check plugin not available. Native App Check cannot be initialized.");
    return false;
  }

  try {
    await nativeAppCheck.initialize({
      // Provide a debug token here if you are testing on simulator/debug builds.
      isTokenAutoRefreshEnabled: true
    });
  } catch (error) {
    console.error("❌ Native App Check plugin initialization failed:", error);
    return false;
  }

  try {
    if (typeof nativeAppCheck.setTokenAutoRefreshEnabled === "function") {
      await nativeAppCheck.setTokenAutoRefreshEnabled({ enabled: true }).catch((setError) => {
        console.warn("⚠️ Unable to enable native App Check auto refresh:", setError);
      });
    }
  } catch (error) {
    console.warn("⚠️ Native App Check auto refresh could not be enabled:", error);
  }

  try {
    const provider = new CustomProvider({
      getToken: async ({ forceRefresh } = {}) => {
        try {
          const nativeResult = await nativeAppCheck.getToken({ forceRefresh: !!forceRefresh });
          const { token, expireTimeMillis } = normalizeNativeToken(nativeResult);
          if (!token) {
            throw new Error("Native App Check plugin returned no token.");
          }

          return {
            token,
            expireTimeMillis
          };
        } catch (tokenError) {
          console.error("❌ Failed to retrieve native App Check token:", tokenError);
          throw tokenError;
        }
      }
    });

    webAppCheckInstance = initializeAppCheck(app, {
      provider,
      isTokenAutoRefreshEnabled: true
    });

    if (nativeTokenListenerHandle && typeof nativeTokenListenerHandle.remove === "function") {
      try {
        const removalResult = nativeTokenListenerHandle.remove();
        if (removalResult && typeof removalResult.then === "function") {
          removalResult.catch(() => {});
        }
      } catch (removalError) {
        console.warn("⚠️ Could not remove existing native App Check listener:", removalError);
      }
    }

    if (typeof nativeAppCheck.addListener === "function") {
      try {
        const listener = await nativeAppCheck.addListener("tokenChanged", (event) => {
          if (event && event.token) {
            console.log("🔐 Native App Check token refreshed:", event.token.slice(0, 10) + "…");
          }
        });
        nativeTokenListenerHandle = listener;
      } catch (listenerError) {
        console.warn("⚠️ Could not attach native App Check token listener:", listenerError);
      }
    }

    // Optionally verify immediately
    try {
      const tokenResult = await getToken(webAppCheckInstance, false);
      console.log("✅ Native App Check bridge initialized. Token available:", tokenResult?.token ? "Yes" : "No");
    } catch (verificationError) {
      console.warn("⚠️ Native App Check bridge initialized but token retrieval failed:", verificationError);
    }

    return true;
  } catch (error) {
    console.error("❌ Failed to initialize native App Check bridge:", error);
    return false;
  }
}

async function initializeWebAppCheck(app) {
  console.log("Initializing App Check for Web with ReCaptcha Enterprise...");

  try {
    await waitForRecaptcha();

    webAppCheckInstance = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider("6Ld2rk8rAAAAAG4cK6ZdeKzASBvvVoYmfj0107Ag"),
      isTokenAutoRefreshEnabled: true
    });

    try {
      const tokenResult = await getToken(webAppCheckInstance, false);
      console.log("✅ Web App Check initialized. Token available:", tokenResult?.token ? "Yes" : "No");
    } catch (tokenError) {
      console.warn("⚠️ Web App Check initialized but token retrieval failed:", tokenError);
    }
  } catch (error) {
    console.error("❌ Web App Check initialization failed:", error);
    console.warn("App will continue without App Check protection.");
  }
}

function normalizeNativeToken(result) {
  if (!result) {
    return { token: null, expireTimeMillis: undefined };
  }

  if (typeof result === "string") {
    return { token: result, expireTimeMillis: undefined };
  }

  if (typeof result === "object") {
    if (typeof result.token === "string") {
      return {
        token: result.token,
        expireTimeMillis: typeof result.expireTimeMillis === "number" ? result.expireTimeMillis : undefined
      };
    }

    // Some plugins might return { token: "..." } without getters.
    if ("token" in result && result.token) {
      return {
        token: String(result.token),
        expireTimeMillis: typeof result.expireTimeMillis === "number" ? result.expireTimeMillis : undefined
      };
    }
  }

  return { token: null, expireTimeMillis: undefined };
}

function getNativeFirebaseAppCheck() {
  if (typeof window === "undefined") {
    return null;
  }

  const capacitor = window.Capacitor;
  if (!capacitor) {
    return null;
  }

  return capacitor.Plugins?.FirebaseAppCheck || capacitor.FirebaseAppCheck || null;
}

export default initializeAppCheckForPlatform;

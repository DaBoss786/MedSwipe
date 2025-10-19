import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js";

// Firebase App, Analytics, Firestore & Auth (Modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAnalytics, logEvent, setUserProperties } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-analytics.js";
import { getFirestore, doc, runTransaction, getDoc, addDoc, collection, serverTimestamp, getDocs, setDoc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
  getIdToken,
  EmailAuthProvider,
  linkWithCredential,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  getAdditionalUserInfo
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js"; // Added Functions import

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA24Xgt6ZF9pR7AMc235H2UeK044QhR3ts",
  authDomain: "medswipe-648ee.firebaseapp.com",
  projectId: "medswipe-648ee",
  storageBucket: "medswipe-648ee.firebasestorage.app",
  messagingSenderId: "288366122490",
  appId: "1:288366122490:web:1c150c48c8aed4e27f0043",
  measurementId: "G-748P8P634B"
};

// Initialize Firebase services
const app = initializeApp(firebaseConfig);

function isNativeApp() {
  if (typeof window === "undefined") {
    return false;
  }

  const capacitor = window.Capacitor;
  if (capacitor && typeof capacitor.isNativePlatform === "function") {
    try {
      return capacitor.isNativePlatform();
    } catch (error) {
      console.warn("Capacitor.isNativePlatform() threw an error, falling back to UA sniffing:", error);
    }
  }

  const userAgent = window.navigator?.userAgent || "";
  return /Capacitor|iOSApp|AndroidApp/i.test(userAgent);
}


function waitForRecaptcha() {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const checkRecaptcha = () => {
      if (window.grecaptcha && window.grecaptcha.enterprise) {
        resolve();
      } else if (++attempts < 50) {
        setTimeout(checkRecaptcha, 100);
      } else {
        reject(new Error("ReCAPTCHA timeout"));
      }
    };
    checkRecaptcha();
  });
}

// Initialize App Check after reCAPTCHA is ready for web builds only
if (!isNativeApp()) {
  waitForRecaptcha()
    .then(() => {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider("6Ld2rk8rAAAAAG4cK6ZdeKzASBvvVoYmfj0107Ag"),
        isTokenAutoRefreshEnabled: true
      });
    })
    .catch(error => console.error("App Check init failed:", error));
} else {
  console.info("Skipping Firebase App Check initialization for native runtime. TODO: integrate DeviceCheck/App Attest provider.");
}

  let analytics = null;

  try {
    analytics = getAnalytics(app);
  } catch (error) {
    console.warn("Firebase Analytics unavailable, continuing without it:", error);
    analytics = null;
  }
const db = getFirestore(app);
const popupRedirectResolver =
  typeof window !== "undefined" && window.capacitorExports
    ? window.capacitorExports.cordovaPopupRedirectResolver
    : undefined;

const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence].filter(Boolean),
  popupRedirectResolver: isNativeApp()
    ? popupRedirectResolver
    : browserPopupRedirectResolver
});
const functionsInstance = getFunctions(app); // Renamed to avoid conflicts

console.log("Firebase initialized successfully");
console.log("Firebase Functions Client SDK initialized");
console.log("Checking for ReCAPTCHA:", window.grecaptcha ? "Found" : "Not found");
console.log("Firebase App Check available:", typeof initializeAppCheck !== 'undefined' ? "Yes" : "No");

// Export initialized services for other modules to import
export {
 app,
  analytics,
  db,
  auth,
  functionsInstance as functions,
  // Export as "functions" to match expected naming
  logEvent,
  setUserProperties,
  doc,
  runTransaction,
  getDoc,
  addDoc,
  collection,
  serverTimestamp,
  getDocs,
  setDoc,
  updateDoc,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
  getIdToken,
  httpsCallable,
  EmailAuthProvider,
  linkWithCredential,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  getAdditionalUserInfo,
  query,
  where
};

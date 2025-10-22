// Import App Check configuration
import { initializeAppCheckForPlatform } from './app-check-config.js';

// Firebase App, Analytics, Firestore & Auth (Modular)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAnalytics, logEvent, setUserProperties } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-analytics.js";
import { getFirestore, doc, runTransaction, getDoc, addDoc, collection, serverTimestamp, getDocs, setDoc, updateDoc, query, where } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
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
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js";

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

// Initialize App Check for the appropriate platform (web or iOS)
// This now handles both ReCaptcha Enterprise (web) and App Attest (iOS)
initializeAppCheckForPlatform(app)
  .then(() => {
    console.log("App Check initialization completed");
  })
  .catch(error => {
    console.error("App Check initialization error:", error);
    // Don't let App Check errors prevent the app from running
    console.warn("App will continue without App Check protection");
  });

// Initialize Analytics
let analytics = null;
try {
  analytics = getAnalytics(app);
} catch (error) {
  console.warn("Firebase Analytics unavailable, continuing without it:", error);
  analytics = null;
}

// Initialize Firestore
const db = getFirestore(app);

// Initialize Auth with appropriate persistence
const popupRedirectResolver =
  typeof window !== "undefined" && window.capacitorExports
    ? window.capacitorExports.cordovaPopupRedirectResolver
    : undefined;

const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence].filter(Boolean),
  popupRedirectResolver: isNativeApp() ? popupRedirectResolver : undefined
});

// Initialize Functions
const functionsInstance = getFunctions(app);

console.log("Firebase initialized successfully");
console.log("Firebase Functions Client SDK initialized");
console.log("Platform:", isNativeApp() ? "Native iOS/Android" : "Web");

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

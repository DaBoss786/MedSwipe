// auth.js – Authentication functionality for MedSwipe
// ----------------------------------------------------

// --- Import necessary functions directly from firebase-config ---
import {
  auth,                     // Firebase Auth instance
  db, 
  functions,
  httpsCallable,                      // Firestore instance
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  onAuthStateChanged,
  createUserWithEmailAndPassword, // For direct registration
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
  updateProfile,
  // --- Added for linkWithCredential ---
  EmailAuthProvider,
  linkWithCredential,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  getAdditionalUserInfo
  // --- End added ---
} from './firebase-config.js';
import { isNativeApp } from './platform.js';

// Create a reference to the new Cloud Function
let finalizeRegistrationFunction;
try {
    finalizeRegistrationFunction = httpsCallable(functions, 'finalizeRegistration');
} catch (error) {
    console.error("Error creating finalizeRegistration function reference:", error);
}

let recomputeAccessTierFunction;
try {
    recomputeAccessTierFunction = httpsCallable(functions, 'recomputeAccessTier');
} catch (error) {
    console.error("Error creating recomputeAccessTier function reference:", error);
}


// ----------------------------------------------------
// Global reference to the auth state listener
let authStateListener = null;

// Auth state management
window.authState = {
  user: null,
  isRegistered: false,
  isLoading: true,
  accessTier: "free_guest", // <<< ADD a default accessTier
  boardReviewActive: false, // <<< ADD
  boardReviewSubscriptionEndDate: null, // <<< ADD
  cmeSubscriptionActive: false, // <<< ADD
  cmeSubscriptionEndDate: null, // <<< ADD
  cmeCreditsAvailable: 0 // <<< ADD
};

// ----------------------------------------------------
// Helper: generate a guest-style username
export function generateGuestUsername() {
  const adjectives = ['Curious', 'Medical', 'Swift', 'Learning', 'Aspiring'];
  const nouns      = ['Learner', 'Student', 'User', 'Doctor', 'Practitioner'];
  const adj  = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num  = Math.floor(Math.random() * 9000) + 1000;
  return `${adj}${noun}${num}`;
}

// ----------------------------------------------------
// OAuth provider helpers
const OAUTH_CONTEXT_STORAGE_KEY = 'medswipeOAuthContext';
const OAUTH_REFERRAL_STORAGE_KEY = 'medswipeReferrerId';

function getNativeAuthPlugin() {
  if (typeof window === 'undefined') {
    return null;
  }
  const capacitor = window.Capacitor || null;
  if (!capacitor) {
    return window.capacitorExports?.FirebaseAuthentication || null;
  }
  return (
    capacitor.Plugins?.FirebaseAuthentication ||
    window.capacitorExports?.FirebaseAuthentication ||
    null
  );
}

function createOAuthProvider(providerKey) {
  switch (providerKey) {
    case 'google': {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      provider.addScope('email');
      provider.addScope('profile');
      return provider;
    }
    case 'apple': {
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      try {
        const locale = (navigator?.language || 'en-US').replace('-', '_');
        provider.setCustomParameters({ locale });
      } catch (err) {
        console.warn('Unable to set Apple provider locale:', err);
      }
      return provider;
    }
    default:
      throw new Error('Unsupported OAuth provider: ' + providerKey);
  }
}

function deriveDisplayName(user, profile) {
  if (user?.displayName) {
    return user.displayName;
  }
  const profileName = profile && (profile.name || profile.fullName || profile.displayName);
  if (typeof profileName === 'string' && profileName.trim()) {
    return profileName.trim();
  }
  if (profileName && typeof profileName === 'object') {
    const firstName = profileName.firstName || profileName.givenName || profileName.nameFirst || '';
    const lastName = profileName.lastName || profileName.familyName || profileName.nameLast || '';
    const combined = `${firstName} ${lastName}`.trim();
    if (combined) {
      return combined;
    }
  }
  if (user?.email) {
    return user.email.split('@')[0];
  }
  return generateGuestUsername();
}

function shouldFallbackToRedirect(error) {
  const code = error?.code;
  return code === 'auth/popup-blocked'
    || code === 'auth/operation-not-supported-in-this-environment'
    || code === 'auth/argument-error';
}

function isUserCancelledError(error) {
  const code = error?.code;
  return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request';
}

async function handleOAuthResult(result, { providerKey, flow = 'login', marketingOptIn = false, referrerId = null }) {
  const additionalUserInfo = getAdditionalUserInfo(result);
  const isNewUser = !!additionalUserInfo?.isNewUser;
  const effectiveFlow = isNewUser ? 'register' : flow;
  const user = result.user;

  let finalizeResult = null;
  let referralCleared = false;

  const resolveOnboardingUsername = () => {
    try {
      const maybeFromWindow = typeof window !== 'undefined' ? window.selectedUsername : null;
      if (typeof maybeFromWindow === 'string' && maybeFromWindow.trim().length >= 3) {
        return maybeFromWindow.trim();
      }
      const maybeFromAuthState = typeof window !== 'undefined' && window.authState && typeof window.authState.username === 'string'
        ? window.authState.username
        : null;
      if (maybeFromAuthState && maybeFromAuthState.trim().length >= 3) {
        return maybeFromAuthState.trim();
      }
    } catch (err) {
      console.warn('Unable to resolve onboarding username from window context:', err);
    }
    return null;
  };

  const sanitizeProviderUsername = (candidate) => {
    if (typeof candidate !== 'string') {
      return null;
    }
    const trimmed = candidate.trim();
    if (trimmed.length < 3) {
      return null;
    }
    // Treat names with spaces as potential real names; prefer to generate a guest name instead.
    if (/\s/.test(trimmed)) {
      return null;
    }
    return trimmed;
  };

  const onboardingUsername = resolveOnboardingUsername();
  let usernameForFinalize = onboardingUsername;
  if (!usernameForFinalize) {
    const displayNameCandidate = sanitizeProviderUsername(user?.displayName);
    if (displayNameCandidate) {
      usernameForFinalize = displayNameCandidate;
    }
  }
  if (!usernameForFinalize) {
    const derivedCandidate = sanitizeProviderUsername(
      deriveDisplayName(user, additionalUserInfo?.profile)
    );
    if (derivedCandidate) {
      usernameForFinalize = derivedCandidate;
    }
  }
  if (!usernameForFinalize) {
    usernameForFinalize = generateGuestUsername();
  }

  if (isNewUser) {
    if (!finalizeRegistrationFunction) {
      throw new Error('Registration service is not available. Please try again later.');
    }
    finalizeResult = await finalizeRegistrationFunction({
      username: usernameForFinalize,
      marketingOptIn: Boolean(marketingOptIn),
      referrerId
    });
    if (user?.displayName !== usernameForFinalize) {
      try {
        await updateProfile(user, { displayName: usernameForFinalize });
      } catch (profileErr) {
        console.warn('Failed to align Firebase Auth displayName after OAuth finalize:', profileErr);
      }
    }
    if (referrerId) {
      try {
        localStorage.removeItem(OAUTH_REFERRAL_STORAGE_KEY);
        referralCleared = true;
      } catch (storageErr) {
        console.warn('Failed to clear referral storage:', storageErr);
      }
    }
  }

  return {
    status: 'success',
    provider: providerKey,
    flow: effectiveFlow,
    user,
    isNewUser,
    finalizeResult,
    referralCleared
  };
}

async function processOAuthRedirectResult() {
  let context = null;
  try {
    const stored = sessionStorage.getItem(OAUTH_CONTEXT_STORAGE_KEY);
    if (stored) {
      context = JSON.parse(stored);
    }
  } catch (err) {
    console.warn('Invalid stored OAuth context payload:', err);
  }

  if (isNativeApp && !context) {
    // Native builds use the Capacitor plugin for OAuth; skip redirect polling unless we actually initiated one.
    return null;
  }

  try {
    const redirectResult = await getRedirectResult(auth);
    if (!redirectResult) {
      if (context) {
        try {
          sessionStorage.removeItem(OAUTH_CONTEXT_STORAGE_KEY);
        } catch (err) {
          console.warn('Unable to clear OAuth context storage:', err);
        }
      }
      return null;
    }

    const inferredProvider = redirectResult?.providerId === 'apple.com' ? 'apple' : 'google';
    const providerKey = context?.providerKey || inferredProvider;
    let referrerId = context?.referrerId;
    if (typeof referrerId === 'undefined') {
      try {
        referrerId = localStorage.getItem(OAUTH_REFERRAL_STORAGE_KEY);
      } catch (storageErr) {
        console.warn('Unable to read referral storage after redirect:', storageErr);
        referrerId = null;
      }
    }

    const outcome = await handleOAuthResult(redirectResult, {
      providerKey,
      flow: context?.flow || 'login',
      marketingOptIn: context?.marketingOptIn ?? false,
      referrerId
    });

    try {
      sessionStorage.removeItem(OAUTH_CONTEXT_STORAGE_KEY);
    } catch (err) {
      console.warn('Unable to clear OAuth context storage:', err);
    }
    window.__medswipeOAuthRedirectOutcome = outcome;
    window.dispatchEvent(new CustomEvent('oauthRedirectResult', { detail: outcome }));
    return outcome;
  } catch (error) {
    try {
      sessionStorage.removeItem(OAUTH_CONTEXT_STORAGE_KEY);
    } catch (err) {
      console.warn('Unable to clear OAuth context storage:', err);
    }
    const detail = { status: 'error', error, flow: context?.flow || null, provider: context?.providerKey || null };
    window.__medswipeOAuthRedirectOutcome = detail;
    window.dispatchEvent(new CustomEvent('oauthRedirectResult', { detail }));
    console.error('OAuth redirect error:', error);
    return null;
  }
}

async function oauthSignIn(providerKey, options = {}) {
  const provider = createOAuthProvider(providerKey);
  const flow = options.flow || 'login';
  const marketingOptIn = Boolean(options.marketingOptIn);
  let referrerId = options.referrerId;

  if (typeof referrerId === 'undefined') {
    try {
      referrerId = localStorage.getItem(OAUTH_REFERRAL_STORAGE_KEY);
    } catch (storageErr) {
      console.warn('Unable to read referral storage for OAuth sign-in:', storageErr);
      referrerId = null;
    }
  }

  const nativePlugin = getNativeAuthPlugin();
  const isNativeRuntime = Boolean(isNativeApp);

  const startRedirectFlow = async () => {
    try {
      sessionStorage.setItem(
        OAUTH_CONTEXT_STORAGE_KEY,
        JSON.stringify({
          providerKey,
          flow,
          marketingOptIn,
          referrerId
        })
      );
    } catch (storageErr) {
      console.warn('Unable to persist OAuth redirect context:', storageErr);
    }

    try {
      await signInWithRedirect(auth, provider);
      return { status: 'redirect', provider: providerKey, flow };
    } catch (redirectError) {
      try {
        sessionStorage.removeItem(OAUTH_CONTEXT_STORAGE_KEY);
      } catch (err) {
        console.warn('Unable to clear OAuth context storage:', err);
      }
      throw redirectError;
    }
  };

  if (isNativeRuntime) {
    if (providerKey === 'google' && nativePlugin?.signInWithGoogle) {
      try {
        const nativeResult = await nativePlugin.signInWithGoogle({ skipNativeAuth: true });
        const nativeCredential = nativeResult?.credential || {};
        if (!nativeCredential.idToken && !nativeCredential.accessToken) {
          throw new Error('Native Google sign-in did not return OAuth tokens.');
        }
        const firebaseCredential = GoogleAuthProvider.credential(
          nativeCredential.idToken || undefined,
          nativeCredential.accessToken || undefined
        );
        const userCredential = await signInWithCredential(auth, firebaseCredential);
        return await handleOAuthResult(userCredential, {
          providerKey,
          flow,
          marketingOptIn,
          referrerId
        });
      } catch (nativeError) {
        console.error('Native Google sign-in error:', nativeError);
        throw nativeError;
      }
    } else if (providerKey === 'apple' && nativePlugin?.signInWithApple) {
      try {
        const nativeResult = await nativePlugin.signInWithApple({ skipNativeAuth: true });
        const nativeCredential = nativeResult?.credential || {};
        if (!nativeCredential.idToken) {
          throw new Error('Native Apple sign-in did not return an ID token.');
        }
        const appleProvider = new OAuthProvider('apple.com');
        const firebaseCredential = appleProvider.credential({
          idToken: nativeCredential.idToken,
          rawNonce: nativeCredential.nonce || undefined
        });
        const userCredential = await signInWithCredential(auth, firebaseCredential);
        return await handleOAuthResult(userCredential, {
          providerKey,
          flow,
          marketingOptIn,
          referrerId
        });
      } catch (nativeError) {
        console.error('Native Apple sign-in error:', nativeError);
        throw nativeError;
      }
    }
    console.info(`Native runtime detected for provider ${providerKey}. Falling back to redirect flow.`);
    return startRedirectFlow();
  }

  try {
    const result = await signInWithPopup(auth, provider);
    return await handleOAuthResult(result, {
      providerKey,
      flow,
      marketingOptIn,
      referrerId
    });
  } catch (error) {
    if (shouldFallbackToRedirect(error)) {
      return startRedirectFlow();
    }

    if (isUserCancelledError(error)) {
      throw error;
    }

    console.error(`OAuth sign-in failed for provider ${providerKey}:`, error);
    throw error;
  }
}

const oauthRedirectPromise = processOAuthRedirectResult();

// ----------------------------------------------------
// Initialize authentication system and set up listeners
function initAuth() {
  if (!auth || !db) {
    console.error('Firebase auth or db instance not available. Retrying…');
    setTimeout(initAuth, 500);
    return;
  }

  console.log('Initializing auth system');

  authStateListener = onAuthStateChanged(auth, async (user) => {
    console.log(
      'Auth state changed:',
      user ? `${user.uid} (isAnonymous: ${user?.isAnonymous})` : 'No user'
    );

    // Reset authState for new evaluation
    window.authState.isLoading = true;
    window.authState.user = null;
    window.authState.isRegistered = false;
    window.authState.accessTier = "free_guest"; // Default tier
    window.authState.boardReviewActive = false;
    window.authState.boardReviewSubscriptionEndDate = null;
    window.authState.cmeSubscriptionActive = false;
    window.authState.cmeSubscriptionEndDate = null;
    window.authState.cmeCreditsAvailable = 0;


    if (user) {
      // ---------- Signed-in path ----------
      window.authState.user = user; // Set Firebase user object

      const userDocRef = doc(db, 'users', user.uid);
      let userDocSnap;
      try {
        userDocSnap = await getDoc(userDocRef);
      } catch (docError) {
        console.error(`Error fetching user document for ${user.uid}:`, docError);
        // Keep user as guest if doc fetch fails, or handle as critical error
        window.authState.isLoading = false;
        window.dispatchEvent(
          new CustomEvent('authStateChanged', { detail: { ...window.authState } })
        );
        return; // Stop further processing for this user
      }
      
      let userDataForWrite = {};
      const isNewUserDocument = !userDocSnap.exists();
      const currentAuthIsRegistered = !user.isAnonymous; // Based on Firebase Auth type

      let effectiveAccessTier = "free_guest"; // To be determined

      if (isNewUserDocument) {
        console.log(`User doc for ${user.uid} not found, creating with defaults...`);
        // SLIM WRITE: Only write non-sensitive fields. The backend will add sensitive fields.
        userDataForWrite = {
          username: user.isAnonymous
            ? generateGuestUsername()
            : (user.displayName || user.email || `User_${user.uid.substring(0, 5)}`),
          email: user.email || null,
          createdAt: serverTimestamp(),
          // Core profile defaults; backend can enrich with additional details later.
          specialty: "ENT",
          experienceLevel: null,
      
          // Default stats scaffold
          stats: {
            totalAnswered: 0,
            totalCorrect:  0,
            totalIncorrect: 0,
            categories: {},
            totalTimeSpent: 0,
            xp: 0,
            level: 1,
            achievements: {},
            currentCorrectStreak: 0
          },
          streaks: {
            lastAnsweredDate: null,
            currentStreak: 0,
            longestStreak: 0
          },
          bookmarks: [],

          cmeStats: {
            totalAnswered: 0,
            totalCorrect:  0,
            eligibleAnswerCount: 0,
            creditsEarned:  0.0,
            creditsClaimed: 0.0
          },
          cmeAnsweredQuestions: {},
          cmeClaimHistory: [],
        };

        if (currentAuthIsRegistered && user.email) {
          userDataForWrite.email = user.email;
        }
        window.authState.isRegistered = currentAuthIsRegistered; // Set from auth type
        window.authState.accessTier = "free_guest"; // Set explicitly for new user
        // Other authState fields remain default (false/null/0)
      } else {
        // ---- Existing Firestore user doc ----
        const existingData = userDocSnap.data();
        console.log(
          `Found user doc for ${user.uid}. AuthIsAnon=${user.isAnonymous}, StoredIsReg=${existingData.isRegistered}, StoredTier=${existingData.accessTier}`
        );

        window.authState.isRegistered = currentAuthIsRegistered; // Set from auth type

        // Update email in Firestore if newly registered via Firebase Auth and not matching
        if (currentAuthIsRegistered && user.email && existingData.email !== user.email) {
          userDataForWrite.email = user.email;
        }

        // Ensure anonymous users keep a guest-style username if current one isn't guest-like
        if (
          user.isAnonymous &&
          (!existingData.username ||
            !/^((Curious|Medical|Swift|Learning|Aspiring)(Learner|Student|User|Doctor|Practitioner))/.test(
              existingData.username
            ))
        ) {
          userDataForWrite.username = generateGuestUsername();
        }

         // --- BACK-FILL SPECIALTY (NEW) ---
         if (typeof existingData.specialty === 'undefined' || existingData.specialty === null || existingData.specialty === "") {
          console.log(`User ${user.uid} is missing specialty. Back-filling with 'ENT'.`);
          userDataForWrite.specialty = "ENT";
        }
        // --- END BACK-FILL SPECIALTY ---

        // --- Read subscription details and determine effective access tier ---
        let brActive = existingData.boardReviewActive || false;
        let brEndDate = existingData.boardReviewSubscriptionEndDate || null;
        let cmeActive = existingData.cmeSubscriptionActive || false;
        let cmeEndDate = existingData.cmeSubscriptionEndDate || null;
        const credits = existingData.cmeCreditsAvailable || 0;
        let storedTier = existingData.accessTier || "free_guest";

        const now = new Date();

        // Client-side expiry check for Board Review
        if (brActive && brEndDate && brEndDate.toDate() < now) {
          console.log(`Client-side: Board Review for ${user.uid} expired.`);
          brActive = false;
          // Optionally clear/update boardReviewTier if it was specific
        }

        // Client-side expiry check for CME Annual
        if (cmeActive && cmeEndDate && cmeEndDate.toDate() < now) {
          console.log(`Client-side: CME Annual for ${user.uid} expired.`);
          cmeActive = false;
          // If CME Annual expires, any BR access granted by it also expires
          if (existingData.boardReviewTier === "Granted by CME Annual") {
            brActive = false;

          }
        }
        
        // Determine effective tier based on (potentially client-side updated) active flags
        if (cmeActive) { // cmeSubscriptionActive implies cme_annual
            effectiveAccessTier = "cme_annual";
        } else if (brActive) {
            effectiveAccessTier = "board_review";
        } else if (credits > 0) {
            effectiveAccessTier = "cme_credits_only";
        } else {
            effectiveAccessTier = "free_guest";
        }

        // If client-side determined tier differs from stored, update Firestore
        if (effectiveAccessTier !== storedTier) {
          console.log(`Client-side tier re-evaluation for ${user.uid}: Stored='${storedTier}', NewEffective='${effectiveAccessTier}'. Requesting server reconciliation.`);
        }
        
        // Populate window.authState with current effective values
        window.authState.accessTier = effectiveAccessTier;
        window.authState.boardReviewActive = brActive;
        window.authState.boardReviewSubscriptionEndDate = brEndDate ? brEndDate.toDate() : null;
        window.authState.cmeSubscriptionActive = cmeActive;
        window.authState.cmeSubscriptionEndDate = cmeEndDate ? cmeEndDate.toDate() : null;
        window.authState.cmeCreditsAvailable = credits;
      }

      // Write new or updated fields to Firestore if needed
      if (isNewUserDocument || Object.keys(userDataForWrite).length > 0) {
        if (!isNewUserDocument) { // Add updatedAt for existing doc updates
            userDataForWrite.updatedAt = serverTimestamp();
        }
        try {
          await setDoc(userDocRef, userDataForWrite, { merge: true });
          console.log(
            `User doc ${isNewUserDocument ? 'created' : 'updated'} for ${user.uid}. Effective Tier: ${window.authState.accessTier}`
          );
        } catch (err) {
          console.error('Error writing user doc:', err);
        }
      } else {
         console.log(`User doc for ${user.uid} exists and is up-to-date. Effective Tier: ${window.authState.accessTier}`);
      }

      if (recomputeAccessTierFunction) {
        try {
          const recomputeResult = await recomputeAccessTierFunction();
          const payload = recomputeResult?.data;
          if (payload && typeof payload === 'object') {
            if (typeof payload.accessTier === 'string') {
              window.authState.accessTier = payload.accessTier;
            }
            if (typeof payload.boardReviewActive === 'boolean') {
              window.authState.boardReviewActive = payload.boardReviewActive;
            }
            if ('boardReviewSubscriptionEndDate' in payload) {
              window.authState.boardReviewSubscriptionEndDate =
                typeof payload.boardReviewSubscriptionEndDate === 'number'
                  ? new Date(payload.boardReviewSubscriptionEndDate)
                  : null;
            }
            if (typeof payload.cmeSubscriptionActive === 'boolean') {
              window.authState.cmeSubscriptionActive = payload.cmeSubscriptionActive;
            }
            if ('cmeSubscriptionEndDate' in payload) {
              window.authState.cmeSubscriptionEndDate =
                typeof payload.cmeSubscriptionEndDate === 'number'
                  ? new Date(payload.cmeSubscriptionEndDate)
                  : null;
            }
            if ('cmeCreditsAvailable' in payload) {
              const numericCredits = Number(payload.cmeCreditsAvailable) || 0;
              window.authState.cmeCreditsAvailable = numericCredits;
            }
          }
        } catch (err) {
          console.error('Error invoking recomputeAccessTier Cloud Function:', err);
        }
      }


    } else {
      // ---------- No user signed in (or explicitly signed out) ----------
      // This block will be followed by an anonymous sign-in attempt
      console.log('No user currently signed in. Preparing for anonymous sign-in or state clear.');
      // window.authState is already reset at the beginning of onAuthStateChanged
      // Anonymous sign-in will trigger onAuthStateChanged again.
      try {
        await signInAnonymously(auth);
        console.log('Signed in anonymously after explicit logout/no user.');
        // The onAuthStateChanged listener will run again for this anonymous user.
      } catch (err) {
        console.error('Anonymous sign-in error after explicit logout/no user:', err);
        window.authState.isLoading = false; // Stop loading if anon sign-in fails
        // Dispatch event with cleared state if anon sign-in fails
        window.dispatchEvent(
          new CustomEvent('authStateChanged', { detail: { ...window.authState } })
        );
      }
      return; // Return here to avoid dispatching event before anon user is processed
    }

    // This check ensures isLoading is false only when processing is truly done for the current user state
    // (either a logged-in user processed, or an anonymous user successfully signed in and processed)
    if (window.authState.user || !user) { // If user is now set, or if there was no initial user (and anon sign-in failed)
        window.authState.isLoading = false;
    }


    console.log("Dispatching authStateChanged with detail:", {
        user: window.authState.user,
        isRegistered: window.authState.isRegistered,
        isLoading: window.authState.isLoading,
        accessTier: window.authState.accessTier, // <<< INCLUDE NEW TIER
        boardReviewActive: window.authState.boardReviewActive,
        boardReviewSubscriptionEndDate: window.authState.boardReviewSubscriptionEndDate,
        cmeSubscriptionActive: window.authState.cmeSubscriptionActive,
        cmeSubscriptionEndDate: window.authState.cmeSubscriptionEndDate,
        cmeCreditsAvailable: window.authState.cmeCreditsAvailable
    });

    window.dispatchEvent(
      new CustomEvent('authStateChanged', {
        detail: {
          user: window.authState.user,
          isRegistered: window.authState.isRegistered,
          isLoading: window.authState.isLoading,
          accessTier: window.authState.accessTier, // <<< INCLUDE NEW TIER
          // Also include other relevant flags for convenience if needed by listeners
          boardReviewActive: window.authState.boardReviewActive,
          boardReviewSubscriptionEndDate: window.authState.boardReviewSubscriptionEndDate,
          cmeSubscriptionActive: window.authState.cmeSubscriptionActive,
          cmeSubscriptionEndDate: window.authState.cmeSubscriptionEndDate,
          cmeCreditsAvailable: window.authState.cmeCreditsAvailable
        }
      })
    );
  }); // End of onAuthStateChanged

  return () => {
    if (authStateListener) {
      console.log('Cleaning up auth state listener.');
      authStateListener();
      authStateListener = null;
    }
  };
} // End of initAuth

function timestampToDate(value) {
  if (!value) {
    return null;
  }
  if (typeof value?.toDate === 'function') {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  const millis = Number(value);
  if (Number.isFinite(millis) && millis > 0) {
    return new Date(millis);
  }
  return null;
}

function snapshotCurrentAuthState() {
  const state = window?.authState || {};
  return {
    accessTier: state.accessTier,
    boardReviewActive: !!state.boardReviewActive,
    boardReviewSubscriptionEndDate: state.boardReviewSubscriptionEndDate instanceof Date
      ? state.boardReviewSubscriptionEndDate
      : null,
    cmeSubscriptionActive: !!state.cmeSubscriptionActive,
    cmeSubscriptionEndDate: state.cmeSubscriptionEndDate instanceof Date
      ? state.cmeSubscriptionEndDate
      : null,
    cmeCreditsAvailable: Number(state.cmeCreditsAvailable || 0)
  };
}

function datesMatch(a, b) {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;
  return left === right;
}

export async function refreshAuthStateFromFirestore(options = {}) {
  const { forceDispatch = false } = options || {};

  if (!auth || !db) {
    console.warn('refreshAuthStateFromFirestore called before Firebase initialized.');
    return { refreshed: false, reason: 'uninitialized' };
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    return { refreshed: false, reason: 'no-user' };
  }

  const userDocRef = doc(db, 'users', currentUser.uid);
  let snapshot;
  try {
    snapshot = await getDoc(userDocRef);
  } catch (error) {
    console.error('refreshAuthStateFromFirestore: failed to fetch user doc.', error);
    return { refreshed: false, reason: 'firestore-error', error };
  }

  if (!snapshot.exists()) {
    const defaultDoc = {
      createdAt: serverTimestamp(),
      username: currentUser.isAnonymous
        ? generateGuestUsername()
        : (currentUser.displayName || currentUser.email || `User_${currentUser.uid.substring(0, 5)}`),
      email: currentUser.email || null
    };

    try {
      await setDoc(userDocRef, defaultDoc, { merge: true });
      snapshot = await getDoc(userDocRef);
    } catch (error) {
      console.error('refreshAuthStateFromFirestore: failed to create default user doc.', error);
      return { refreshed: false, reason: 'doc-create-error', error };
    }

    if (!snapshot.exists()) {
      return { refreshed: false, reason: 'missing-doc' };
    }
  }

  if (!window.authState) {
    window.authState = {};
  }

  let data = snapshot.data() || {};

  const previous = snapshotCurrentAuthState();

  const accessTier = typeof data.accessTier === 'string'
    ? data.accessTier
    : previous.accessTier || 'free_guest';

  const boardReviewActive = !!data.boardReviewActive || data.boardReviewTier === 'Granted by CME Annual';
  const boardReviewSubscriptionEndDate = timestampToDate(data.boardReviewSubscriptionEndDate);
  const cmeSubscriptionActive = !!data.cmeSubscriptionActive;
  const cmeSubscriptionEndDate = timestampToDate(data.cmeSubscriptionEndDate);
  const cmeCreditsAvailable = Number(data.cmeCreditsAvailable || 0);

  window.authState.accessTier = accessTier;
  window.authState.boardReviewActive = boardReviewActive;
  window.authState.boardReviewSubscriptionEndDate = boardReviewSubscriptionEndDate;
  window.authState.cmeSubscriptionActive = cmeSubscriptionActive;
  window.authState.cmeSubscriptionEndDate = cmeSubscriptionEndDate;
  window.authState.cmeCreditsAvailable = cmeCreditsAvailable;
  window.authState.isRegistered = typeof data.isRegistered === 'boolean'
    ? data.isRegistered
    : !currentUser.isAnonymous;
  window.authState.isLoading = false;

  const changed =
    previous.accessTier !== accessTier ||
    previous.boardReviewActive !== boardReviewActive ||
    previous.cmeSubscriptionActive !== cmeSubscriptionActive ||
    previous.cmeCreditsAvailable !== cmeCreditsAvailable ||
    !datesMatch(previous.boardReviewSubscriptionEndDate, boardReviewSubscriptionEndDate) ||
    !datesMatch(previous.cmeSubscriptionEndDate, cmeSubscriptionEndDate);

  if (forceDispatch || changed) {
    window.dispatchEvent(
      new CustomEvent('authStateChanged', {
        detail: {
          user: window.authState.user,
          isRegistered: window.authState.isRegistered,
          isLoading: window.authState.isLoading,
          accessTier: window.authState.accessTier,
          boardReviewActive: window.authState.boardReviewActive,
          boardReviewSubscriptionEndDate: window.authState.boardReviewSubscriptionEndDate,
          cmeSubscriptionActive: window.authState.cmeSubscriptionActive,
          cmeSubscriptionEndDate: window.authState.cmeSubscriptionEndDate,
          cmeCreditsAvailable: window.authState.cmeCreditsAvailable
        }
      })
    );
  }

  return {
    refreshed: true,
    changed,
    accessTier,
    boardReviewActive,
    cmeSubscriptionActive,
    cmeCreditsAvailable
  };
}

// ----------------------------------------------------
// Convenience accessors
function isUserRegistered() {
  return window.authState.isRegistered;
}
function getCurrentUser() {
  return window.authState.user;
}

// In auth.js - NEW version of registerUser
async function registerUser(email, password, username, referrerId = null) {
  if (!finalizeRegistrationFunction) {
    throw new Error('Registration service is not available. Please try again later.');
  }
  try {
    console.log(`registerUser: creating ${email}`);
    // Step 1: Create the user in Firebase Auth
    const { user } = await createUserWithEmailAndPassword(auth, email, password);

    // Step 2: Update their Auth profile display name
    await updateProfile(user, { displayName: username });

    // Step 3: Create the "slim" user document in Firestore.
    const userDocRef = doc(db, 'users', user.uid);
    await setDoc(userDocRef, {
        username,
        email,
        createdAt: serverTimestamp()
    });

    // Step 4: Call the secure Cloud Function to finalize the registration fields.
    const marketingOptIn = document.getElementById('marketingOptIn')?.checked || false;
    const result = await finalizeRegistrationFunction({ username, marketingOptIn, referrerId });

    // The onAuthStateChanged listener will handle the rest, but we return the result.
    return result;
  } catch (err) {
    console.error('registerUser error:', err);
    throw err;
  }
}

// In auth.js - NEW version of upgradeAnonymousUser
async function upgradeAnonymousUser(email, password, username, referrerId = null) {
  const anonUser = auth.currentUser;

  if (!anonUser || !anonUser.isAnonymous) {
    throw new Error('No anonymous user to upgrade.');
  }
  if (!finalizeRegistrationFunction) {
    throw new Error('Registration service is not available. Please try again later.');
  }

  console.log(`Linking anonymous UID ${anonUser.uid} to ${email}…`);

  try {
    // Step 1: Link the auth credential.
    const cred = EmailAuthProvider.credential(email, password);
    const { user: upgradedUser } = await linkWithCredential(anonUser, cred);

    // Step 2: Update the user's display name in Firebase Auth itself.
    await updateProfile(upgradedUser, { displayName: username });

    // Step 3: Call the secure Cloud Function to update the Firestore document.
    const marketingOptIn = document.getElementById('marketingOptIn')?.checked || false;
    const result = await finalizeRegistrationFunction({ username, marketingOptIn, referrerId });

    // The onAuthStateChanged listener will automatically pick up the new state,
    // but we return the result from the function call.
    return result;
  } catch (err) {
    console.error('upgradeAnonymousUser error:', err);
    throw err;
  }
}

// ----------------------------------------------------
// Login / logout helpers
async function loginUser(email, password) {
  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    return user;
  } catch (err) {
    console.error('loginUser error:', err);
    throw err;
  }
}

async function logoutUser() {
  try {
    if (typeof cleanupOnLogout === 'function') {
      await cleanupOnLogout(); // defined elsewhere
    }
    await signOut(auth);
    console.log('Logged out – anonymous sign-in will run via onAuthStateChanged.');
  } catch (err) {
    console.error('logoutUser error:', err);
    throw err;
  }
}

// ----------------------------------------------------
// Expose functions globally if needed by UI scripts
// Provide guest username helper globally for modules that rely on dynamic import
window.generateGuestUsername = generateGuestUsername;
window.refreshAuthStateFromFirestore = refreshAuthStateFromFirestore;

window.authFunctions = {
  isUserRegistered,
  getCurrentUser,
  refreshAuthStateFromFirestore,
  registerUser,
  loginUser,
  logoutUser,
  upgradeAnonymousUser,
  oauthSignIn,
  oauthRedirectPromise
};

// Kick things off
initAuth();

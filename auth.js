// auth.js – Authentication functionality for MedSwipe
// ----------------------------------------------------

// --- Import necessary functions directly from firebase-config ---
import {
  auth,                     // Firebase Auth instance
  db,                       // Firestore instance
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
  linkWithCredential
  // --- End added ---
} from './firebase-config.js';

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
function generateGuestUsername() {
  const adjectives = ['Curious', 'Medical', 'Swift', 'Learning', 'Aspiring'];
  const nouns      = ['Learner', 'Student', 'User', 'Doctor', 'Practitioner'];
  const adj  = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num  = Math.floor(Math.random() * 9000) + 1000;
  return `${adj}${noun}${num}`;
}

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
        // SLIM WRITE: Only write non-sensitive fields. The backend will add defaults for sensitive fields.
        userDataForWrite = {
          username: user.isAnonymous
            ? generateGuestUsername()
            : (user.displayName || user.email || `User_${user.uid.substring(0, 5)}`),
          email: user.email || null,
          createdAt: serverTimestamp(),
          // --- SENSITIVE FIELDS REMOVED ---
          // isRegistered, accessTier, boardReviewActive, etc., will be set by a Cloud Function.
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
          // Initialize subscription fields to false/null
          boardReviewActive: false,
          boardReviewSubscriptionEndDate: null,
          cmeSubscriptionActive: false,
          cmeSubscriptionEndDate: null,
          cmeCreditsAvailable: 0,
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

        // Sync isRegistered flag if Firebase Auth state and Firestore are misaligned
        if (existingData.isRegistered !== currentAuthIsRegistered) {
          console.log(`Correcting isRegistered for ${user.uid} in Firestore.`);
          userDataForWrite.isRegistered = currentAuthIsRegistered;
        }
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
          userDataForWrite.boardReviewActive = false; // Mark for Firestore update
          // Optionally clear/update boardReviewTier if it was specific
        }

        // Client-side expiry check for CME Annual
        if (cmeActive && cmeEndDate && cmeEndDate.toDate() < now) {
          console.log(`Client-side: CME Annual for ${user.uid} expired.`);
          cmeActive = false;
          userDataForWrite.cmeSubscriptionActive = false; // Mark for Firestore update
          // If CME Annual expires, any BR access granted by it also expires
          if (existingData.boardReviewTier === "Granted by CME Annual") {
             userDataForWrite.boardReviewActive = false;
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
            console.log(`Client-side tier re-evaluation for ${user.uid}: Stored='${storedTier}', NewEffective='${effectiveAccessTier}'. Updating Firestore.`);
            userDataForWrite.accessTier = effectiveAccessTier;
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

// ----------------------------------------------------
// Convenience accessors
function isUserRegistered() {
  return window.authState.isRegistered;
}
function getCurrentUser() {
  return window.authState.user;
}

// ----------------------------------------------------
// Direct email/password registration (not upgrade)
async function registerUser(email, password, username) {
  try {
    console.log(`registerUser: creating ${email}`);
    const { user } = await createUserWithEmailAndPassword(auth, email, password);

    await updateProfile(user, { displayName: username });

    const userDocRef = doc(db, 'users', user.uid);
    // Get marketing opt-in value from the checkbox
const marketingOptInCheckbox = document.getElementById('marketingOptIn');
const marketingOptIn = marketingOptInCheckbox ? marketingOptInCheckbox.checked : false;

await setDoc(
  userDocRef,
  {
    username,
    email,
    isRegistered: true,
    marketingOptIn: marketingOptIn,
    mailerLiteSubscriberId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  },
  { merge: true }
);

    window.authState.user        = user;
    window.authState.isRegistered = true;

    window.dispatchEvent(
      new CustomEvent('authStateChanged', {
        detail: { ...window.authState, isRegistered: true }
      })
    );

    return user;
  } catch (err) {
    console.error('registerUser error:', err);
    throw err;
  }
}

// ----------------------------------------------------
// Upgrade currently anonymous user to permanent account
async function upgradeAnonymousUser(email, password, username) {
  const anonUser = auth.currentUser;

  if (!anonUser || !anonUser.isAnonymous) {
    throw new Error('No anonymous user to upgrade.');
  }

  console.log(`Linking anonymous UID ${anonUser.uid} to ${email}…`);

  try {
    const cred = EmailAuthProvider.credential(email, password);
    const { user: upgradedUser } = await linkWithCredential(anonUser, cred);

    await updateProfile(upgradedUser, { displayName: username });

    const userDocRef = doc(db, 'users', upgradedUser.uid);
    // Get marketing opt-in value from the checkbox
const marketingOptInCheckbox = document.getElementById('marketingOptIn');
const marketingOptIn = marketingOptInCheckbox ? marketingOptInCheckbox.checked : false;

await setDoc(
  userDocRef,
  {
    username,
    email,
    isRegistered: true,
    marketingOptIn: marketingOptIn,
    mailerLiteSubscriberId: null,
    updatedAt: serverTimestamp()
  },
  { merge: true }
);

    window.authState.user        = upgradedUser;
    window.authState.isRegistered = true;

    window.dispatchEvent(
      new CustomEvent('authStateChanged', {
        detail: { ...window.authState, user: upgradedUser, isRegistered: true }
      })
    );

    return upgradedUser;
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
window.authFunctions = {
  isUserRegistered,
  getCurrentUser,
  registerUser,
  loginUser,
  logoutUser,
  upgradeAnonymousUser
};

// Kick things off
initAuth();

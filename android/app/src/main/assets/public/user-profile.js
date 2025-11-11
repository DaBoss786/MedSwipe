// user-profile.js - Fixed version
import { app, auth, db, doc, getDoc, runTransaction, serverTimestamp, collection, getDocs, getIdToken, sendPasswordResetEmail, functions, httpsCallable, updateDoc } from './firebase-config.js'; // Adjust path if needed
import { closeUserMenu } from './utils.js';
import { setHapticsEnabled } from './haptics.js';

  function updateUserProfileUI(authState) {
    // We're skipping the profile creation since you don't want it
    return;
  }

// --- SIMPLIFIED updateUserMenuInfo ---
async function updateUserMenuInfo(authState) {
  const usernameDisplay = document.getElementById('usernameDisplay');
  if (!usernameDisplay) {
      console.warn("usernameDisplay element not found in user menu.");
      return;
  }
  const uidDisplay = document.getElementById('userUidDisplay');
  const uidFooter = uidDisplay ? uidDisplay.parentElement : null;
  if (!uidDisplay) {
      console.warn("userUidDisplay element not found in user menu.");
  }

  if (!authState || !authState.user) {
      usernameDisplay.textContent = 'Guest';
      if (uidDisplay) {
        uidDisplay.textContent = 'UID: Not available';
        uidDisplay.style.display = 'none';
    }
    if (uidFooter) {
        uidFooter.style.display = 'none';
    }
      console.log("User menu username set to 'Guest' by user-profile.js (no authState.user).");
      if (window.authState) {
          window.authState.username = null;
          if (window.authState.user) {
              window.authState.user.displayName = null;
          }
      }
      return;
  }

  const { user } = authState;
  let displayName = null;

  if (typeof authState.username === 'string' && authState.username.trim()) {
      displayName = authState.username.trim();
  }

  if (!displayName) {
      try {
          const userDocRef = doc(db, 'users', user.uid);
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
              const userData = userDocSnap.data() || {};
              const firestoreUsername = userData.username;
              if (typeof firestoreUsername === 'string' && firestoreUsername.trim()) {
                  displayName = firestoreUsername.trim();
              }
              if (typeof userData.hapticsEnabled === 'boolean') {
                  setHapticsEnabled(userData.hapticsEnabled);
                  if (window.authState) {
                      window.authState.hapticsEnabled = userData.hapticsEnabled;
                  }
              } else if (window.authState) {
                  delete window.authState.hapticsEnabled;
              }
          } else if (window.authState) {
              delete window.authState.hapticsEnabled;
          }
      } catch (error) {
          console.error('Error fetching username for user menu:', error);
          if (window.authState) {
              delete window.authState.hapticsEnabled;
          }
      }
  }

  if (!displayName) {
      if (user.isAnonymous) {
          displayName = 'Guest User';
      } else if (typeof user.displayName === 'string' && user.displayName.trim()) {
          displayName = user.displayName.trim();
      } else if (typeof user.email === 'string' && user.email.includes('@')) {
          displayName = user.email.split('@')[0];
      } else {
          displayName = 'Registered User';
      }
  }

  usernameDisplay.textContent = displayName;

  if (uidDisplay) {
    if (user && user.uid) {
        uidDisplay.textContent = `UID: ${user.uid}`;
        uidDisplay.style.display = '';
        if (uidFooter) {
            uidFooter.style.display = '';
        }
    } else {
        uidDisplay.textContent = 'UID: Not available';
        uidDisplay.style.display = 'none';
        if (uidFooter) {
            uidFooter.style.display = 'none';
        }
    }
} else if (uidFooter) {
    uidFooter.style.display = 'none';
}

  if (window.authState) {
      window.authState.username = displayName;
      if (window.authState.user) {
          window.authState.user.displayName = displayName;
      }
  }

  console.log(`User menu username updated by user-profile.js to: ${displayName}`);
}
window.updateUserMenuInfo = updateUserMenuInfo;

// Listen for auth state changes and update UI
window.addEventListener('authStateChanged', function(event) {
  // updateUserProfileUI(event.detail); // This is currently a no-op
  updateUserMenuInfo(event.detail); // Call the simplified version
});

// Initialize UI based on current auth state (if available)
if (window.authState) {
  // updateUserProfileUI(window.authState); // No-op
  updateUserMenuInfo(window.authState); // Call on initial load
}
// ... (keep other event listeners or code in this file if any)

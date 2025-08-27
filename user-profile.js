// user-profile.js - Fixed version
import { app, auth, db, doc, getDoc, runTransaction, serverTimestamp, collection, getDocs, getIdToken, sendPasswordResetEmail, functions, httpsCallable, updateDoc } from './firebase-config.js'; // Adjust path if needed
import { closeUserMenu } from './utils.js';

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

  if (authState.user) { // Check if there's a Firebase user object
      let displayName = 'User'; // Default
      if (authState.user.isAnonymous) {
          // For anonymous users, try to get username from Firestore if it was set
          try {
              const userDocRef = doc(db, 'users', authState.user.uid);
              const userDocSnap = await getDoc(userDocRef);
              if (userDocSnap.exists() && userDocSnap.data().username) {
                  displayName = userDocSnap.data().username;
              } else {
                  displayName = 'Guest User'; // Fallback if no username in Firestore
              }
          } catch (error) {
              console.error("Error fetching username for anonymous user:", error);
              displayName = 'Guest User';
          }
      } else { // Registered user
          displayName = authState.user.displayName || authState.user.email || 'Registered User';
      }
      usernameDisplay.textContent = displayName;
      console.log(`User menu username updated by user-profile.js to: ${displayName}`);
  } else {
      // Should ideally not happen if auth.js always ensures an anonymous user
      usernameDisplay.textContent = 'Guest';
      console.log("User menu username set to 'Guest' by user-profile.js (no authState.user).");
  }

  // NOTE: All logic for adding/removing <li> items (Logout, Register, Login, Subscribe, Manage Sub)
  // has been REMOVED from here. This will now be handled by updateUserMenu() in user.js.
  // The visibility of manageSubscriptionBtn will also be handled there.
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

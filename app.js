// app.js - Top of file
import { app, auth, db, doc, getDoc, runTransaction, serverTimestamp, collection, getDocs, getIdToken, sendPasswordResetEmail, functions, httpsCallable, updateDoc, addDoc, query, where, analytics, logEvent, setUserProperties, onAuthStateChanged } from './firebase-config.js'; // Adjust path if needed
// Import needed functions from user.js
import { updateUserXP, updateUserMenu, calculateLevelProgress, getLevelInfo, toggleBookmark, saveOnboardingSelections } from './user.v2.js';
import { loadQuestions, initializeQuiz, fetchQuestionBank } from './quiz.js';
import { showLeaderboard, showAbout, showFAQ, showContactModal } from './ui.js';
import { closeSideMenu, closeUserMenu, shuffleArray, getCurrentQuestionId } from './utils.js';
import { displayPerformance } from './stats.js';

/**
 * Checks the URL for a question deep link and initializes a single-question quiz if found.
 * @returns {Promise<boolean>} - Returns true if a deep link was handled, false otherwise.
 */
async function handleDeepLink() {
  const hash = window.location.hash;

  // 1. Check if the URL is a question deep link
  if (!hash.startsWith('#/question/')) {
    return false; // Not a deep link, let the app start normally.
  }

  // --- START OF NEW, SECURE LOGIC ---
  console.log("Deep link detected. Waiting for authentication to be ready...");

  // This function creates a Promise that resolves only when Firebase Auth
  // has established a user session (even an anonymous one).
  const waitForAuthReady = () => {
    return new Promise((resolve) => {
      // If auth is already ready, resolve immediately.
      if (auth.currentUser) {
        console.log("Auth is already ready for deep link.");
        resolve();
        return;
      }
      // Otherwise, set up a one-time listener.
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
          console.log("Auth state changed to ready for deep link. User:", user.uid);
          unsubscribe(); // Important: remove the listener to avoid memory leaks.
          resolve();
        }
      });
    });
  };

  // Wait for the auth session to be ready before proceeding.
  await waitForAuthReady();
  // --- END OF NEW, SECURE LOGIC ---


  // Extract the Question ID from the URL. The ID is the full question text.
  // decodeURIComponent is important in case the question has special characters like '?'
  const questionId = decodeURIComponent(hash.substring('#/question/'.length));

  if (!questionId) {
    return false; // Invalid link format.
  }

  console.log("Auth is ready. Fetching question:", questionId);

  try {
    // 2. Fetch only this specific question from Firestore.
    // This query will now succeed because request.auth is guaranteed to be non-null.
    const questionsCollectionRef = collection(db, 'questions');
    const q = query(questionsCollectionRef, where("Question", "==", questionId), where("Free", "==", true));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      // This means the question ID didn't exist or wasn't marked as "Free".
      throw new Error("This question could not be found or is not available via direct link. It may have been updated or removed.");
    }

    // 3. Prepare the question data for the quiz.
    const questionData = querySnapshot.docs[0].data();
    const questionArray = [questionData]; // initializeQuiz needs an array, even if it's just one.

    // 4. Hide all other screens and show the quiz UI.
    // This ensures no welcome screens, modals, or dashboards appear.
    ensureAllScreensHidden();
    initializeQuiz(questionArray, 'deep_link'); // Start the quiz with just our one question.

    // 5. (Optional but Recommended) Clean up the URL.
    // This prevents the deep link from being triggered again if the user reloads the page.
    // It removes the `#/question/...` part from the URL in the browser's address bar without reloading.
    history.pushState("", document.title, window.location.pathname + window.location.search);

    return true; // Let the app know that the deep link was successfully handled.

  } catch (error) {
    console.error("Error handling deep link:", error);
    alert(error.message); // Show the specific error message to the user.

    // If something went wrong, send the user to the main dashboard.
    ensureAllScreensHidden();
    const mainOptions = document.getElementById("mainOptions");
    if (mainOptions) mainOptions.style.display = "flex";

    return true; // We still "handled" the link, even though it was an error.
  }
}

// Initialize the cloud function handle
let getLeaderboardDataFunctionApp;
try {
  getLeaderboardDataFunctionApp = httpsCallable(functions, 'getLeaderboardData');
  console.log("✅ getLeaderboardDataFunctionApp initialized");
} catch (err) {
  console.error("❌ Error initializing getLeaderboardDataFunctionApp:", err);
}

// --- End Callable Function Reference ---

let selectedSpecialty = null;
let selectedExperienceLevel = null;

// --- Get reference to Firebase Callable Function ---
let createCheckoutSessionFunction;
let createPortalSessionFunction;
let getCertificateDownloadUrlFunction;
try {
    if (functions && httpsCallable) { // Check if imports exist
         createCheckoutSessionFunction = httpsCallable(functions, 'createStripeCheckoutSession');
         createPortalSessionFunction = httpsCallable(functions, 'createStripePortalSession');
         getCertificateDownloadUrlFunction = httpsCallable(functions, 'getCertificateDownloadUrl');
         console.log("Callable function reference 'createStripeCheckoutSession' created.");
    } else {
         console.error("Firebase Functions or httpsCallable not imported correctly.");
         // Disable checkout button maybe?
    }
} catch(error) {
     console.error("Error getting callable function reference:", error);
     // Disable checkout button maybe?
}
// ---

let currentFeedbackQuestionId = ""; // Declare with let
let currentFeedbackQuestionText = ""; // Declare with le

window.getActiveCmeYearIdFromFirestore = async function() {
  if (!db) { // db should be imported from firebase-config.js and available here
      console.error("Firestore (db) not initialized for getActiveCmeYearIdFromFirestore");
      return null;
  }
  const now = new Date(); 
  const cmeWindowsRef = collection(db, "cmeWindows");

  try {
      // Use the aliased getFirestoreDocs if you aliased it, otherwise getDocs
      const snapshot = await (typeof getFirestoreDocs === 'function' ? getFirestoreDocs(cmeWindowsRef) : getDocs(cmeWindowsRef));
      if (snapshot.empty) {
          console.warn("Client: No CME windows defined in 'cmeWindows' collection.");
          return null;
      }

      for (const docSnap of snapshot.docs) {
          const windowData = docSnap.data();
          if (windowData.startDate && windowData.endDate) {
              const startDate = windowData.startDate.toDate ? windowData.startDate.toDate() : new Date(windowData.startDate);
              const endDate = windowData.endDate.toDate ? windowData.endDate.toDate() : new Date(windowData.endDate);

              if (now >= startDate && now <= endDate) {
                  console.log(`Client: Active CME window found: ${docSnap.id}`);
                  return docSnap.id;
              }
          } else {
              console.warn(`Client: CME window ${docSnap.id} is missing startDate or endDate.`);
          }
      }
      console.log("Client: No currently active CME window found for today's date.");
      return null;
  } catch (error) {
      console.error("Client: Error fetching active CME year ID:", error);
      return null; 
  }
}

// Add splash screen, welcome screen, and authentication-based routing
document.addEventListener('DOMContentLoaded', async function() { // <-- Made this async
  // --- START OF NEW LOGIC ---
  // First, check if the URL is a deep link.
  const isDeepLinkHandled = await handleDeepLink();

  // If a deep link was found and handled, we stop here to prevent
  // the normal app startup (welcome screens, etc.) from running.
  if (isDeepLinkHandled) {
    console.log("Deep link was handled. Halting normal startup sequence.");
    return;
  }
  // --- END OF NEW LOGIC ---
  try {
    // Ensure imported 'functions' instance exists
    if (typeof functions === 'undefined') {
        throw new Error("Imported 'functions' instance is undefined.");
    }
    // Ensure imported 'httpsCallable' exists
    if (typeof httpsCallable === 'undefined') {
        throw new Error("Imported 'httpsCallable' function is undefined.");
    }

    window.generateCmeCertificateFunction = httpsCallable(functions, 'generateCmeCertificate');
    console.log("Callable function reference created globally using imported instance.");
} catch (error) {
    console.error("Error creating callable function reference:", error);
    // Handle error - maybe disable the claim button?
}

  const splashScreen = document.getElementById('splashScreen');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const mainOptions = document.getElementById('mainOptions');

  // Immediately hide the dashboard to prevent it from being visible at any point
  if (mainOptions) {
    mainOptions.style.display = 'none';
  }
  
  // Ensure welcome screen is ready but hidden
  if (welcomeScreen) {
    welcomeScreen.style.display = 'flex';
    welcomeScreen.style.opacity = '0';
  }

  // --- NEW element references for Specialty Screen ---
  const specialtyPickScreen = document.getElementById('specialtyPickScreen');
  const specialtyContinueBtn = document.getElementById('specialtyContinueBtn');
  const specialtyOptionCards = document.querySelectorAll('#specialtyPickScreen .onboarding-option-card');
  // --- END NEW element references ---

  // --- NEW element references for Experience Screen ---
  const experiencePickScreen = document.getElementById('experiencePickScreen'); // <<<--- ADD
  const experienceContinueBtn = document.getElementById('experienceContinueBtn'); // <<<--- ADD
  const experienceOptionButtons = document.querySelectorAll('#experiencePickScreen .onboarding-option-button'); // <<<--- ADD
  // --- END NEW element references ---

  // Initialize window properties if they don't exist, to be safe
  if (typeof window.selectedSpecialty === 'undefined') {
    window.selectedSpecialty = null;
  }
  if (typeof window.selectedExperienceLevel === 'undefined') {
    window.selectedExperienceLevel = null;
  }
  
  // Update the auth state change listener to properly handle welcome screen
window.addEventListener('authStateChanged', function(event) {
  console.log('Auth state changed in app.js:', event.detail);
  window.authState = event.detail; 
  // Log the accessTier received from the event
  console.log('Access Tier from event.detail:', event.detail.accessTier);

if (analytics && event.detail.accessTier) {
  setUserProperties(analytics, {
    access_tier: event.detail.accessTier 
  });
  console.log(`GA User Property 'access_tier' set to: ${event.detail.accessTier}`);
}

  if (event.detail.user && event.detail.user.isAnonymous && !event.detail.isRegistered) {
    // This condition might need review. If a user logs out, they become anonymous.
    // cleanupOnLogout() is good here.
    cleanupOnLogout();
  }
  
  // Once authentication is initialized and not loading (isLoading is false)
  if (!event.detail.isLoading) {
    // Hide splash screen after 2 seconds
    setTimeout(function() {
      // --- START: New logic to handle direct registration link ---
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('register') === 'true') {
    console.log("Direct registration link detected. Showing registration form.");
    
    // Hide the splash screen immediately
    const splashScreen = document.getElementById('splashScreen');
    if (splashScreen) {
        splashScreen.style.display = 'none';
    }
    
    // Ensure all other main screens are hidden
    if (typeof ensureAllScreensHidden === 'function') {
        ensureAllScreensHidden(); 
    }
    
    // Show the registration form
    if (typeof showRegisterForm === 'function') {
        showRegisterForm();
    } else if (typeof window.showRegisterForm === 'function') {
        window.showRegisterForm();
    }
    
    // IMPORTANT: Stop further execution to prevent the welcome screen from showing
    return; 
}
// --- END: New logic ---
      const splashScreen = document.getElementById('splashScreen');
      if (splashScreen) {
        splashScreen.classList.add('fade-out');
        
        setTimeout(function() {
          splashScreen.style.display = 'none';
          
          ensureAllScreensHidden(); // Make sure all other primary screens are hidden
          
          const mainOptions = document.getElementById('mainOptions');
          const welcomeScreen = document.getElementById('welcomeScreen');
          const newPaywallScreen = document.getElementById('newPaywallScreen'); // Get paywall

          // --- START: MODIFIED ROUTING LOGIC ---
          // In app.js, inside the authStateChanged listener's setTimeout - NEW if/else block
if (event.detail.isRegistered) {
  // --- This is the new, smarter routing logic ---

  // 1. Check if a promotion was just successfully applied.
  const promoApplied = sessionStorage.getItem('promoApplied');
  if (promoApplied) {
      alert('Congratulations! Your promotional access has been successfully applied.');
      sessionStorage.removeItem('promoApplied'); // Clean up the flag
  }

  const accessTier = event.detail.accessTier;
  console.log(`Registered user detected. Access Tier: [${accessTier}]. Routing...`);

  // 2. If the user has a paid or promotional tier, always show the main dashboard.
  if (accessTier === "board_review" || accessTier === "cme_annual" || accessTier === "cme_credits_only") {
      console.log('User has a premium tier. Showing main dashboard.');
      ensureAllScreensHidden();
      if (mainOptions) {
          mainOptions.style.display = 'flex';
          // Initialize dashboard components
          setTimeout(() => {
              if (typeof forceReinitializeDashboard === 'function') forceReinitializeDashboard();
              else if (typeof initializeDashboard === 'function') initializeDashboard();
          }, 100);
      }
  } else {
      // 3. If the user is a new "free_guest", check for a pending redirect "note".
      const pendingRedirect = sessionStorage.getItem('pendingRedirectAfterRegistration');
      console.log(`User is free_guest. Checking for pending redirect note: [${pendingRedirect}]`);

      // IMPORTANT: Clean up the note immediately after reading it.
      if (pendingRedirect) {
          sessionStorage.removeItem('pendingRedirectAfterRegistration');
      }

      // Use the note to decide where to go.
      switch (pendingRedirect) {
          case 'board_review_pricing':
              console.log('Redirecting to Board Review Pricing screen.');
              ensureAllScreensHidden();
              const boardReviewPricingScreen = document.getElementById("boardReviewPricingScreen");
              if (boardReviewPricingScreen) {
                  boardReviewPricingScreen.style.display = 'flex';
                  if (typeof updateBoardReviewPricingView === 'function') {
                      updateBoardReviewPricingView('annual');
                  }
              }
              break;

          case 'cme_pricing':
              console.log('Redirecting to CME Pricing screen.');
              ensureAllScreensHidden();
              const cmePricingScreen = document.getElementById("cmePricingScreen");
              if (cmePricingScreen) {
                  cmePricingScreen.style.display = 'flex';
              }
              break;

          case 'cme_info':
              console.log('Redirecting to CME Info screen.');
              ensureAllScreensHidden();
              const cmeInfoScreen = document.getElementById("cmeInfoScreen");
              if (cmeInfoScreen) {
                  cmeInfoScreen.style.display = "flex";
              }
              break;

          default:
              // 4. If there's no note, show the main paywall as the default for new users.
              console.log('No pending redirect note found. Showing main paywall screen.');
              ensureAllScreensHidden();
              if (newPaywallScreen) {
                  newPaywallScreen.style.display = 'flex';
              }
              break;
      }
  }
} else {
  // This part remains the same: if user is not registered, show the welcome screen.
  console.log('User is anonymous guest. Showing welcome screen.');
  ensureAllScreensHidden();
  if (welcomeScreen) {
      welcomeScreen.style.display = 'flex';
      welcomeScreen.style.opacity = '1';
  }
}
        // --- END: MODIFIED ROUTING LOGIC ---

          // --- ALWAYS CALL updateUserMenu AFTER ROUTING DECISION AND UI UPDATE ---
          // This ensures the menu reflects the latest state, including accessTier.
          console.log('Calling updateUserMenu after UI routing decision.');
          if (typeof window.updateUserMenu === 'function') {
            window.updateUserMenu();
          } else {
            console.warn('updateUserMenu function not found on window.');
            // If updateUserMenu is directly imported and used in app.js, you might call it directly:
            // if (typeof updateUserMenu === 'function') updateUserMenu();
          }
          // Also, ensure other UI elements that depend on auth state are updated
          if (typeof window.updateUserXP === 'function') { // If updateUserXP also updates some UI
             window.updateUserXP();
          }


        }, 500); // Matches the transition duration in CSS
      } else {
        // If splashScreen is not found, but auth is loaded, proceed with routing and menu update
        ensureAllScreensHidden();
        const mainOptions = document.getElementById('mainOptions');
        const welcomeScreen = document.getElementById('welcomeScreen');
        const newPaywallScreen = document.getElementById('newPaywallScreen');

        // --- START: DUPLICATED MODIFIED ROUTING LOGIC (for no splash screen path) ---
        if (event.detail.isRegistered) {
          const accessTier = event.detail.accessTier;
          console.log(`Registered user (no splash). Access Tier: ${accessTier}. Routing...`);

          if (accessTier === "board_review" || accessTier === "cme_annual" || accessTier === "cme_credits_only") {
              console.log('User has a paying tier (no splash). Showing main dashboard.');
              if (mainOptions) {
                  mainOptions.style.display = 'flex';
                  setTimeout(() => {
                      if (typeof forceReinitializeDashboard === 'function') forceReinitializeDashboard();
                      else if (typeof initializeDashboard === 'function') initializeDashboard();
                  }, 100);
              }
            } else { // accessTier is "free_guest"
              console.log('Registered user is "free_guest" (no splash). Checking for pending redirect...');
              
              // Check if there's a pending redirect after registration
              const pendingRedirect = sessionStorage.getItem('pendingRedirectAfterRegistration');
              
              if (pendingRedirect === 'cme_info') {
                  console.log('Redirecting to CME Info Screen after registration (no splash).');
                  sessionStorage.removeItem('pendingRedirectAfterRegistration');
                  const cmeInfoScreen = document.getElementById("cmeInfoScreen");
                  if (cmeInfoScreen) {
                      cmeInfoScreen.style.display = "flex";
                      const postRegLoadingScreen = document.getElementById('postRegistrationLoadingScreen');
                      if (postRegLoadingScreen) postRegLoadingScreen.style.display = 'none';
                  } else {
                      console.error("CME Info Screen not found after registration redirect (no splash)!");
                      if (newPaywallScreen) newPaywallScreen.style.display = 'flex';
                  }
              } else if (pendingRedirect === 'board_review_pricing') {
                  console.log('Redirecting to Board Review Pricing Screen after registration (no splash).');
                  sessionStorage.removeItem('pendingRedirectAfterRegistration');
                  const boardReviewPricingScreen = document.getElementById("boardReviewPricingScreen");
                  if (boardReviewPricingScreen) {
                      boardReviewPricingScreen.style.display = 'flex';
                      const postRegLoadingScreen = document.getElementById('postRegistrationLoadingScreen');
                      if (postRegLoadingScreen) postRegLoadingScreen.style.display = 'none';
                      if (typeof updateBoardReviewPricingView === 'function') {
                          updateBoardReviewPricingView('annual');
                      }
                  } else {
                      console.error("Board Review Pricing Screen not found after registration redirect (no splash)!");
                      if (newPaywallScreen) newPaywallScreen.style.display = 'flex';
                  }
              } else if (pendingRedirect === 'cme_pricing') { // <<<--- MODIFICATION STARTS HERE
                  console.log('Redirecting to CME Pricing Screen after registration (no splash).');
                  sessionStorage.removeItem('pendingRedirectAfterRegistration');
                  ensureAllScreensHidden(); // Ensure other screens are hidden
                  const cmePricingScreen = document.getElementById("cmePricingScreen");
                  if (cmePricingScreen) {
                      cmePricingScreen.style.display = 'flex'; // Or 'block' based on your CSS
                      // Optional: if you have a function to set the default tab for CME pricing
                      // if (typeof updateCmePricingTabView === 'function') {
                      //     updateCmePricingTabView('annual'); // Or your desired default
                      // }
                  } else {
                      console.error("CME Pricing Screen not found after registration redirect (no splash)!");
                      // Fallback if pricing screen is missing
                      if (newPaywallScreen) {
                          newPaywallScreen.style.display = 'flex';
                      } else if (mainOptions) { // Assuming mainOptions is defined in this scope
                          mainOptions.style.display = 'flex';
                      }
                  }
              } else { // <<<--- MODIFICATION ENDS HERE (original else continues)
                  console.log('No pending redirect (no splash). Showing main paywall screen.');
                  if (newPaywallScreen) {
                      newPaywallScreen.style.display = 'flex';
                  } else {
                       if (welcomeScreen) { // Assuming welcomeScreen is defined in this scope
                          welcomeScreen.style.display = 'flex';
                          welcomeScreen.style.opacity = '1';
                      }
                  }
              }
          }
      } else { // User is not registered (anonymous)
          console.log('User is anonymous guest (no splash). Showing welcome screen.');
          if (welcomeScreen) { // Assuming welcomeScreen is defined in this scope
              welcomeScreen.style.display = 'flex';
              welcomeScreen.style.opacity = '1';
          }
      }
    // --- END: DUPLICATED MODIFIED ROUTING LOGIC ---
        
        console.log('Calling updateUserMenu (no splash screen path).');
        if (typeof window.updateUserMenu === 'function') {
            window.updateUserMenu();
        }
         if (typeof window.updateUserXP === 'function') {
             window.updateUserXP();
          }
      }
    }, 2000); // Delay for splash screen
  } else {
    console.log('Auth state still loading or event.detail.isLoading is true.');
  }
});
  
  // Handle welcome screen buttons
  const startLearningBtn = document.getElementById('startLearningBtn');
  const existingAccountBtn = document.getElementById('existingAccountBtn');

  if (startLearningBtn && welcomeScreen && specialtyPickScreen) { // Added specialtyPickScreen check
    startLearningBtn.addEventListener("click", function() {
      console.log("Start Learning button clicked, showing Specialty Pick screen.");
      welcomeScreen.style.opacity = '0';
      setTimeout(function() {
        welcomeScreen.style.display = 'none';
        specialtyPickScreen.style.display = 'flex'; // Show specialty screen
        specialtyPickScreen.style.opacity = '1';
      }, 500);
    });
  }

  if (existingAccountBtn) {
  existingAccountBtn.addEventListener('click', function() {
    console.log("'I already have an account' button clicked");
    const welcomeScreen = document.getElementById('welcomeScreen');
    
    if (welcomeScreen) {
      // Fade out welcome screen
      welcomeScreen.style.opacity = '0';
      
      setTimeout(function() {
        // Hide welcome screen
        welcomeScreen.style.display = 'none';
        
        // Show the login form with back button (true = from welcome screen)
        showLoginForm(true);
      }, 500);
    }
  });
}

// --- Specialty Screen Logic ---
if (specialtyOptionCards.length > 0 && specialtyContinueBtn) {
  specialtyOptionCards.forEach(card => {
    card.addEventListener('click', function() {
      if (this.classList.contains('disabled-option')) return;

      specialtyOptionCards.forEach(c => c.classList.remove('selected'));
      this.classList.add('selected');
      
      window.selectedSpecialty = this.dataset.specialty; // Set on window
      console.log("Specialty selected and set on window:", window.selectedSpecialty);
      
      // Directly enable/disable based on window.selectedSpecialty
      specialtyContinueBtn.disabled = !window.selectedSpecialty; 
    });
  });

  // Ensure continue button state is correct on load (it's disabled by default in HTML)
  specialtyContinueBtn.disabled = !window.selectedSpecialty;
}

if (specialtyContinueBtn && specialtyPickScreen && experiencePickScreen) {
  specialtyContinueBtn.addEventListener('click', function() {
    console.log("Specialty Continue Btn Clicked. Current window.selectedSpecialty:", window.selectedSpecialty); // Debug log
    
    if (!window.selectedSpecialty) { // Check window.selectedSpecialty
      alert("Please select a specialty."); // This is the alert you're seeing
      return;
    }
    
    console.log("Proceeding from Specialty screen. Specialty:", window.selectedSpecialty);
    specialtyPickScreen.style.opacity = '0';
    setTimeout(function() {
      specialtyPickScreen.style.display = 'none';
      experiencePickScreen.style.display = 'flex';
      experiencePickScreen.style.opacity = '1';
      // Reset experience selection when showing this screen
      window.selectedExperienceLevel = null;
      experienceOptionButtons.forEach(b => b.classList.remove('selected'));
      if(experienceContinueBtn) experienceContinueBtn.disabled = true;
    }, 500);
  });
}

// --- Experience Screen Logic ---
if (experienceOptionButtons.length > 0 && experienceContinueBtn) {
  experienceOptionButtons.forEach(button => {
    button.addEventListener('click', function() {
      experienceOptionButtons.forEach(b => b.classList.remove('selected'));
      this.classList.add('selected');
      
      window.selectedExperienceLevel = this.dataset.experience; // Set on window
      console.log("Experience selected and set on window:", window.selectedExperienceLevel);
      
      experienceContinueBtn.disabled = !window.selectedExperienceLevel;
    });
  });
  // Ensure continue button state is correct on load
  experienceContinueBtn.disabled = !window.selectedExperienceLevel;
}

if (experienceContinueBtn && experiencePickScreen && onboardingLoadingScreen) {
  experienceContinueBtn.addEventListener('click', async function() {
    console.log("Experience Continue Btn Clicked. Current window.selectedExperienceLevel:", window.selectedExperienceLevel, "Current window.selectedSpecialty:", window.selectedSpecialty);

    if (!window.selectedExperienceLevel) {
      alert("Please select your experience level.");
      return;
    }
    if (!window.selectedSpecialty) {
      alert("Specialty not selected. Please go back and select a specialty.");
      // Code to go back to specialty screen
      experiencePickScreen.style.opacity = '0';
      setTimeout(() => {
          experiencePickScreen.style.display = 'none';
          if (specialtyPickScreen) {
              specialtyPickScreen.style.display = 'flex';
              specialtyPickScreen.style.opacity = '1';
          }
      }, 500);
      return;
    }
    
    this.disabled = true;
    this.textContent = "Saving...";

    try {
      await saveOnboardingSelections(window.selectedSpecialty, window.selectedExperienceLevel);
      console.log("Successfully saved onboarding selections to Firestore.");

      if (analytics && window.selectedSpecialty) {
        setUserProperties(analytics, {
          user_specialty: window.selectedSpecialty
        });
        console.log(`GA User Property 'user_specialty' set to: ${window.selectedSpecialty}`);
      }

      experiencePickScreen.style.opacity = '0';
      setTimeout(function() {
        experiencePickScreen.style.display = 'none';
        onboardingLoadingScreen.style.display = 'flex';
        setTimeout(function() {
          onboardingLoadingScreen.style.display = 'none';
          if (typeof startOnboardingQuiz === 'function') startOnboardingQuiz();
          else if (typeof window.startOnboardingQuiz === 'function') window.startOnboardingQuiz();
          else console.error("startOnboardingQuiz function not found!");
        }, 2000);
      }, 500);

    } catch (error) {
      console.error("Failed to save onboarding selections:", error);
      alert("There was an error saving your selections. Please try again.");
      this.disabled = false;
      this.textContent = "Continue";
    }
  });
}


  // Function to start the onboarding quiz with 3 questions
  function startOnboardingQuiz() {
    // Start a 3-question quiz
    loadQuestions({
      type: 'random',
      num: 3,
      includeAnswered: false,
      isOnboarding: true  // Flag to indicate this is the onboarding quiz
    });
  }

  window.startOnboardingQuiz = startOnboardingQuiz; // Make global if defined locally

// --- Event Listener for New Paywall "Continue as Guest" Button ---
const continueFreeAccessBtn = document.getElementById("continueFreeAccessBtn");
if (continueFreeAccessBtn) {
    continueFreeAccessBtn.addEventListener("click", function() {
        console.log("Paywall 'Continue as Guest' button clicked.");

        const newPaywallScreen = document.getElementById("newPaywallScreen");
        const mainOptions = document.getElementById("mainOptions"); // Your main dashboard view

        // Hide the paywall screen
        if (newPaywallScreen) {
            newPaywallScreen.style.display = "none";
        }

        // Show the main dashboard
        if (mainOptions) {
            mainOptions.style.display = "flex"; // Or "block"
            // Ensure dashboard is initialized if it's the first time
            // (initializeDashboard might already be called on auth state change,
            // but an explicit call here can ensure UI elements are up-to-date for a guest)
            if (typeof initializeDashboard === 'function') {
                initializeDashboard();
            }
            // Ensure event listeners for dashboard elements are attached
            if (typeof setupDashboardEventListenersExplicitly === 'function') {
                setupDashboardEventListenersExplicitly();
            } else if (typeof setupDashboardEvents === 'function') {
                setupDashboardEvents();
            }

        } else {
            console.error("Main options element (#mainOptions) not found.");
        }

        // Future: Here we would also set a flag or state indicating the user is "free_access_guest"
        // to apply limitations on the dashboard. For now, it just navigates.
    });
} else {
    console.error("Button with ID 'continueFreeAccessBtn' not found.");
}

// --- Quiz Setup Modal (quizSetupModal) - Click Outside to Close ---
const quizSetupModal = document.getElementById("quizSetupModal");

if (quizSetupModal) {
    quizSetupModal.addEventListener('click', function(event) {
        // Check if the click was directly on the modal background itself
        // (i.e., event.target is the modal div with ID quizSetupModal,
        // and NOT an element inside it like a button, input, label, etc.).
        if (event.target === quizSetupModal) {
            console.log("Quiz Setup Modal background (event.target === quizSetupModal) clicked, closing modal.");
            quizSetupModal.style.display = 'none'; // Hide the modal
        }
    });
    console.log("Click-outside-to-close listener attached to #quizSetupModal.");
} else {
    console.error("Quiz Setup Modal (#quizSetupModal) not found for click-outside listener setup.");
}
// --- End Quiz Setup Modal - Click Outside to Close ---

// Add event listener for the CME Dashboard's back button
const cmeDashboardBackBtn = document.getElementById("cmeDashboardBackBtn");
if(cmeDashboardBackBtn) {
    cmeDashboardBackBtn.addEventListener("click", function() {
        console.log("CME Dashboard Back button clicked."); // For debugging
        const cmeDashboard = document.getElementById("cmeDashboardView");
        const mainOptions = document.getElementById("mainOptions"); // Assuming this is your main dashboard view ID

        if (cmeDashboard) {
            cmeDashboard.style.display = "none";
        }
        // Ensure mainOptions exists before trying to show it
        if (mainOptions) {
            mainOptions.style.display = "flex"; // Show main options again
            showMainToolbarInfo();
        } else {
             console.error("Main options element (#mainOptions) not found when going back.");
        }
    });
} else {
     console.error("CME Dashboard Back button (#cmeDashboardBackBtn) not found.");
}

// --- Step 5a: Activate Start CME Quiz Button ---

const startCmeQuizBtn = document.getElementById("startCmeQuizBtn");
if (startCmeQuizBtn) {
    startCmeQuizBtn.addEventListener("click", function() {
        console.log("Start CME Quiz button clicked."); // For debugging
        const cmeQuizSetupModal = document.getElementById("cmeQuizSetupModal");
        if (cmeQuizSetupModal) {
            // Populate categories before showing
            populateCmeCategoryDropdown(); // Call the function to fill the dropdown
            cmeQuizSetupModal.style.display = "block"; // Show the modal
        } else {
            console.error("CME Quiz Setup Modal (#cmeQuizSetupModal) not found.");
        }
    });
} else {
    console.error("Start CME Quiz button (#startCmeQuizBtn) not found.");
}

// Add listeners for the modal's own buttons (Cancel)
const modalCancelCmeQuizBtn = document.getElementById("modalCancelCmeQuizBtn");
if (modalCancelCmeQuizBtn) {
    modalCancelCmeQuizBtn.addEventListener("click", function() {
        const cmeQuizSetupModal = document.getElementById("cmeQuizSetupModal");
        if (cmeQuizSetupModal) {
            cmeQuizSetupModal.style.display = "none"; // Hide the modal
        }
    });
}
// --- Step 7: Handle Start CME Quiz button click from Modal ---

const modalStartCmeQuizBtn = document.getElementById("modalStartCmeQuizBtn");
if (modalStartCmeQuizBtn) {
    modalStartCmeQuizBtn.addEventListener("click", function() {
        console.log("Modal Start CME Quiz button clicked."); // For debugging

        // Get the selected options from the modal
        const categorySelect = document.getElementById("cmeCategorySelect");
        const numQuestionsInput = document.getElementById("cmeNumQuestions");
        const includeAnsweredCheckbox = document.getElementById("cmeIncludeAnsweredCheckbox");

        const selectedCategory = categorySelect ? categorySelect.value : "";
        // Ensure numQuestions is read correctly and parsed as an integer
        let numQuestions = numQuestionsInput ? parseInt(numQuestionsInput.value, 10) : 12; // Base 10 parse

        // --- UPDATED VALIDATION ---
        // Validate the parsed number (allow 1 to 50)
        if (isNaN(numQuestions) || numQuestions < 1) { // Check if Not-a-Number or less than 1
            console.warn(`Invalid number input (${numQuestionsInput.value}), defaulting to 12.`);
            numQuestions = 12; // Default to 12 if parsing fails or below min
        } else if (numQuestions > 50) { // Check if greater than 50
             console.warn(`Number input (${numQuestionsInput.value}) exceeds max 50, capping at 50.`);
             numQuestions = 50; // Cap at max limit
        }
        // No need for Math.max(3, ...) anymore

        const includeAnswered = includeAnsweredCheckbox ? includeAnsweredCheckbox.checked : false;

        console.log("CME Quiz Options:", { // Log the FINAL options being passed
            quizType: 'cme',
            category: selectedCategory,
            num: numQuestions, // Ensure this logs the correct number
            includeAnswered: includeAnswered
        });

        // Hide the setup modal
        const cmeQuizSetupModal = document.getElementById("cmeQuizSetupModal");
        if (cmeQuizSetupModal) {
            cmeQuizSetupModal.style.display = "none";
        }

        // Hide the CME Dashboard view itself
        const cmeDashboard = document.getElementById("cmeDashboardView");
         if (cmeDashboard) {
             cmeDashboard.style.display = "none";
         }

        // Call loadQuestions with the CME options
        // Make sure loadQuestions is accessible (it should be if defined in quiz.js which is loaded)
        if (typeof loadQuestions === 'function') {
            loadQuestions({
                quizType: 'cme', // Specify the quiz type
                category: selectedCategory,
                num: numQuestions,
                includeAnswered: includeAnswered
            });
        } else {
            console.error("loadQuestions function is not defined or accessible.");
            alert("Error starting CME quiz. Function not found.");
             // Show CME dashboard again as fallback
             if (cmeDashboard) cmeDashboard.style.display = "block";
        }
    });
} else {
    console.error("Modal Start CME Quiz button (#modalStartCmeQuizBtn) not found.");
}

// --- End of Step 7 Code ---

// --- Event Listener for "Review Incorrect CME Questions" Button ---
const reviewIncorrectCmeBtn = document.getElementById("reviewIncorrectCmeBtn");
if (reviewIncorrectCmeBtn) {
    reviewIncorrectCmeBtn.addEventListener("click", async function() {
        console.log("Review Incorrect CME Questions button clicked.");

        if (!auth || !auth.currentUser || auth.currentUser.isAnonymous) {
            alert("Please log in to review your incorrect CME questions.");
            return;
        }
        const uid = auth.currentUser.uid;

        // 1. Get the active CME year ID
        let activeCmeYear = window.clientActiveCmeYearId;
        if (!activeCmeYear) {
            if (typeof window.getActiveCmeYearIdFromFirestore === 'function') {
                activeCmeYear = await window.getActiveCmeYearIdFromFirestore();
                if (activeCmeYear && typeof window.setActiveCmeYearClientSide === 'function') {
                    window.setActiveCmeYearClientSide(activeCmeYear);
                }
            }
        }

        if (!activeCmeYear) {
            alert("Could not determine the current CME year. Please try answering a CME question first or check back later.");
            return;
        }
        console.log(`Fetching incorrect CME answers for user ${uid}, year ${activeCmeYear}`);

        // 2. Fetch incorrect question IDs for the current year
        const incorrectQuestionOriginalIds = [];
        try {
            const cmeAnswersCollectionRef = collection(db, 'users', uid, 'cmeAnswers');
            // Query for documents in the current year that are marked as incorrect
            const q = query(cmeAnswersCollectionRef,
                            where('__name__', '>=', `${activeCmeYear}_`),
                            where('__name__', '<', `${activeCmeYear}_\uffff`),
                            where('isCorrect', '==', false)
                           );
            const querySnapshot = await getDocs(q);

            querySnapshot.forEach((docSnap) => {
                const answerData = docSnap.data();
                if (answerData.originalQuestionId) {
                    incorrectQuestionOriginalIds.push(answerData.originalQuestionId.trim());
                }
            });

            console.log(`Found ${incorrectQuestionOriginalIds.length} incorrect CME questions for year ${activeCmeYear}.`);

        } catch (error) {
            console.error("Error fetching incorrect CME question IDs:", error);
            alert("An error occurred while fetching your incorrect questions. Please try again.");
            return;
        }

        // 3. Handle if no incorrect questions are found
        if (incorrectQuestionOriginalIds.length === 0) {
            alert("Great job! You have no incorrect CME questions to review for the current year.");
            return;
        }

        // 4. Hide CME Dashboard and load quiz with these specific questions
        const cmeDashboard = document.getElementById("cmeDashboardView");
        if (cmeDashboard) {
            cmeDashboard.style.display = "none";
        }

        if (typeof loadQuestions === 'function') { // loadQuestions is from quiz.js
            loadQuestions({
                quizType: 'cme', // Still a CME quiz for recording purposes
                reviewIncorrectCmeOnly: true,
                incorrectCmeQuestionIds: incorrectQuestionOriginalIds, // Pass the IDs
                num: incorrectQuestionOriginalIds.length, // Load all of them
                includeAnswered: true // Important: We want to re-attempt these specific questions
            });
        } else {
            console.error("loadQuestions function is not defined or accessible.");
            alert("Error starting review quiz. Function not found.");
            if (cmeDashboard) cmeDashboard.style.display = "block"; // Show dashboard again as fallback
        }
    });
} else {
    console.error("Review Incorrect CME Questions button (#reviewIncorrectCmeBtn) not found.");
}
// --- End of Event Listener for "Review Incorrect CME Questions" Button ---

// --- Step 12a: Claim Modal Button Event Listeners ---

const claimCmeBtn = document.getElementById("claimCmeBtn"); // Button on CME Dashboard
const cmeClaimModal = document.getElementById("cmeClaimModal"); // The modal itself
const closeCmeClaimModalBtn = document.getElementById("closeCmeClaimModal"); // Close (X) button
const cancelCmeClaimBtn = document.getElementById("cancelCmeClaimBtn"); // Cancel button inside modal
const cmeClaimForm = document.getElementById("cmeClaimForm"); // The form inside the modal
const commercialBiasRadios = document.querySelectorAll('input[name="evalCommercialBias"]'); // Radios for bias question
const commercialBiasCommentDiv = document.getElementById("commercialBiasCommentDiv"); // Comment div

// Listener for the main "Claim CME Credit" button on the dashboard
if (claimCmeBtn && cmeClaimModal) {
    claimCmeBtn.addEventListener('click', function() {
        // Only open if not disabled (which means credits >= 0.25)
        if (!claimCmeBtn.disabled) {
            console.log("Claim CME button clicked, opening modal.");
            prepareClaimModal(); // Call helper to set available credits etc.
            document.getElementById('cmeModalOverlay').style.display = 'block';
            cmeClaimModal.style.display = 'block'; // Use 'block' or 'flex' based on your final CSS
        } else {
            console.log("Claim CME button clicked, but disabled (not enough credits).");
        }
    });
} else {
    console.error("Claim button or Claim modal not found.");
}

// Listener for the modal's Close (X) button
if (closeCmeClaimModalBtn && cmeClaimModal) {
    closeCmeClaimModalBtn.addEventListener('click', function() {
        console.log("Close claim modal button clicked.");
        document.getElementById('cmeModalOverlay').style.display = 'none';
        cmeClaimModal.style.display = 'none';
    });
}

// Listener for the modal's Cancel button
if (cancelCmeClaimBtn && cmeClaimModal) {
    cancelCmeClaimBtn.addEventListener('click', function() {
        console.log("Cancel claim modal button clicked.");
        document.getElementById('cmeModalOverlay').style.display = 'none';
        cmeClaimModal.style.display = 'none';
    });
}

// --- CME Claim Modal - Click Outside to Close ---
const cmeModalOverlay = document.getElementById("cmeModalOverlay"); // Assuming you have an overlay element

if (cmeClaimModal && cmeModalOverlay) {
    cmeModalOverlay.addEventListener('click', function(event) {
        // Check if the click was directly on the overlay itself,
        // and not on any of its children (like the modal content).
        if (event.target === cmeModalOverlay) {
            console.log("CME Claim Modal Overlay clicked, closing modal.");
            cmeModalOverlay.style.display = 'none'; // Hide the overlay
            cmeClaimModal.style.display = 'none';   // Hide the modal content
        }
    });
} else {
    if (!cmeClaimModal) console.error("CME Claim Modal (#cmeClaimModal) not found for click-outside listener.");
    if (!cmeModalOverlay) console.error("CME Modal Overlay (#cmeModalOverlay) not found for click-outside listener.");
}
// --- End CME Claim Modal - Click Outside to Close ---

// Listener for the Commercial Bias radio buttons to show/hide comment box
if (commercialBiasRadios.length > 0 && commercialBiasCommentDiv) {
    commercialBiasRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            if (this.value === 'No' && this.checked) {
                commercialBiasCommentDiv.style.display = 'block'; // Show comment box
            } else {
                commercialBiasCommentDiv.style.display = 'none'; // Hide comment box
                // Optionally clear the comment box when hiding
                // const commentTextarea = document.getElementById('evalCommercialBiasComment');
                // if (commentTextarea) commentTextarea.value = '';
            }
        });
    });
}

// Listener for the Form Submission (Step 12b will handle the actual submission logic)
if (cmeClaimForm) {
    cmeClaimForm.addEventListener('submit', handleCmeClaimSubmission); // Call submission handler
}

const viewAccreditationBtn = document.getElementById("viewCmeAccreditationBtn");
    const accreditationModal = document.getElementById("cmeAccreditationModal");
    const closeAccreditationModalBtn = document.getElementById("closeCmeAccreditationModal");

    if (viewAccreditationBtn && accreditationModal) {
        viewAccreditationBtn.addEventListener("click", function() {
            console.log("View CME Accreditation button clicked.");
            accreditationModal.style.display = "flex"; // Show the modal
        });
    } else {
        if (!viewAccreditationBtn) console.error("View CME Accreditation button not found.");
        if (!accreditationModal) console.error("CME Accreditation modal not found.");
    }

    if (closeAccreditationModalBtn && accreditationModal) {
        closeAccreditationModalBtn.addEventListener("click", function() {
            accreditationModal.style.display = "none"; // Hide the modal
        });
    }

    // Optional: Close modal if clicking outside the content
    if (accreditationModal) {
        accreditationModal.addEventListener('click', function(event) {
            if (event.target === accreditationModal) { // Clicked on the modal background
                accreditationModal.style.display = 'none';
            }
        });
    }
    showMainToolbarInfo();
});

// Function to show the login form modal
function showLoginForm(fromWelcomeScreen = false) {
  // Create login modal if it doesn't exist
  let loginModal = document.getElementById('loginModal');
  
  if (!loginModal) {
    loginModal = document.createElement('div');
    loginModal.id = 'loginModal';
    loginModal.className = 'auth-modal';
    
    loginModal.innerHTML = `
      <div class="auth-modal-content">
        ${fromWelcomeScreen ? '<button id="backToWelcomeBtn" style="position: absolute; top: 15px; left: 15px; background: none; border: none; font-size: 1.2rem; color: #0056b3; cursor: pointer;">&larr;</button>' : ''}
        <img src="MedSwipe Logo gradient.png" alt="MedSwipe Logo" class="auth-logo">
        <h2>Log In to MedSwipe</h2>
        <div id="loginError" class="auth-error"></div>
        <form id="loginForm">
          <div class="form-group">
            <label for="loginEmail">Email</label>
            <input type="email" id="loginEmail" required>
          </div>
          <div class="form-group">
            <label for="loginPassword">Password</label>
            <input type="password" id="loginPassword" required>
          </div>
          <div class="auth-buttons">
            <button type="submit" class="auth-primary-btn">Log In</button>
          </div>
          <div style="text-align: center; margin-top: 15px;">
            <a href="#" id="forgotPasswordLink" style="color: #0056b3; text-decoration: none; font-size: 0.9rem;">Forgot Password?</a>
          </div>
          <div style="text-align: center; margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee;">
            <p style="margin-bottom: 10px; color: #666;">Don't have an account?</p>
            <button type="button" id="createAccountBtn" class="auth-secondary-btn" onclick="window.showRegisterForm()">Create Account</button>
          </div>
        </form>
        <button id="closeLoginBtn" class="auth-close-btn">×</button>
      </div>
    `;
    
    document.body.appendChild(loginModal);
    
    // Add event listeners
    document.getElementById('loginForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      const errorElement = document.getElementById('loginError');
      
      try {
        errorElement.textContent = '';
        await window.authFunctions.loginUser(email, password);

        if (analytics) {
          logEvent(analytics, 'login', {
              method: 'email_password'
          });
          console.log("GA Event: login");
      }

        // Success - close modal and show dashboard
        loginModal.style.display = 'none';
        document.getElementById('mainOptions').style.display = 'flex';
        ensureEventListenersAttached(); // Make sure event listeners are attached
      } catch (error) {
        // Show error message
        errorElement.textContent = getAuthErrorMessage(error);
      }
    });
    
    document.getElementById('createAccountBtn').addEventListener('click', function() {
  loginModal.style.display = 'none';
  
  // Check if the function exists and call it
  if (typeof showRegisterForm === 'function') {
    showRegisterForm();
  } else {
    // If the function doesn't exist, try to find it on the window object
    if (typeof window.showRegisterForm === 'function') {
      window.showRegisterForm();
    } else {
      console.error("Registration form function not found");
      alert("Sorry, there was an error accessing the registration form. Please try again later.");
    }
  }
});
    
    document.getElementById('closeLoginBtn').addEventListener('click', function() {
      loginModal.style.display = 'none';
      document.getElementById('mainOptions').style.display = 'flex';
    });
    
    // Add back button functionality if coming from welcome screen
    if (fromWelcomeScreen) {
      document.getElementById('backToWelcomeBtn').addEventListener('click', function() {
        loginModal.style.display = 'none';
        document.getElementById('welcomeScreen').style.display = 'flex';
        document.getElementById('welcomeScreen').style.opacity = '1';
      });
    }
  } else {
    // If modal already exists but we need to add/remove back button
    const existingBackBtn = loginModal.querySelector('#backToWelcomeBtn');
    const modalContent = loginModal.querySelector('.auth-modal-content');
    
    if (fromWelcomeScreen && !existingBackBtn) {
      // Add back button if coming from welcome screen
      const backBtn = document.createElement('button');
      backBtn.id = 'backToWelcomeBtn';
      backBtn.innerHTML = '&larr;';
      backBtn.style = 'position: absolute; top: 15px; left: 15px; background: none; border: none; font-size: 1.2rem; color: #0056b3; cursor: pointer;';
      
      backBtn.addEventListener('click', function() {
        loginModal.style.display = 'none';
        document.getElementById('welcomeScreen').style.display = 'flex';
        document.getElementById('welcomeScreen').style.opacity = '1';
      });
      
      if (modalContent) {
        modalContent.insertBefore(backBtn, modalContent.firstChild);
      }
    } else if (!fromWelcomeScreen && existingBackBtn) {
      // Remove back button if not coming from welcome screen
      existingBackBtn.remove();
    }
  }
  
  // Show the modal
  loginModal.style.display = 'flex';
}

window.showLoginForm = showLoginForm;

// Function to show the registration form modal
function showRegisterForm(nextStep = 'dashboard') { // Added nextStep parameter, default to 'dashboard'
  // Create registration modal if it doesn't exist
  let registerModal = document.getElementById('registerModal');
  let modalTitle = "Create MedSwipe Account"; // Default title

  if (nextStep === 'board_review_pricing') {
    modalTitle = "Register for Board Review Access";
  } else if (nextStep === 'cme_pricing') {
    modalTitle = "Register for CME Module Access";
  } else if (nextStep === 'cme_info') { // <<< NEW CONDITION FOR TITLE
    modalTitle = "Register to Explore CME Module";
  }
  // Add more conditions here if you have other registration flows in the future

  if (!registerModal) {
    registerModal = document.createElement('div');
    registerModal.id = 'registerModal';
    registerModal.className = 'auth-modal';

    registerModal.innerHTML = `
  <div class="auth-modal-content">
    <img src="MedSwipe Logo gradient.png" alt="MedSwipe Logo" class="auth-logo">
    <h2 id="registerModalTitle">${modalTitle}</h2>
    <div id="registerError" class="auth-error"></div>
    <form id="registerForm">
      <div class="form-group">
        <label for="registerUsername">Username (for Leaderboards)</label>
        <input type="text" id="registerUsername" required>
      </div>
      
      <div class="form-group">
        <label for="registerEmail">Email</label>
        <input type="email" id="registerEmail" required>
      </div>
      <div class="form-group">
        <label for="registerPassword">Password</label>
        <input type="password" id="registerPassword" required minlength="6">
        <small>Password must be at least 6 characters</small>
      </div>
      <div class="form-group terms-container">
  <div class="terms-checkbox">
    <input type="checkbox" id="agreeTerms" required>
    <label for="agreeTerms">
      I agree to the <a href="#" id="registerViewTOS">Terms of Service</a> and
      <a href="#" id="registerViewPrivacy">Privacy Policy</a>
    </label>
  </div>
  <div class="form-error" id="termsError"></div>
  
  <!-- New Marketing Email Opt-in Checkbox -->
  <div class="terms-checkbox" style="margin-top: 10px;">
    <input type="checkbox" id="marketingOptIn" checked>
    <label for="marketingOptIn">
      Send me occasional notifications and updates to keep me motivated. Unsubscribe anytime.
    </label>
  </div>
</div>
      <div class="auth-buttons">
        <button type="submit" class="auth-primary-btn">Create Account</button>
        <button type="button" id="goToLoginBtn" class="auth-secondary-btn">I Already Have an Account</button>
      </div>
    </form>
    <button id="closeRegisterBtn" class="auth-close-btn">×</button>
  </div>
`;

document.body.appendChild(registerModal);

// Re-attach event listeners for the form and buttons inside the new modal content
attachRegisterFormListeners(registerModal, nextStep);

} else {
const titleElement = document.getElementById('registerModalTitle');
if (titleElement) {
  titleElement.textContent = modalTitle;
}
// If modal exists, ensure its content is up-to-date (in case it was built with old HTML)
// This is a bit more involved if you want to replace just a part.
// A simpler way if the modal structure is complex is to remove and recreate,
// or ensure the initial creation always uses the new HTML.
// For now, we assume the initial creation will use the updated HTML.
// If you find the old dropdown still appearing, you might need to force a rebuild of innerHTML here too.

// Store nextStep on the modal and re-attach listeners to capture it
registerModal.dataset.nextStep = nextStep; 
attachRegisterFormListeners(registerModal, nextStep); // Re-attach to ensure correct nextStep is used
}

registerModal.style.display = 'flex';
}
window.showRegisterForm = showRegisterForm; // Ensure it's globally available

// Helper function to attach listeners to the registration form
// This avoids duplicating listener code if the modal is recreated or its content updated.
function attachRegisterFormListeners(modalElement, initialNextStep) {
const form = modalElement.querySelector('#registerForm');
const goToLoginBtn = modalElement.querySelector('#goToLoginBtn');
const closeRegisterBtn = modalElement.querySelector('#closeRegisterBtn');
const errorElement = modalElement.querySelector('#registerError');

if (form) {
// Clone and replace form to remove old submit listeners
const newForm = form.cloneNode(true);
form.parentNode.replaceChild(newForm, form);

newForm.addEventListener('submit', async function(e) {
  e.preventDefault();
  const currentNextStep = modalElement.dataset.nextStep || initialNextStep;

  const username = newForm.querySelector('#registerUsername').value;
  const email = newForm.querySelector('#registerEmail').value;
  const password = newForm.querySelector('#registerPassword').value;
  // Experience is no longer read from here

  if (errorElement) errorElement.textContent = '';

  try {
    // Show the loading screen immediately after hiding the modal
    modalElement.style.display = 'none';
    const postRegLoadingScreen = document.getElementById('postRegistrationLoadingScreen');
    if (postRegLoadingScreen) {
        postRegLoadingScreen.style.display = 'flex';
    }

    // We now capture the full result from the Cloud Function via our auth.js functions
    let result;
    if (window.authState.user && window.authState.user.isAnonymous) {
        result = await window.authFunctions.upgradeAnonymousUser(email, password, username);
    } else {
        result = await window.authFunctions.registerUser(email, password, username);
    }

    // Check the result for the 'promoApplied' flag.
    // The data from a callable function is nested under `result.data`.
    if (result && result.data && result.data.promoApplied) {
        console.log("Promotion was successfully applied! Setting flag for welcome message.");
        // We use sessionStorage so the message only shows once.
        sessionStorage.setItem('promoApplied', 'true');
    }

    // Log GA event after successful registration
    if (analytics) {
        logEvent(analytics, 'sign_up', { method: 'email_password' });
        console.log("GA Event: sign_up");
    }

    // The 'authStateChanged' listener will now handle all routing.
    // We just wait here for a moment to show the "Finalizing..." screen.
    setTimeout(() => {
        if (postRegLoadingScreen) {
            postRegLoadingScreen.style.display = 'none';
        }
    }, 1500);

} catch (error) {
    console.error("Full registration error object:", error);
    if (errorElement) errorElement.textContent = getAuthErrorMessage(error);

    // Hide loading screen on error
    const postRegLoadingScreen = document.getElementById('postRegistrationLoadingScreen');
    if (postRegLoadingScreen) {
        postRegLoadingScreen.style.display = 'none';
    }
    // Show the modal again so the user can correct their input
    modalElement.style.display = 'flex';
}
});
}

if (goToLoginBtn) {
  // To prevent multiple listeners, we clone and replace the button. This is a good practice.
  const newGoToLoginBtn = goToLoginBtn.cloneNode(true);
  goToLoginBtn.parentNode.replaceChild(newGoToLoginBtn, goToLoginBtn);

  // Add the event listener to the new button
  newGoToLoginBtn.addEventListener('click', function() {
      console.log("'I Already Have an Account' button clicked inside registration modal.");
      
      // Hide the registration modal
      if (modalElement) {
          modalElement.style.display = 'none';
      } else {
          // Fallback if the modal reference is lost
          const regModal = document.getElementById('registerModal');
          if (regModal) regModal.style.display = 'none';
      }

      // Show the login form
      if (typeof showLoginForm === 'function') {
          showLoginForm();
      } else {
          console.error("showLoginForm function is not available to be called.");
          alert("Error opening login form. Please close this and try again.");
      }
  });
  console.log("Event listener attached to 'I Already Have an Account' button.");
} else {
  console.error("'goToLoginBtn' not found within the registration modal content.");
}

if (closeRegisterBtn) {
const newCloseRegisterBtn = closeRegisterBtn.cloneNode(true);
closeRegisterBtn.parentNode.replaceChild(newCloseRegisterBtn, closeRegisterBtn);
newCloseRegisterBtn.addEventListener('click', function() {
  modalElement.style.display = 'none';
  // Determine what to show when registration is cancelled
  // This logic might need to be smarter based on where the user came from.
  // For now, a simple fallback:
  const newPaywallScreen = document.getElementById("newPaywallScreen");
  const mainOptions = document.getElementById("mainOptions");
  if (newPaywallScreen && newPaywallScreen.style.display === 'none' && (!mainOptions || mainOptions.style.display === 'none')) {
      newPaywallScreen.style.display = 'flex'; // Show paywall if nothing else is shown
  } else if (mainOptions && mainOptions.style.display === 'none' && (!newPaywallScreen || newPaywallScreen.style.display === 'none')) {
      mainOptions.style.display = 'flex'; // Or main options
  } else if (newPaywallScreen && newPaywallScreen.style.display !== 'none') {
      // Paywall is already visible, do nothing
  } else if (mainOptions && mainOptions.style.display !== 'none') {
      // Main options are already visible, do nothing
  } else {
      // Default fallback if unsure
      if (mainOptions) mainOptions.style.display = 'flex';
  }
});
}
}

window.showRegisterForm = showRegisterForm;

// Helper function to get user-friendly error messages
function getAuthErrorMessage(error) {
  const errorCode = error.code;
  
  switch (errorCode) {
    case 'auth/invalid-email':
      return 'Invalid email address format';
    case 'auth/user-disabled':
      return 'This account has been disabled';
    case 'auth/user-not-found':
      return 'No account found with this email';
    case 'auth/wrong-password':
      return 'Incorrect password';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists';
    case 'auth/weak-password':
      return 'Password is too weak';
    case 'auth/network-request-failed':
      return 'Network error - please check your connection';
    default:
      return error.message || 'An unknown error occurred';
  }
}

// Main app initialization
window.addEventListener('load', function() {
  // Ensure functions are globally available
  window.updateUserXP = updateUserXP || function() {
    console.log("updateUserXP not loaded yet");
  };
  
  window.updateUserMenu = updateUserMenu || function() {
    console.log("updateUserMenu not loaded yet");
  };
  
  // Initialize user menu with username
  const checkAuthAndInit = function() {
    if (auth && auth.currentUser) {
      // Initialize user menu with username
      window.updateUserMenu();
    } else {
      // If auth isn't ready yet, check again in 1 second
      setTimeout(checkAuthAndInit, 1000);
    }
  };
  
  // Start checking for auth
  checkAuthAndInit();
  
  // Score circle click => open user menu
  const scoreCircle = document.getElementById("scoreCircle");
  if (scoreCircle) {
    scoreCircle.addEventListener("click", function() {
      const userMenu = document.getElementById("userMenu");
      const menuOverlay = document.getElementById("menuOverlay");
      if (userMenu && menuOverlay) {
        userMenu.classList.add("open");
        menuOverlay.classList.add("show");
      }
    });
  }

  const cmeAccuracyCircleValue = document.getElementById('cmeAccuracyCircleValue');
if (cmeAccuracyCircleValue) {
    cmeAccuracyCircleValue.addEventListener('click', function() {
        const userMenu = document.getElementById("userMenu");
        const menuOverlay = document.getElementById("menuOverlay");
        if (userMenu && menuOverlay) {
            userMenu.classList.add("open");
            menuOverlay.classList.add("show");
            console.log("CME Accuracy Circle clicked, opening user menu.");
        }
    });
}
  
  // User menu score circle click => go to FAQ
  const userScoreCircle = document.getElementById("userScoreCircle");
  if (userScoreCircle) {
    userScoreCircle.addEventListener("click", function() {
      closeUserMenu();
      showFAQ();
    });
  }
  
  // User menu close button
  const userMenuClose = document.getElementById("userMenuClose");
  if (userMenuClose) {
    userMenuClose.addEventListener("click", function() {
      closeUserMenu();
    });
  }
  
  // Performance from user menu
  const performanceItemUser = document.getElementById("performanceItemUser");
  if (performanceItemUser) {
    performanceItemUser.addEventListener("click", function() {
      closeUserMenu();
      document.body.style.overflow = '';
      const cmeDashboard = document.getElementById("cmeDashboardView");
if (cmeDashboard) cmeDashboard.style.display = "none";
      window.displayPerformance(); 
    });
  }
  
  // Bookmarks from user menu - start a bookmarks-only quiz
  const bookmarksFilterUser = document.getElementById("bookmarksFilterUser");
  if (bookmarksFilterUser) {
    bookmarksFilterUser.addEventListener("click", function(e) {
      e.preventDefault();
      closeUserMenu();
      document.body.style.overflow = '';
      const cmeDashboard = document.getElementById("cmeDashboardView");
if (cmeDashboard) cmeDashboard.style.display = "none";
      
      // Start a quiz with only bookmarked questions
      loadQuestions({
        bookmarksOnly: true,
        num: 50 // Large number to include all bookmarks
      });
    });
  }

  // --- Listener for View CME History Menu Item ---
const cmeHistoryMenuItem = document.getElementById("cmeHistoryMenuItem");
if (cmeHistoryMenuItem) {
    cmeHistoryMenuItem.addEventListener("click", function() {
        console.log("View CME Claim History menu item clicked.");
        closeUserMenu(); // Close the user menu first
        showCmeHistoryModal(); // Call the function to fetch data and show the modal
    });
} else {
    console.error("CME History Menu Item (#cmeHistoryMenuItem) not found.");
}

  // --- Manage Subscription Button ---
const manageSubBtn = document.getElementById('manageSubscriptionBtn');
if (manageSubBtn) {
    manageSubBtn.addEventListener('click', async () => {
        console.log("Manage Subscription button clicked.");

        // Ensure user is logged in and function ref exists
        const user = window.authFunctions.getCurrentUser();
        if (!user || user.isAnonymous) {
            alert("Please log in to manage your subscription.");
            return;
        }
        if (!createPortalSessionFunction) {
             alert("Error: Cannot connect to subscription manager. Please refresh.");
             console.error("createPortalSessionFunction reference missing.");
             return;
        }

        // Disable button and show loading state
        manageSubBtn.style.pointerEvents = 'none'; // Disable clicks
        manageSubBtn.textContent = 'Loading Portal...';
        manageSubBtn.style.opacity = '0.7';

        try {
            console.log("Calling createStripePortalSession function...");
            const result = await createPortalSessionFunction(); // No data needed from client
            const portalUrl = result.data.portalUrl;
            console.log("Received Portal URL:", portalUrl);

            if (portalUrl) {
                // Redirect the user to the Stripe Customer Portal
                window.location.href = portalUrl;
            } else {
                throw new Error("Portal URL was not returned from the function.");
            }
            // No need to re-enable button here as user is redirected

        } catch (error) {
            console.error("Error calling createStripePortalSession function:", error);
            let message = "Could not open the subscription portal. Please try again later.";
             if (error.code && error.message) { // Firebase Functions error format
                 // Provide more specific feedback if possible
                 if (error.code === 'failed-precondition' || error.message.includes("Subscription not found")) {
                      message = "No active subscription found to manage.";
                 } else {
                      message = `Error: ${error.message}`;
                 }
             }
            alert(message);
            // Re-enable button on error
            manageSubBtn.style.pointerEvents = 'auto';
            manageSubBtn.textContent = 'Manage Subscription';
            manageSubBtn.style.opacity = '1';
        }
    });
} else {
    console.error("Manage Subscription button not found.");
}
  
  // Reset progress from user menu
  const resetProgressUser = document.getElementById("resetProgressUser");
  if (resetProgressUser) {
    resetProgressUser.addEventListener("click", async function(e) {
      e.preventDefault();
      document.body.style.overflow = '';
      const confirmReset = confirm("Are you sure you want to reset all progress?");
      if (!confirmReset) return;
      
      if (!auth || !auth.currentUser) {
        alert("User not authenticated. Please try again later.");
        return;
      }
      
      const uid = auth.currentUser.uid;
      const userDocRef = doc(db, 'users', uid);
      try {
        await runTransaction(db, async (transaction) => {
          const userDoc = await transaction.get(userDocRef);
          if (userDoc.exists()) {
            const existingData = userDoc.data();
            
            // Preserve XP, Level, and Achievements from the existing stats
            const preservedStats = {
              xp: existingData.stats?.xp || 0,
              level: existingData.stats?.level || 1,
              achievements: existingData.stats?.achievements || {}
            };
        
            // Update the document with reset fields, but include the preserved stats
            transaction.update(userDocRef, {
              answeredQuestions: {},
              stats: { 
                // Start with the preserved values
                ...preservedStats,
                // Then add the reset values
                totalAnswered: 0, 
                totalCorrect: 0, 
                totalIncorrect: 0, 
                categories: {}, 
                totalTimeSpent: 0,
                currentCorrectStreak: 0
              },
              streaks: { 
                lastAnsweredDate: null, 
                currentStreak: 0, 
                longestStreak: 0 
              }
            });
          }
        });
        alert("Progress has been reset!");
        if (typeof updateUserCompositeScore === 'function') {
          updateUserCompositeScore();
        }
        window.updateUserMenu();
      } catch (error) {
        console.error("Error resetting progress:", error);
        alert("There was an error resetting your progress.");
      }
      closeUserMenu();
      const cmeDashboard = document.getElementById("cmeDashboardView");
if (cmeDashboard) cmeDashboard.style.display = "none";
    });
  }

  const logoutUserBtn = document.getElementById("logoutUserBtn");
if (logoutUserBtn) {
    logoutUserBtn.addEventListener("click", async function(e) {
        e.preventDefault();
        document.body.style.overflow = '';
        console.log("Log Out button clicked.");
        if (typeof closeUserMenu === 'function') {
            closeUserMenu();
        }
        try {
            await window.authFunctions.logoutUser();
            // cleanupOnLogout() is called internally by auth.js on sign-out
            // The authStateChanged listener will then handle redirecting to the welcome screen
            // or appropriate initial view for an anonymous user.
            console.log("User logged out, authStateChanged will handle UI.");
        } catch (error) {
            console.error("Error during logout:", error);
            alert("Failed to log out. Please try again.");
        }
    });
}
  
  // CUSTOM QUIZ BUTTON => show modal
  const customQuizBtn = document.getElementById("customQuizBtn");
  if (customQuizBtn) {
    customQuizBtn.addEventListener("click", function() {
      window.filterMode = "all";
      closeSideMenu();
      document.getElementById("aboutView").style.display = "none";
      document.getElementById("faqView").style.display = "none";
      document.getElementById("customQuizForm").style.display = "block";
    });
  }
  
  // RANDOM QUIZ BUTTON => show modal
  const randomQuizBtn = document.getElementById("randomQuizBtn");
  if (randomQuizBtn) {
    randomQuizBtn.addEventListener("click", function() {
      window.filterMode = "all";
      closeSideMenu();
      document.getElementById("aboutView").style.display = "none";
      document.getElementById("faqView").style.display = "none";
      document.getElementById("randomQuizForm").style.display = "block";
    });
  }
  
  // START QUIZ (Custom) => hide modal, load quiz
  const startCustomQuiz = document.getElementById("startCustomQuiz");
  if (startCustomQuiz) {
    startCustomQuiz.addEventListener("click", function() {
      const categorySelect = document.getElementById("categorySelect");
      const customNumQuestions = document.getElementById("customNumQuestions");
      const includeAnsweredCheckbox = document.getElementById("includeAnsweredCheckbox");
      
      let category = categorySelect ? categorySelect.value : "";
      let numQuestions = customNumQuestions ? parseInt(customNumQuestions.value) || 10 : 10;
      let includeAnswered = includeAnsweredCheckbox ? includeAnsweredCheckbox.checked : false;
      
      const customQuizForm = document.getElementById("customQuizForm");
      if (customQuizForm) {
        customQuizForm.style.display = "none";
      }
      
      loadQuestions({
        type: 'custom',
        category: category,
        num: numQuestions,
        includeAnswered: includeAnswered
      });
    });
  }
  
  // CANCEL QUIZ (Custom)
  const cancelCustomQuiz = document.getElementById("cancelCustomQuiz");
  if (cancelCustomQuiz) {
    cancelCustomQuiz.addEventListener("click", function() {
      const customQuizForm = document.getElementById("customQuizForm");
      if (customQuizForm) {
        customQuizForm.style.display = "none";
      }
    });
  }
  
  // START QUIZ (Random) => hide modal, load quiz
  const startRandomQuiz = document.getElementById("startRandomQuiz");
  if (startRandomQuiz) {
    startRandomQuiz.addEventListener("click", function() {
      const randomNumQuestions = document.getElementById("randomNumQuestions");
      const includeAnsweredRandomCheckbox = document.getElementById("includeAnsweredRandomCheckbox");
      
      let numQuestions = randomNumQuestions ? parseInt(randomNumQuestions.value) || 10 : 10;
      let includeAnswered = includeAnsweredRandomCheckbox ? includeAnsweredRandomCheckbox.checked : false;
      
      const randomQuizForm = document.getElementById("randomQuizForm");
      if (randomQuizForm) {
        randomQuizForm.style.display = "none";
      }
      
      loadQuestions({
        type: 'random',
        num: numQuestions,
        includeAnswered: includeAnswered
      });
    });
  }
  
  // CANCEL QUIZ (Random)
  const cancelRandomQuiz = document.getElementById("cancelRandomQuiz");
  if (cancelRandomQuiz) {
    cancelRandomQuiz.addEventListener("click", function() {
      const randomQuizForm = document.getElementById("randomQuizForm");
      if (randomQuizForm) {
        randomQuizForm.style.display = "none";
      }
    });
  }
  
  // BOOKMARKS => now simply close the menu
  const bookmarksFilter = document.getElementById("bookmarksFilter");
  if (bookmarksFilter) {
    bookmarksFilter.addEventListener("click", function(e) {
      e.preventDefault();
      closeSideMenu();
      const cmeDashboard = document.getElementById("cmeDashboardView");
if (cmeDashboard) cmeDashboard.style.display = "none";
    });
  }
  
  // START NEW QUIZ from side menu
  const startNewQuiz = document.getElementById("startNewQuiz");
  if (startNewQuiz) {
    startNewQuiz.addEventListener("click", function() {
      closeSideMenu();
      document.body.style.overflow = ''; // ADD THIS LINE
      window.filterMode = "all";
      
      const swiperElement = document.querySelector(".swiper");
      if (swiperElement) swiperElement.style.display = "none";
      
      const bottomToolbar = document.getElementById("bottomToolbar");
      if (bottomToolbar) bottomToolbar.style.display = "none";
      
      const iconBar = document.getElementById("iconBar");
      if (iconBar) iconBar.style.display = "none";
      
      const performanceView = document.getElementById("performanceView");
      if (performanceView) performanceView.style.display = "none";
      
      const leaderboardView = document.getElementById("leaderboardView");
      if (leaderboardView) leaderboardView.style.display = "none";
      
      const faqView = document.getElementById("faqView");
      if (faqView) faqView.style.display = "none";
      
      const aboutView = document.getElementById("aboutView");
      if (aboutView) aboutView.style.display = "none";

      const cmeDashboard = document.getElementById("cmeDashboardView");
if (cmeDashboard) cmeDashboard.style.display = "none";
      
      const mainOptions = document.getElementById("mainOptions");
      if (mainOptions) mainOptions.style.display = "flex";
      showMainToolbarInfo();
    });
  }
  
  // --- MODIFIED LEADERBOARD MENU ITEM LISTENER ---
  const leaderboardItem = document.getElementById("leaderboardItem");
  if (leaderboardItem) {
    // Clone and replace to ensure a fresh listener, removing any old ones
    const newLeaderboardItem = leaderboardItem.cloneNode(true);
    leaderboardItem.parentNode.replaceChild(newLeaderboardItem, leaderboardItem);

    newLeaderboardItem.addEventListener("click", function() {
      closeSideMenu(); // Close the menu first
      document.body.style.overflow = ''; // ADD THIS LINE

      // Ensure authState and user are available
      if (!window.authState || !window.authState.user) {
        console.error("AuthState or user not available. Cannot determine leaderboard access.");
        // Fallback: Could show login or the paywall directly if unsure
        const newPaywallScreen = document.getElementById("newPaywallScreen");
        if (newPaywallScreen) {
            ensureAllScreensHidden(); // Hide other main screens
            newPaywallScreen.style.display = 'flex';
        }
        return;
      }

      const accessTier = window.authState.accessTier;
      const isAnonymousUser = window.authState.user.isAnonymous; // Get from authState

      console.log(`Leaderboard menu item clicked. User Access Tier: ${accessTier}, Is Anonymous: ${isAnonymousUser}`);

      // Check if user is anonymous OR if they are registered but on the "free_guest" tier
      if (isAnonymousUser || accessTier === "free_guest") {
        // ADD THIS: Track paywall view
    if (analytics && logEvent) {
      logEvent(analytics, 'paywall_view', {
        paywall_type: 'feature_gate',
        trigger_action: 'leaderboard_access',
        user_tier: accessTier
      });
    }
        console.log("User is anonymous or free_guest. Redirecting to paywall.");
        ensureAllScreensHidden(); // Hide other main screens
        
        const newPaywallScreen = document.getElementById("newPaywallScreen");
        if (newPaywallScreen) {
          newPaywallScreen.style.display = 'flex';
        } else {
          console.error("New Paywall screen element not found!");
          // Fallback: show main options if paywall is missing
          const mainOptions = document.getElementById("mainOptions");
          if (mainOptions) mainOptions.style.display = 'flex';
        }
      } else {
        // ADD THIS: Track feature usage
    if (analytics && logEvent) {
      logEvent(analytics, 'feature_used', {
        feature_name: 'leaderboard',
        first_time_use: false, // You could track this if needed
        user_tier: accessTier
      });
    }
        // User has a paying tier, show the leaderboard
        console.log("User has a paying tier. Showing leaderboard.");
        // Ensure other views are hidden before showing leaderboard
        const cmeDashboard = document.getElementById("cmeDashboardView");
        if (cmeDashboard) cmeDashboard.style.display = "none";
        // showLeaderboard() should handle hiding mainOptions, etc.
        if (typeof showLeaderboard === 'function') {
          showLeaderboard();
        } else {
            console.error("showLeaderboard function not found!");
        }
      }
      showMainToolbarInfo();
    });
  }
  // --- END MODIFIED LEADERBOARD MENU ITEM LISTENER ---
  
  // FAQ
  const faqItem = document.getElementById("faqItem");
  if (faqItem) {
    faqItem.addEventListener("click", function() {
      closeSideMenu();
      document.body.style.overflow = '';
      const cmeDashboard = document.getElementById("cmeDashboardView");
if (cmeDashboard) cmeDashboard.style.display = "none";
      showFAQ();
      showMainToolbarInfo();
    });
  }
  
  // ABOUT US
  const aboutItem = document.getElementById("aboutItem");
  if (aboutItem) {
    aboutItem.addEventListener("click", function() {
      closeSideMenu();
      document.body.style.overflow = '';
      const cmeDashboard = document.getElementById("cmeDashboardView");
if (cmeDashboard) cmeDashboard.style.display = "none";
      showAbout();
      showMainToolbarInfo();
    });
  }
  
  // CONTACT US
  const contactItem = document.getElementById("contactItem");
  if (contactItem) {
    contactItem.addEventListener("click", function() {
      closeSideMenu();
      document.body.style.overflow = ''; // ADD THIS LINE      
      const swiperElement = document.querySelector(".swiper");
      if (swiperElement) swiperElement.style.display = "none";
      
      const bottomToolbar = document.getElementById("bottomToolbar");
      if (bottomToolbar) bottomToolbar.style.display = "none";
      
      const iconBar = document.getElementById("iconBar");
      if (iconBar) iconBar.style.display = "none";
      
      const performanceView = document.getElementById("performanceView");
      if (performanceView) performanceView.style.display = "none";
      
      const leaderboardView = document.getElementById("leaderboardView");
      if (leaderboardView) leaderboardView.style.display = "none";
      
      const aboutView = document.getElementById("aboutView");
      if (aboutView) aboutView.style.display = "none";
      
      const faqView = document.getElementById("faqView");
      if (faqView) faqView.style.display = "none";

      const cmeDashboard = document.getElementById("cmeDashboardView");
if (cmeDashboard) cmeDashboard.style.display = "none";
      
      const mainOptions = document.getElementById("mainOptions");
      if (mainOptions) mainOptions.style.display = "none";
      
      showContactModal();
    });
  }
  
  // Side menu toggling - this is the crucial part that was causing the issue
  const menuToggle = document.getElementById("menuToggle");
  if (menuToggle) {
    menuToggle.addEventListener("click", function() {
      const sideMenu = document.getElementById("sideMenu");
      const menuOverlay = document.getElementById("menuOverlay");
      
      if (sideMenu) sideMenu.classList.add("open");
      if (menuOverlay) menuOverlay.classList.add("show");
    });
  }
  
  const menuClose = document.getElementById("menuClose");
  if (menuClose) {
    menuClose.addEventListener("click", function() {
      closeSideMenu();
    });
  }
  
  const menuOverlay = document.getElementById("menuOverlay");
  if (menuOverlay) {
    menuOverlay.addEventListener("click", function() {
      closeSideMenu();
      closeUserMenu();
    });
  }
  
  // Logo click => go to main menu
  const logoClick = document.getElementById("logoClick");
  if (logoClick) {
    logoClick.addEventListener("click", function() {
      closeSideMenu();
      closeUserMenu();
      document.body.style.overflow = '';
      
      const aboutView = document.getElementById("aboutView");
      if (aboutView) aboutView.style.display = "none";
      
      const faqView = document.getElementById("faqView");
      if (faqView) faqView.style.display = "none";
      
      const swiperElement = document.querySelector(".swiper");
      if (swiperElement) swiperElement.style.display = "none";
      
      const bottomToolbar = document.getElementById("bottomToolbar");
      if (bottomToolbar) bottomToolbar.style.display = "none";
      
      const iconBar = document.getElementById("iconBar");
      if (iconBar) iconBar.style.display = "none";
      
      const performanceView = document.getElementById("performanceView");
      if (performanceView) performanceView.style.display = "none";
      
      const leaderboardView = document.getElementById("leaderboardView");
      if (leaderboardView) leaderboardView.style.display = "none";

      const cmeDashboard = document.getElementById("cmeDashboardView");
    if (cmeDashboard) cmeDashboard.style.display = "none";
      
      const mainOptions = document.getElementById("mainOptions");
      if (mainOptions) mainOptions.style.display = "flex";
      showMainToolbarInfo();
    });
  }
  
  // FEEDBACK button
  const feedbackButton = document.getElementById("feedbackButton");
  if (feedbackButton) {
    feedbackButton.addEventListener("click", function() {
      const questionId = getCurrentQuestionId();
      const questionSlide = document.querySelector(`.swiper-slide[data-id="${questionId}"]`);
      let questionText = "";
      if (questionSlide) {
        const questionElem = questionSlide.querySelector(".question");
        if (questionElem) {
          questionText = questionElem.textContent.trim();
        }
      }
      currentFeedbackQuestionId = questionId || "";
      currentFeedbackQuestionText = questionText || "";
      
      const feedbackQuestionInfo = document.getElementById("feedbackQuestionInfo");
      if (feedbackQuestionInfo) {
        feedbackQuestionInfo.textContent = `Feedback for Q: ${currentFeedbackQuestionText}`;
      }
      
      const feedbackModal = document.getElementById("feedbackModal");
      if (feedbackModal) {
        feedbackModal.style.display = "flex";
      }
    });
  }
  
  // FEEDBACK submit
  const submitFeedback = document.getElementById("submitFeedback");
  if (submitFeedback) {
    // Clone and replace to ensure fresh listener
    const newSubmitFeedback = submitFeedback.cloneNode(true);
    submitFeedback.parentNode.replaceChild(newSubmitFeedback, submitFeedback);

    newSubmitFeedback.addEventListener("click", async function() {
      const feedbackTextElement = document.getElementById("feedbackText"); // Renamed for clarity
      if (!feedbackTextElement || !feedbackTextElement.value.trim()) {
        alert("Please enter your feedback.");
        return;
      }
      
      // currentFeedbackQuestionId and currentFeedbackQuestionText should be set 
      // when the feedback modal is opened.

      try {
        // --- CORRECTED Firestore call ---
        const feedbackCollectionRef = collection(db, "feedback"); // Get a reference to the 'feedback' collection
        await addDoc(feedbackCollectionRef, { // Use addDoc with the collection reference
          questionId: currentFeedbackQuestionId, // This should be correctly set when modal opens
          questionText: currentFeedbackQuestionText, // This should be correctly set
          feedback: feedbackTextElement.value.trim(),
          timestamp: serverTimestamp(),
          userId: auth.currentUser ? auth.currentUser.uid : 'anonymous_or_unknown', // Store user ID if available
          userEmail: auth.currentUser ? auth.currentUser.email : null // Store user email if available
        });
        // --- END CORRECTION ---

        alert("Thank you for your feedback!");
        
        if (feedbackTextElement) {
          feedbackTextElement.value = "";
        }
        
        const feedbackModal = document.getElementById("feedbackModal");
        if (feedbackModal) {
          feedbackModal.style.display = "none";
        }
      } catch (error) {
        console.error("Error submitting feedback:", error);
        alert("There was an error submitting your feedback. Please try again later.");
      }
    });
  }

    // CLOSE FEEDBACK MODAL button
    const closeFeedbackModalBtn = document.getElementById("closeFeedbackModal");
    if (closeFeedbackModalBtn) {
      closeFeedbackModalBtn.addEventListener("click", function() {
        const feedbackModal = document.getElementById("feedbackModal");
        if (feedbackModal) {
          feedbackModal.style.display = "none";
        }
      });
    }
  
  // FAVORITE button (bookmark functionality)
  const favoriteButton = document.getElementById("favoriteButton");
  if (favoriteButton) {
    favoriteButton.addEventListener("click", async function() {
      let questionId = getCurrentQuestionId();
      if (!questionId) return;
      
      const wasToggled = await toggleBookmark(questionId.trim());
      if (wasToggled) {
        favoriteButton.innerText = "★";
        favoriteButton.style.color = "#007BFF"; // Blue
      } else {
        favoriteButton.innerText = "☆";
        favoriteButton.style.color = "";
      }
    });
  }
  
  // CONTACT modal buttons
  const submitContact = document.getElementById("submitContact");
  if (submitContact) {
    // Clone and replace to ensure fresh listener
    const newSubmitContact = submitContact.cloneNode(true);
    submitContact.parentNode.replaceChild(newSubmitContact, submitContact);

    newSubmitContact.addEventListener("click", async function() {
      const contactEmailElement = document.getElementById("contactEmail"); // Renamed
      const contactMessageElement = document.getElementById("contactMessage"); // Renamed
      
      const email = contactEmailElement ? contactEmailElement.value.trim() : "";
      const message = contactMessageElement ? contactMessageElement.value.trim() : "";
      
      if (!message) {
        alert("Please enter your message.");
        return;
      }
      
      try {
        // This check was already good, but ensure auth is available
        if (!auth || !auth.currentUser) { 
          alert("User not authenticated. Please log in to send a message or try again later.");
          // Optionally, you could allow anonymous contact submissions if desired,
          // but then userId would be the anonymous ID or null.
          return;
        }
        
        // --- CORRECTED Firestore call ---
        const contactCollectionRef = collection(db, "contactMessages"); // Use a descriptive collection name, e.g., "contactSubmissions" or "userMessages"
        await addDoc(contactCollectionRef, { // Use addDoc
          email: email, // User-provided email (optional)
          message: message,
          timestamp: serverTimestamp(),
          userId: auth.currentUser.uid, // Logged-in user's ID
          userEmailAuth: auth.currentUser.email // Logged-in user's authenticated email
        });
        // --- END CORRECTION ---

        alert("Thank you for contacting us!");
        
        if (contactEmailElement) contactEmailElement.value = "";
        if (contactMessageElement) contactMessageElement.value = "";
        
        const contactModal = document.getElementById("contactModal");
        if (contactModal) {
          contactModal.style.display = "none";
        }
      } catch (error) {
        console.error("Error submitting contact:", error);
        alert("There was an error submitting your message. Please try again later.");
      }
    });
  }
  
  const closeContactModal = document.getElementById("closeContactModal");
  if (closeContactModal) {
    closeContactModal.addEventListener("click", function() {
      const contactModal = document.getElementById("contactModal");
      if (contactModal) {
        contactModal.style.display = "none";
      }
    });
  }
  
  // Clean up any existing LEVEL UP text on page load
  const textNodes = document.querySelectorAll('body > *:not([id])');
  textNodes.forEach(node => {
    if (node.textContent && node.textContent.includes('LEVEL UP')) {
      node.remove();
    }
  });
});

// Function to update the level progress circles and bar
function updateLevelProgress(percent) {
  // Update the level progress circles
  const levelCircleProgress = document.getElementById("levelCircleProgress");
  const userLevelProgress = document.getElementById("userLevelProgress");
  
  if (levelCircleProgress) {
    levelCircleProgress.style.setProperty('--progress', `${percent}%`);
    console.log(`Main Toolbar levelCircleProgress updated to: ${percent}%`); // Added log
  } else {
    console.warn("Main Toolbar levelCircleProgress element not found for update."); // Added log
  }
  
  if (userLevelProgress) {
    userLevelProgress.style.setProperty('--progress', `${percent}%`);
  }
  if (dashboardLevelProgress) { // Added check for dashboard progress circle
    dashboardLevelProgress.style.setProperty('--progress', `${percent}%`);
  }
  
  // Update the horizontal progress bar
  const levelProgressBar = document.getElementById("levelProgressBar");
  if (levelProgressBar) {
    levelProgressBar.style.width = `${percent}%`;
  }
}

// Helper function to show the main XP/Level in the toolbar
async function showMainToolbarInfo() { // Make it async
  const xpDisplay = document.getElementById('xpDisplay');
  const mainLevelCircleContainer = document.getElementById('mainLevelCircleContainer');
  const cmeToolbarTracker = document.getElementById('cmeToolbarTracker');
  const scoreCircle = document.getElementById('scoreCircle');
  const levelCircleProgress = document.getElementById('levelCircleProgress'); // Main toolbar progress

  if (xpDisplay) xpDisplay.style.display = 'block';
  if (mainLevelCircleContainer) mainLevelCircleContainer.style.display = 'block';
  if (cmeToolbarTracker) cmeToolbarTracker.style.display = 'none';

  // Fetch latest user data to update toolbar accurately
  if (window.authState && window.authState.user && !window.authState.user.isAnonymous) {
      const uid = window.authState.user.uid;
      const userDocRef = doc(db, 'users', uid);
      try {
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
              const data = userDocSnap.data();
              const totalXP = data.stats?.xp || 0;
              const currentLevel = data.stats?.level || 1;
              
              // Use calculateLevelProgress from user.v2.js
              // Ensure it's available, e.g., by making it global or importing if app.js is a module
              let progressPercent = 0;
              if (typeof window.calculateLevelProgress === 'function') { // If made global from user.v2.js
                  progressPercent = window.calculateLevelProgress(totalXP);
              } else if (typeof calculateLevelProgress === 'function') { // If imported into app.js
                   progressPercent = calculateLevelProgress(totalXP);
              } else {
                  console.warn("calculateLevelProgress function not available in showMainToolbarInfo");
              }


              if (xpDisplay) xpDisplay.textContent = `${totalXP} XP`;
              if (scoreCircle) scoreCircle.textContent = currentLevel;
              if (levelCircleProgress) {
                  levelCircleProgress.style.setProperty('--progress', `${progressPercent}%`);
              }
              console.log(`Main Toolbar refreshed by showMainToolbarInfo: XP: ${totalXP}, Level: ${currentLevel}, Progress: ${progressPercent}%`);
          }
      } catch (error) {
          console.error("Error fetching user data for main toolbar refresh:", error);
      }
  } else {
      // Default for logged-out or anonymous state
      if (xpDisplay) xpDisplay.textContent = `0 XP`;
      if (scoreCircle) scoreCircle.textContent = '1';
      if (levelCircleProgress) levelCircleProgress.style.setProperty('--progress', `0%`);
  }
  console.log("Toolbar switched to: Main XP/Level Display (and refreshed by showMainToolbarInfo)");
}

// Helper function to show the CME Tracker in the toolbar and update its values
async function showCmeToolbarInfo() {
  console.log("Attempting to show CME Toolbar Info...");
  const xpDisplay = document.getElementById('xpDisplay');
  const mainLevelCircleContainer = document.getElementById('mainLevelCircleContainer');
  const cmeToolbarTracker = document.getElementById('cmeToolbarTracker');
  const cmeCreditsDisplay = document.getElementById('cmeCreditsDisplay');
  const cmeAccuracyCircleValue = document.getElementById('cmeAccuracyCircleValue');
  const cmeAccuracyCircleProgress = document.getElementById('cmeAccuracyCircleProgress');

  // Log if elements are found
  console.log("xpDisplay found:", !!xpDisplay);
  console.log("mainLevelCircleContainer found:", !!mainLevelCircleContainer);
  console.log("cmeToolbarTracker found:", !!cmeToolbarTracker);
  console.log("cmeCreditsDisplay found:", !!cmeCreditsDisplay);
  console.log("cmeAccuracyCircleValue found:", !!cmeAccuracyCircleValue);
  console.log("cmeAccuracyCircleProgress found:", !!cmeAccuracyCircleProgress);

  if (xpDisplay) xpDisplay.style.display = 'none';
  if (mainLevelCircleContainer) mainLevelCircleContainer.style.display = 'none';
  
  if (cmeToolbarTracker) {
      cmeToolbarTracker.style.display = 'flex'; // Use flex for its internal alignment
      console.log("cmeToolbarTracker display set to flex");
  } else {
      console.error("CRITICAL: cmeToolbarTracker element NOT FOUND!");
      return; // Exit if the main container isn't there
  }

  let creditsAvailable = "0.00";
  let cmeAccuracy = 0;

  if (window.authState && window.authState.user && !window.authState.user.isAnonymous) {
      const uid = window.authState.user.uid;
      console.log(`Fetching CME data for toolbar for user: ${uid}`);
      const userDocRef = doc(db, 'users', uid);
      try {
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
              const data = userDocSnap.data();
              console.log("User data for toolbar:", data);
              const cmeStats = data.cmeStats || { totalAnswered: 0, totalCorrect: 0, creditsEarned: 0, creditsClaimed: 0 };
              
              const earned = parseFloat(cmeStats.creditsEarned || 0);
              const claimed = parseFloat(cmeStats.creditsClaimed || 0);
              creditsAvailable = Math.max(0, earned - claimed).toFixed(2);

              const totalAnswered = cmeStats.totalAnswered || 0;
              const totalCorrect = cmeStats.totalCorrect || 0;
              if (totalAnswered > 0) {
                  cmeAccuracy = Math.round((totalCorrect / totalAnswered) * 100);
              }
              console.log(`Calculated for toolbar - Credits: ${creditsAvailable}, Accuracy: ${cmeAccuracy}%`);
          } else {
              console.warn("User document does not exist for toolbar CME data.");
          }
      } catch (error) {
          console.error("Error fetching CME data for toolbar:", error);
      }
  } else {
      console.warn("Cannot fetch CME data for toolbar: User not authenticated or is anonymous.");
  }

  if (cmeCreditsDisplay) {
      cmeCreditsDisplay.textContent = `CME: ${creditsAvailable}`;
  } else {
      console.warn("cmeCreditsDisplay element not found for update.");
  }
  if (cmeAccuracyCircleValue) {
      cmeAccuracyCircleValue.textContent = `${cmeAccuracy}%`;
  } else {
      console.warn("cmeAccuracyCircleValue element not found for update.");
  }
  if (cmeAccuracyCircleProgress) {
      cmeAccuracyCircleProgress.style.setProperty('--progress', `${cmeAccuracy}%`);
  } else {
      console.warn("cmeAccuracyCircleProgress element not found for update.");
  }
  console.log(`Toolbar switched to: CME Display (Credits: ${creditsAvailable}, Accuracy: ${cmeAccuracy}%)`);
}

// Update user XP display function call
window.addEventListener('load', function() {
  // Call after Firebase auth is initialized
  setTimeout(() => {
    if (auth && auth.currentUser) {
      if (typeof updateUserXP === 'function') {
        updateUserXP();
      } else if (typeof window.updateUserXP === 'function') {
        window.updateUserXP();
      }
    }
  }, 2000);
});

// Function to check if a user's streak should be reset due to inactivity
// This is the NEW, FINAL, and CORRECTED checkAndUpdateStreak function
async function checkAndUpdateStreak() {
  if (!auth || !auth.currentUser || auth.currentUser.isAnonymous) {
    // console.log("User not authenticated yet for streak check");
    return;
  }

  try {
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);
    
    const userDocSnap = await getDoc(userDocRef);
    if (!userDocSnap.exists()) return;

    const data = userDocSnap.data();
    let streaks = data.streaks || { lastAnsweredDate: null, currentStreak: 0, longestStreak: 0 };

    if (!streaks.lastAnsweredDate) return; // No streak to check

    const currentDate = new Date();
    const lastDate = new Date(streaks.lastAnsweredDate);

    const normalizeDate = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const normalizedCurrent = normalizeDate(currentDate);
    const normalizedLast = normalizeDate(lastDate);

    const diffDays = Math.round((normalizedCurrent - normalizedLast) / (1000 * 60 * 60 * 24));

    if (diffDays > 1) {
      console.log("Streak reset due to inactivity. Days since last activity:", diffDays);
      streaks.currentStreak = 0;
      // Perform a direct update, NOT in a transaction
      await updateDoc(userDocRef, {
        streaks: streaks
      });
      
      // Update UI to show reset streak
      const currentStreakElement = document.getElementById("currentStreak");
      if (currentStreakElement) {
        currentStreakElement.textContent = "0";
      }
    }
  } catch (error) {
    // We expect a permission error here if something is wrong, but the direct update should work.
    console.error("Error checking streak:", error);
  }
}

// Function to load leaderboard preview data - fixed for desktop view
// MODIFIED: Function to load leaderboard preview data

// DECLARE THIS FLAG OUTSIDE THE FUNCTION, IN A SCOPE ACCESSIBLE BY IT:
let isLeaderboardPreviewLoadingOrLoaded = false;

async function loadLeaderboardPreview() {
  const leaderboardPreview = document.getElementById("leaderboardPreview");
  const leaderboardCard = document.getElementById("leaderboardPreviewCard"); // Get the card itself

  if (!leaderboardPreview || !leaderboardCard) {
    console.error("loadLeaderboardPreview: #leaderboardPreview or its card element NOT FOUND.");
    return;
  }

  // Reset the flag on each call to allow retries
  isLeaderboardPreviewLoadingOrLoaded = false;
  
  // Always show loading state when starting a fresh load
  leaderboardPreview.innerHTML = '<div class="leaderboard-loading">Loading preview...</div>';
  
  console.log("loadLeaderboardPreview: Called.");
  isLeaderboardPreviewLoadingOrLoaded = true;

  const cardFooter = leaderboardCard.querySelector(".card-footer span:first-child");
  const cardHeader = leaderboardCard.querySelector(".card-header h3"); // Get the header h3

  // 1. Check if the callable function reference is valid
  if (typeof getLeaderboardDataFunctionApp !== 'function') {
    console.error("loadLeaderboardPreview: getLeaderboardDataFunctionApp is not a function or not initialized.");
    leaderboardPreview.innerHTML = '<div class="leaderboard-loading" style="color:red;">Error: Service unavailable.</div>';
    if (cardFooter) cardFooter.textContent = "Error";
    isLeaderboardPreviewLoadingOrLoaded = false;
    return;
  }

  // 2. Check auth state and access tier
  const currentUser = auth.currentUser;
  const accessTier = window.authState?.accessTier;
  const isUserAnonymous = currentUser?.isAnonymous;

  console.log(`loadLeaderboardPreview: UID: ${currentUser?.uid}, Anonymous: ${isUserAnonymous}, Tier: ${accessTier}`);

  // Wait a bit if auth is not ready yet
  if (!currentUser || !window.authState) {
    console.log("loadLeaderboardPreview: Auth not ready, retrying in 2 seconds...");
    isLeaderboardPreviewLoadingOrLoaded = false;
    setTimeout(() => loadLeaderboardPreview(), 2000);
    return;
  }

  if (isUserAnonymous || accessTier === "free_guest") {
    console.log("loadLeaderboardPreview: User is anonymous or free_guest. Showing upgrade prompt.");
    if (cardHeader) cardHeader.textContent = "Leaderboard"; // Reset header text
    const message1 = "Leaderboards are a premium feature.";
    const message2 = "Upgrade your account to unlock this feature!";
    const buttonText = "Upgrade to Access";
    leaderboardPreview.innerHTML = `
        <div class="guest-analytics-prompt">
            <p>${message1}</p>
            <p>${message2}</p>
            <button id="upgradeForLeaderboardBtn_preview" class="start-quiz-btn" style="margin-top:10px;">
                ${buttonText}
            </button>
        </div>
    `;
    const upgradeBtn = document.getElementById('upgradeForLeaderboardBtn_preview');
    if (upgradeBtn) {
        const newUpgradeBtn = upgradeBtn.cloneNode(true);
        upgradeBtn.parentNode.replaceChild(newUpgradeBtn, upgradeBtn);
        newUpgradeBtn.addEventListener('click', function () {
            console.log("Leaderboard Preview 'Upgrade' button clicked.");
            if (typeof ensureAllScreensHidden === 'function') ensureAllScreensHidden();
            const mainPaywallScreen = document.getElementById("newPaywallScreen");
            if (mainPaywallScreen) mainPaywallScreen.style.display = 'flex';
            else {
                console.error("Main paywall screen not found!");
                const mainOptions = document.getElementById("mainOptions");
                if (mainOptions) mainOptions.style.display = 'flex';
            }
        });
    }
    if (cardFooter) cardFooter.textContent = "Upgrade to Access";
    isLeaderboardPreviewLoadingOrLoaded = false;
    return;
  }

  // For paying tiers:
  console.log("loadLeaderboardPreview: User eligible. Calling Cloud Function 'getLeaderboardData'.");
  try {
    const result = await getLeaderboardDataFunctionApp();
    const leaderboardData = result.data;
    console.log("loadLeaderboardPreview: Received data:", leaderboardData);

    if (!leaderboardData || !leaderboardData.weeklyXpLeaderboard || !leaderboardData.currentUserRanks) { // Check for weekly data
        console.error("loadLeaderboardPreview: Invalid data structure from Cloud Function.", leaderboardData);
        leaderboardPreview.innerHTML = '<div class="leaderboard-loading" style="color:red;">Error: Invalid data.</div>';
        if (cardFooter) cardFooter.textContent = "Error";
        isLeaderboardPreviewLoadingOrLoaded = false;
        
        setTimeout(() => loadLeaderboardPreview(), 5000);
        return;
    }

    if (cardHeader) cardHeader.textContent = "Weekly Leaderboard"; // --- NEW: Update header text ---

    const currentUid = currentUser.uid;

    // --- NEW: Use weeklyXpLeaderboard and currentUserRanks.weeklyXp for the preview ---
    const top3 = (leaderboardData.weeklyXpLeaderboard || []).slice(0, 3);
    const currentUserRankData = leaderboardData.currentUserRanks?.weeklyXp;

    let html = '';
    if (top3.length === 0 && !currentUserRankData) {
      html = '<div class="leaderboard-loading" style="text-align:center; padding-top:10px;">No one has earned XP this week. Be the first!</div>';
    } else {
      top3.forEach((entry) => {
        const isCurrentUser = entry.uid === currentUid;
        html += `
          <div class="leaderboard-preview-entry ${isCurrentUser ? 'current-user-entry' : ''}">
            <div class="leaderboard-rank leaderboard-rank-${entry.rank}">${entry.rank}</div>
            <div class="leaderboard-user-info">
              <div class="leaderboard-username">${entry.username}</div>
              <div class="leaderboard-user-xp">${entry.weeklyXp} XP</div>
            </div>
          </div>
        `;
      });

      let userInTop3 = top3.some(e => e.uid === currentUid);
      if (currentUserRankData && !userInTop3) {
        html += `
          <div class="leaderboard-preview-entry current-user-entry your-rank-preview">
            <div class="leaderboard-rank">${currentUserRankData.rank}</div>
            <div class="leaderboard-user-info">
              <div class="leaderboard-username">${currentUserRankData.username} (You)</div>
              <div class="leaderboard-user-xp">${currentUserRankData.weeklyXp} XP</div>
            </div>
          </div>
        `;
      }
    }
    leaderboardPreview.innerHTML = html || '<div class="leaderboard-loading" style="text-align:center; padding-top:10px;">No ranked players yet.</div>';
    if (cardFooter) cardFooter.textContent = "View Full Leaderboard";
    console.log("loadLeaderboardPreview: Preview updated successfully with WEEKLY data.");
    
    isLeaderboardPreviewLoadingOrLoaded = true;

  } catch (error) {
    console.error("loadLeaderboardPreview: Error calling Cloud Function or processing result:", error);
    let errorMsg = "Error loading preview.";
    if (error.code === 'unauthenticated' || (error.message && error.message.toLowerCase().includes("authenticated"))) {
        errorMsg = "Please log in.";
        setTimeout(() => loadLeaderboardPreview(), 3000);
    } else if (error.message) {
        errorMsg = `Error: ${error.message.substring(0, 60)}${error.message.length > 60 ? '...' : ''}`;
    }
    leaderboardPreview.innerHTML = `<div class="leaderboard-loading" style="color:red;">${errorMsg}</div>`;
    if (cardFooter) cardFooter.textContent = "Error";
    isLeaderboardPreviewLoadingOrLoaded = false;
  }
}

// Dashboard initialization and functionality
async function initializeDashboard() {
  console.log("Initializing dashboard..."); // Added for clarity

  if (!auth || !auth.currentUser || !db) {
    console.log("Auth or DB not initialized for dashboard. Will retry.");
    setTimeout(initializeDashboard, 1000); // Retry if not ready
    return;
  }
  
  try {
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);
    
    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      const stats = data.stats || {};
      const streaks = data.streaks || { currentStreak: 0 };
      
      const totalXP = stats.xp || 0;       // Get totalXP from user's stats
      const currentLevel = stats.level || 1; // Get currentLevel from user's stats
      
      // Calculate progress percentage using the function (ensure it's accessible)
      let progressPercent = 0;
      if (typeof calculateLevelProgress === 'function') { // Check if imported directly
          const levelProgressData = calculateLevelProgress(totalXP); // Assuming it returns an object
          progressPercent = levelProgressData.progressPercent !== undefined ? levelProgressData.progressPercent : (typeof levelProgressData === 'number' ? levelProgressData : 0);
      } else if (typeof window.calculateLevelProgress === 'function') { // Check if global
          const levelProgressData = window.calculateLevelProgress(totalXP);
          progressPercent = levelProgressData.progressPercent !== undefined ? levelProgressData.progressPercent : (typeof levelProgressData === 'number' ? levelProgressData : 0);
      } else {
          console.warn("calculateLevelProgress function not found in initializeDashboard. Progress will be 0.");
      }

      // --- Update Main Toolbar Elements ---
      const mainToolbarScoreCircle = document.getElementById("scoreCircle");
      if (mainToolbarScoreCircle) {
        mainToolbarScoreCircle.textContent = currentLevel;
      }
      const mainToolbarXpDisplay = document.getElementById("xpDisplay");
      if (mainToolbarXpDisplay) {
        mainToolbarXpDisplay.textContent = `${totalXP} XP`;
      }
      const mainToolbarLevelCircleProgress = document.getElementById("levelCircleProgress");
      if (mainToolbarLevelCircleProgress) {
        mainToolbarLevelCircleProgress.style.setProperty('--progress', `${progressPercent}%`);
        console.log(`Main Toolbar #levelCircleProgress initialized to: ${progressPercent}% from initializeDashboard`);
      }
      // --- End Main Toolbar Update ---

      // --- Update Dashboard Card: User Progress ---
      const dashboardLevel = document.getElementById("dashboardLevel");
      if (dashboardLevel) {
        dashboardLevel.textContent = currentLevel;
      }
      
      const dashboardXP = document.getElementById("dashboardXP");
      if (dashboardXP) {
        dashboardXP.textContent = `${totalXP} XP`;
      }
      
      const dashboardNextLevel = document.getElementById("dashboardNextLevel");
      if (dashboardNextLevel) {
        // Ensure getLevelInfo is accessible
        let levelInfo;
        if (typeof getLevelInfo === 'function') {
            levelInfo = getLevelInfo(currentLevel);
        } else if (typeof window.getLevelInfo === 'function') {
            levelInfo = window.getLevelInfo(currentLevel);
        } else {
            console.warn("getLevelInfo function not found in initializeDashboard.");
            levelInfo = { nextLevelXp: null }; // Fallback
        }

        if (levelInfo.nextLevelXp) {
          const xpNeeded = levelInfo.nextLevelXp - totalXP;
          dashboardNextLevel.textContent = `${xpNeeded > 0 ? xpNeeded : 0} XP to Level ${currentLevel + 1}`;
        } else {
          dashboardNextLevel.textContent = 'Max Level Reached!';
        }
      }
      
      const dashboardLevelProgress = document.getElementById("dashboardLevelProgress");
      if (dashboardLevelProgress) {
        dashboardLevelProgress.style.setProperty('--progress', `${progressPercent}%`);
      }
      // --- End Dashboard Card: User Progress ---
      
      // --- Update Dashboard Card: Quick Stats ---
      const totalAnswered = stats.totalAnswered || 0;
      const totalCorrect = stats.totalCorrect || 0;
      const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
      
      const dashboardAnswered = document.getElementById("dashboardAnswered");
      if (dashboardAnswered) {
        dashboardAnswered.textContent = totalAnswered;
      }
      
      const dashboardAccuracy = document.getElementById("dashboardAccuracy");
      if (dashboardAccuracy) {
        dashboardAccuracy.textContent = `${accuracy}%`;
      }
      // --- End Dashboard Card: Quick Stats ---
      
      // --- Update Dashboard Card: Streak Display ---
      const currentStreakEl = document.getElementById("currentStreak"); // Renamed for clarity
      if (currentStreakEl) {
        currentStreakEl.textContent = streaks.currentStreak || 0;
      }
      fixStreakCalendar(streaks); // Assuming fixStreakCalendar is defined and accessible
      // --- End Dashboard Card: Streak Display ---
      
      // Load leaderboard preview with a delay to ensure auth is ready
setTimeout(() => {
  loadLeaderboardPreview();
}, 1000);
      updateReviewQueue();    // Assuming updateReviewQueue is defined

      // --- Logic for Dashboard CME Card (Tier-Based Visibility) ---
      const dashboardCmeCard = document.getElementById("dashboardCmeCard");
      const dashboardCmeAnswered = document.getElementById("dashboardCmeAnswered");
      const dashboardCmeAccuracy = document.getElementById("dashboardCmeAccuracy");
      const dashboardCmeAvailable = document.getElementById("dashboardCmeAvailable");

      const accessTier = window.authState?.accessTier;

      if (window.authState?.isRegistered && (accessTier === "cme_annual" || accessTier === "cme_credits_only") &&
          dashboardCmeCard && dashboardCmeAnswered && dashboardCmeAccuracy && dashboardCmeAvailable) {

          const cmeStats = data.cmeStats || {
              totalAnswered: 0, totalCorrect: 0, creditsEarned: 0.00, creditsClaimed: 0.00
          };
          const uniqueAnswered = cmeStats.totalAnswered || 0;
          const uniqueCorrect = cmeStats.totalCorrect || 0;
          const uniqueAccuracy = uniqueAnswered > 0 ? Math.round((uniqueCorrect / uniqueAnswered) * 100) : 0;
          const creditsEarned = parseFloat(cmeStats.creditsEarned || 0);
          const creditsClaimed = parseFloat(cmeStats.creditsClaimed || 0);
          const availableCredits = Math.max(0, creditsEarned - creditsClaimed).toFixed(2);

          dashboardCmeAnswered.textContent = uniqueAnswered;
          dashboardCmeAccuracy.textContent = `${uniqueAccuracy}%`;
          dashboardCmeAvailable.textContent = availableCredits;
          dashboardCmeCard.style.display = "block";
          console.log(`Displayed CME card on dashboard for user tier: ${accessTier}.`);

          const newCard = dashboardCmeCard.cloneNode(true);
          dashboardCmeCard.parentNode.replaceChild(newCard, dashboardCmeCard);
          newCard.addEventListener('click', async () => {
              console.log("Dashboard CME card clicked by tier:", accessTier);
              newCard.style.opacity = '0.7'; newCard.style.cursor = 'wait';
              try {
                  if (typeof showCmeDashboard === 'function') {
                      showCmeDashboard();
                  } else {
                      console.error("showCmeDashboard function not found!");
                      alert("Error navigating to CME module.");
                  }
              } catch (error) {
                  console.error("Error during CME card click handling:", error);
                  alert("An error occurred. Please try again.");
              } finally {
                  newCard.style.opacity = '1'; newCard.style.cursor = 'pointer';
              }
          });
      } else if (dashboardCmeCard) {
          dashboardCmeCard.style.display = "none";
          console.log(`Hiding CME card on dashboard (user tier: ${accessTier}, or anonymous, or elements missing).`);
      }
      // --- End Logic for Dashboard CME Card ---

    } else {
      console.warn("User document does not exist in initializeDashboard. Cannot update UI fully.");
      // Optionally, reset UI elements to default for a non-existent user doc if needed
    }
  } catch (error) {
    console.error("Error loading dashboard data:", error);
  }
  console.log("Dashboard initialization complete.");
}

// --- Function to Show CME Claim History Modal ---
async function showCmeHistoryModal() {
  console.log("Executing showCmeHistoryModal...");

  const historyModal = document.getElementById("cmeHistoryModal");
  const historyBody = document.getElementById("cmeHistoryModalBody");
  const closeButton = historyModal ? historyModal.querySelector('.close-modal') : null;

  if (!historyModal || !historyBody || !closeButton) {
      console.error("CME History Modal elements not found!");
      return;
  }

  // 1. Check Authentication
  if (!auth.currentUser || auth.currentUser.isAnonymous) {
      alert("Please log in to view your CME claim history.");
      return;
  }
  const uid = auth.currentUser.uid;

  // 2. Show Modal & Loading State
  historyBody.innerHTML = "<p>Loading history...</p>"; // Set loading message
  historyModal.style.display = "flex"; // Show the modal

  // 3. Add Close Logic (ensure it works)
  // Using onclick assignment here for simplicity, ensures only one listener
  closeButton.onclick = () => {
      historyModal.style.display = "none";
  };
  historyModal.onclick = (event) => {
      if (event.target === historyModal) { // Clicked on background overlay
          historyModal.style.display = "none";
      }
  };

  // 4. Fetch Data from Firestore
  try {
      const userDocRef = doc(db, 'users', uid);
      console.log(`Fetching history for user: ${uid}`);
      const userDocSnap = await getDoc(userDocRef);

      if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          // Get history, default to empty array if null/undefined
          const cmeHistory = userData.cmeClaimHistory || [];
          console.log(`Fetched ${cmeHistory.length} history entries.`);

          // 5. Generate HTML Table
          if (cmeHistory.length > 0) {
              // Sort history by timestamp, newest first
              cmeHistory.sort((a, b) => {
                  const dateA = a.timestamp?.toDate ? a.timestamp.toDate() : new Date(0);
                  const dateB = b.timestamp?.toDate ? b.timestamp.toDate() : new Date(0);
                  return dateB - dateA; // Descending order
              });

              let tableHtml = `
                  <table>
                      <thead>
                          <tr>
                              <th>Date Claimed</th>
                              <th>Credits</th>
                              <th>Certificate</th>
                          </tr>
                      </thead>
                      <tbody>
              `;

              cmeHistory.forEach(claim => {
                  const credits = parseFloat(claim.creditsClaimed || 0).toFixed(2);
                  let claimDate = 'Invalid Date';
                  // Handle both Firestore Timestamp and potential Date objects
                  if (claim.timestamp) {
                       try {
                           const dateObj = claim.timestamp.toDate ? claim.timestamp.toDate() : new Date(claim.timestamp);
                           if (!isNaN(dateObj)) { // Check if date is valid
                                claimDate = dateObj.toLocaleDateString(); // Format as MM/DD/YYYY (or locale default)
                           }
                       } catch (dateError) {
                           console.error("Error parsing date from history:", claim.timestamp, dateError);
                       }
                  }


                  // Create download link/button if filePath exists
                  let downloadCellContent = '-'; // Default if no path
                  if (claim.filePath) {
                      const filePath = claim.filePath;
                      const fileName = claim.pdfFileName || 'CME_Certificate.pdf';
                      // Use a button with an onclick event instead of an <a> tag with href
                      downloadCellContent = `
                          <button
                             onclick="handleCertificateDownload(this, '${filePath}', '${fileName}')"
                             class="cme-history-download-btn"
                             title="Download ${fileName}">
                              ⬇️ PDF
                          </button>`;
                  }

                  tableHtml += `
                      <tr>
                          <td>${claimDate}</td>
                          <td>${credits}</td>
                          <td>${downloadCellContent}</td>
                      </tr>
                  `;
              });

              tableHtml += `
                      </tbody>
                  </table>
              `;
              historyBody.innerHTML = tableHtml; // Inject the table

          } else {
              // No history found
              historyBody.innerHTML = `<p class="no-history-message">No CME claim history found.</p>`;
          }

      } else {
          // User document doesn't exist
          console.warn(`User document not found for UID: ${uid} when fetching history.`);
          historyBody.innerHTML = `<p class="no-history-message">Could not find user data.</p>`;
      }

  } catch (error) {
      console.error("Error fetching or displaying CME history:", error);
      historyBody.innerHTML = `<p style="color: red; text-align: center;">Error loading history. Please try again.</p>`;
  }
}

// --- Add this entire new function to app.js ---

async function handleCertificateDownload(buttonElement, filePath, fileName) {
  if (!getCertificateDownloadUrlFunction) {
      alert("Download service is not available. Please refresh the page.");
      return;
  }

  // Disable button and show loading state
  buttonElement.disabled = true;
  buttonElement.textContent = '...';

  try {
      console.log(`Requesting signed URL for: ${filePath}`);
      const result = await getCertificateDownloadUrlFunction({ filePath: filePath });

      if (result.data.success && result.data.downloadUrl) {
          const signedUrl = result.data.downloadUrl;
          console.log("Received signed URL, opening in new tab.");
          // Open the URL in a new tab, which will start the download or display the PDF
          window.open(signedUrl, '_blank');
      } else {
          throw new Error(result.data.error || "Failed to get a valid download link from the server.");
      }

  } catch (error) {
      console.error("Error getting certificate download URL:", error);
      alert(`Could not download certificate: ${error.message}`);
  } finally {
      // Re-enable the button
      buttonElement.disabled = false;
      buttonElement.textContent = '⬇️ PDF';
  }
}

// Make it globally accessible so the inline onclick can find it
window.handleCertificateDownload = handleCertificateDownload;

// --- End of showCmeHistoryModal Function ---

// Function to count questions due for review today
async function countDueReviews() {
  if (!auth || !auth.currentUser || !db) {
    console.log("Auth or DB not initialized for counting reviews");
    return { dueCount: 0, nextReviewDate: null };
  }
  
  try {
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);
    
    if (!userDocSnap.exists()) {
      return { dueCount: 0, nextReviewDate: null };
    }
    
    const data = userDocSnap.data();
    const spacedRepetitionData = data.spacedRepetition || {};
    
    // Get current date (just the date portion, no time)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Create tomorrow's date
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    
    let dueCount = 0;
    let nextReviewDate = null;
    
    // Loop through all questions in spaced repetition data
    for (const questionId in spacedRepetitionData) {
      const reviewData = spacedRepetitionData[questionId];
      if (!reviewData || !reviewData.nextReviewDate) continue;
      
      const reviewDate = new Date(reviewData.nextReviewDate);
      
      // Check if review date is today or earlier by comparing just the date portions
      const reviewDateOnly = new Date(reviewDate.getFullYear(), reviewDate.getMonth(), reviewDate.getDate());
      
      if (reviewDateOnly <= today) {
        dueCount++;
      } 
      // Only consider dates AFTER today for "next review date"
      else if (reviewDateOnly >= tomorrow && (!nextReviewDate || reviewDateOnly < nextReviewDate)) {
        nextReviewDate = reviewDateOnly;
      }
    }
    
    return { dueCount, nextReviewDate };
  } catch (error) {
    console.error("Error counting due reviews:", error);
    return { dueCount: 0, nextReviewDate: null };
  }
}

// Function to update the Review Queue card in the dashboard
async function updateReviewQueue() {
  const reviewCountEl = document.getElementById("reviewCount"); // Renamed for clarity
  const reviewQueueContent = document.getElementById("reviewQueueContent");
  const reviewProgressBar = document.getElementById("reviewProgressBar");
  const mainPaywallScreen = document.getElementById("newPaywallScreen"); // Get paywall screen


  if (!reviewCountEl || !reviewQueueContent || !reviewProgressBar) return;

  const accessTier = window.authState?.accessTier;

  if (auth.currentUser.isAnonymous || accessTier === "free_guest") {
    const message1 = "Spaced repetition is a premium feature.";
    const message2 = "Upgrade your account to unlock this feature!";
    const buttonText = "Upgrade to Access";

    reviewQueueContent.innerHTML = `
      <div class="review-empty-state guest-analytics-prompt">
        <p>${message1}</p>
        <p>${message2}</p>
        <button id="upgradeForReviewQueueBtn" class="start-quiz-btn" style="margin-top:10px;">${buttonText}</button>
      </div>
    `;
    reviewCountEl.textContent = "0";
    reviewProgressBar.style.width = "0%";

    const upgradeBtn = document.getElementById('upgradeForReviewQueueBtn');
    if (upgradeBtn) {
      // Remove any old listeners by cloning the button
      const newUpgradeBtn = upgradeBtn.cloneNode(true);
      upgradeBtn.parentNode.replaceChild(newUpgradeBtn, upgradeBtn);
      
      newUpgradeBtn.addEventListener('click', function() {
        // For BOTH anonymous and registered "free_guest", go to main paywall
        console.log("Review Queue 'Upgrade to Access' button clicked. Redirecting to paywall.");
        ensureAllScreensHidden(); // Hide other screens
        if (mainPaywallScreen) {
            mainPaywallScreen.style.display = 'flex';
        } else {
            console.error("Main paywall screen not found!");
            // Fallback if paywall is missing
            const mainOptions = document.getElementById("mainOptions");
            if (mainOptions) mainOptions.style.display = 'flex';
        }
      });
    }

    const footerText = document.querySelector("#reviewQueueCard .card-footer span:first-child");
    if (footerText) {
      footerText.textContent = "Upgrade to Access"; // Consistent footer text
    }
    return;
  }

  // For "board_review", "cme_annual", "cme_credits_only" tiers:
  try {
    const { dueCount, nextReviewDate } = await countDueReviews();
    reviewCountEl.textContent = dueCount;
    const progressPercent = Math.min(100, (dueCount / 20) * 100); // Assuming 20 is a target
    reviewProgressBar.style.width = `${progressPercent}%`;

    if (dueCount > 0) {
      reviewQueueContent.innerHTML = `
        <div class="review-stats">
          <div class="review-count">${dueCount}</div>
          <div class="review-label">questions due for review</div>
        </div>
        <div class="review-progress-container">
          <div class="review-progress-bar" style="width: ${progressPercent}%"></div>
        </div>
      `;
    } else {
      reviewQueueContent.innerHTML = `
        <div class="review-empty-state">
          <p>No questions due for review today.</p>
          ${nextReviewDate ?
            `<p>Next scheduled review: <span class="next-review-date">${nextReviewDate.toLocaleDateString()}</span></p>` :
            '<p>Complete more quizzes to start your spaced repetition journey.</p>'
          }
        </div>
      `;
    }
    const footerText = document.querySelector("#reviewQueueCard .card-footer span:first-child");
    if (footerText) {
      footerText.textContent = "Start Review";
    }
  } catch (error) {
    console.error("Error updating review queue:", error);
    reviewQueueContent.innerHTML = `<div class="review-empty-state"><p>Error loading review queue</p></div>`;
    reviewCountEl.textContent = "0";
    reviewProgressBar.style.width = "0%";
  }
}

// Set up event listeners for dashboard
function setupDashboardEvents() {

  // --- Updated CME Module Button Logic (Replaces the existing listener for #cmeModuleBtn) ---
const cmeModuleBtn = document.getElementById("cmeModuleBtn");
if (cmeModuleBtn) {
    // Clone the button to remove any previously attached listeners
    const newCmeModuleBtn = cmeModuleBtn.cloneNode(true);
    cmeModuleBtn.parentNode.replaceChild(newCmeModuleBtn, cmeModuleBtn);

    newCmeModuleBtn.addEventListener("click", async function() {
        console.log("--- CME Module Button Click Handler (Tier-Based) START ---");

        // Ensure authState and user are available
        if (!window.authState || !window.authState.user) {
            console.error("AuthState or user not available. Cannot determine CME access.");
            // Fallback: Show info screen or prompt login
            showCmeInfoScreen(); // Or a login prompt if appropriate
            return;
        }

        const accessTier = window.authState.accessTier;
        const isRegistered = window.authState.isRegistered; // Check if the user is registered (not anonymous)

        console.log(`CME Module button clicked. User Access Tier: ${accessTier}, Is Registered: ${isRegistered}`);

        if (isRegistered && (accessTier === "cme_annual" || accessTier === "cme_credits_only")) {
            // User HAS direct access to CME content
            console.log("Access GRANTED to CME Dashboard based on tier.");
            if (typeof showCmeDashboard === 'function') {
                showCmeDashboard(); // Show the actual CME content dashboard
            } else {
                console.error("showCmeDashboard function is not defined!");
                alert("Error: Could not load the CME module.");
            }
        } else {
            // User does NOT have direct access (free_guest, board_review, or anonymous)
            // Anonymous users will also fall here because isRegistered will be false.
            console.log("Access DENIED to CME Dashboard based on tier/registration. Showing CME Info Screen.");
            if (typeof showCmeInfoScreen === 'function') {
                showCmeInfoScreen(); // Show the purchase/info screen
            } else {
                console.error("showCmeInfoScreen function is not defined!");
                alert("Error: Could not load CME information.");
            }
        }
        console.log("--- CME Module Button Click Handler (Tier-Based) END ---");
    });
    console.log("DEBUG: Tier-based event listener attached to cmeModuleBtn.");
} else {
    console.error("DEBUG: CME Module button (#cmeModuleBtn) not found during tier-based listener setup.");
}
// --- End of Updated CME Module Button Logic ---

  // Start Quiz button on Dashboard
  const startQuizBtn = document.getElementById("startQuizBtn");
  if (startQuizBtn) {
      const newStartQuizBtn = startQuizBtn.cloneNode(true);
      startQuizBtn.parentNode.replaceChild(newStartQuizBtn, startQuizBtn);
  
      newStartQuizBtn.addEventListener("click", function() {
          const accessTier = window.authState?.accessTier;
          const isAnonymousUser = auth.currentUser && auth.currentUser.isAnonymous;
  
          const spacedRepCheckbox = document.getElementById('modalSpacedRepetition');
          const spacedRepContainer = spacedRepCheckbox ? spacedRepCheckbox.closest('.formGroup') : null;
          
          // --- START: Board Review Checkbox Visibility ---
          const boardReviewCheckbox = document.getElementById('modalBoardReviewOnly');
          const boardReviewContainer = document.getElementById('boardReviewOnlyContainer');

          if (boardReviewContainer) {
              if (accessTier === "board_review" || accessTier === "cme_annual" || accessTier === "cme_credits_only") {
                  boardReviewContainer.style.display = 'block'; // Or 'flex' if your .formGroup uses flex
                  console.log("Board Review Only option shown for tiered user.");
              } else {
                  boardReviewContainer.style.display = 'none';
                  if (boardReviewCheckbox) {
                      boardReviewCheckbox.checked = false; // Ensure it's unchecked if hidden
                  }
                  console.log("Board Review Only option hidden for free_guest/anonymous user.");
              }
          } else {
              console.warn("Board Review Only container not found in quiz setup modal.");
          }
          // --- END: Board Review Checkbox Visibility ---

          if (spacedRepContainer) {
              if (isAnonymousUser || accessTier === "free_guest") {
                  spacedRepContainer.style.display = 'none';
                  if (spacedRepCheckbox) spacedRepCheckbox.checked = false;
                  console.log("Spaced repetition option hidden for guest/free_guest user.");
              } else {
                  spacedRepContainer.style.display = 'block';
                  console.log("Spaced repetition option shown for tiered user.");
              }
          } else {
              console.warn("Spaced repetition container or checkbox not found in quiz setup modal.");
          }
          
          if (typeof populateCategoryDropdownForMainQuiz === 'function') {
              populateCategoryDropdownForMainQuiz();
          }
  
          const quizSetupModal = document.getElementById("quizSetupModal");
          if (quizSetupModal) {
              quizSetupModal.style.display = "block";
          } else {
              console.error("Quiz Setup Modal (#quizSetupModal) not found.");
          }
      });
  }
  
  // Modal Start Quiz button
  const modalStartQuiz = document.getElementById("modalStartQuiz");
  if (modalStartQuiz) {
    // Clone and replace to ensure fresh listener
    const newModalStartQuiz = modalStartQuiz.cloneNode(true);
    modalStartQuiz.parentNode.replaceChild(newModalStartQuiz, modalStartQuiz);

    newModalStartQuiz.addEventListener("click", function() {
      const category = document.getElementById("modalCategorySelect").value;
      const numQuestions = parseInt(document.getElementById("modalNumQuestions").value) || 10;
      const includeAnswered = document.getElementById("modalIncludeAnswered").checked;
      const useSpacedRepetition = document.getElementById("modalSpacedRepetition").checked;
      
      // --- START: Read Board Review Checkbox State ---
      const boardReviewOnlyCheckbox = document.getElementById("modalBoardReviewOnly");
      const boardReviewOnlyContainer = document.getElementById("boardReviewOnlyContainer");
      let boardReviewOnly = false; // Default to false

      // Only consider the checkbox if its container is visible (i.e., user has access)
      if (boardReviewOnlyContainer && boardReviewOnlyContainer.style.display !== 'none' && boardReviewOnlyCheckbox) {
          boardReviewOnly = boardReviewOnlyCheckbox.checked;
      }
      console.log("Board Review Only selected:", boardReviewOnly);
      // --- END: Read Board Review Checkbox State ---
      
      document.getElementById("quizSetupModal").style.display = "none";
      
      loadQuestions({
        type: category ? 'custom' : 'random',
        category: category,
        num: numQuestions,
        includeAnswered: includeAnswered,
        spacedRepetition: useSpacedRepetition,
        boardReviewOnly: boardReviewOnly // <<< Pass the new option
      });
    });
  }

  // --- Quiz Setup Modal - Cancel Button Listener ---
const modalCancelQuizButton = document.getElementById("modalCancelQuiz");
const quizSetupModalForCancel = document.getElementById("quizSetupModal"); // Get a reference again or pass it

if (modalCancelQuizButton && quizSetupModalForCancel) {
    // To ensure no old listeners interfere, clone and replace the button
    const newCancelButton = modalCancelQuizButton.cloneNode(true);
    modalCancelQuizButton.parentNode.replaceChild(newCancelButton, modalCancelQuizButton);

    // Add the event listener to the new button
    newCancelButton.addEventListener("click", function() {
        console.log("Modal Cancel Quiz button (#modalCancelQuiz) clicked.");
        if (quizSetupModalForCancel) {
            quizSetupModalForCancel.style.display = "none";
        } else {
            // Fallback if the modal reference was lost, though unlikely here
            const modalToHide = document.getElementById("quizSetupModal");
            if (modalToHide) modalToHide.style.display = "none";
        }
    });
    console.log("Cancel button listener attached to #modalCancelQuiz.");
} else {
    if (!modalCancelQuizButton) console.error("Modal Cancel Quiz button (#modalCancelQuiz) not found.");
    if (!quizSetupModalForCancel && modalCancelQuizButton) console.error("Quiz Setup Modal (#quizSetupModal) not found for cancel button action.");
}
// --- End Quiz Setup Modal - Cancel Button Listener ---
  
  // User Progress card click - go to Performance
  const userProgressCard = document.getElementById("userProgressCard");
  if (userProgressCard) {
    const newCard = userProgressCard.cloneNode(true); // Clone to remove old listeners
    userProgressCard.parentNode.replaceChild(newCard, userProgressCard);
    newCard.addEventListener("click", function() {
      window.displayPerformance(); 
    });
  }
  
  // Quick Stats card click - go to Performance
  const quickStatsCard = document.getElementById("quickStatsCard");
  if (quickStatsCard) {
    const newCard = quickStatsCard.cloneNode(true); // Clone to remove old listeners
    quickStatsCard.parentNode.replaceChild(newCard, quickStatsCard);
    newCard.addEventListener("click", function() {
      window.displayPerformance(); 
    });
  }
  
  // Leaderboard Preview Card click
  const leaderboardPreviewCard = document.getElementById("leaderboardPreviewCard");
  if (leaderboardPreviewCard) {
      const newLPCard = leaderboardPreviewCard.cloneNode(true); 
      leaderboardPreviewCard.parentNode.replaceChild(newLPCard, leaderboardPreviewCard);
      newLPCard.addEventListener('click', function() {
          const accessTier = window.authState?.accessTier;
          const mainPaywallScreen = document.getElementById("newPaywallScreen");
          if (auth.currentUser.isAnonymous || accessTier === "free_guest") {
              ensureAllScreensHidden();
              if (mainPaywallScreen) mainPaywallScreen.style.display = 'flex';
          } else {
              if (typeof showLeaderboard === 'function') showLeaderboard();
          }
      });
  }
  
  // Review Queue card click
  const reviewQueueCard = document.getElementById("reviewQueueCard");
  if (reviewQueueCard) {
      const newRQCard = reviewQueueCard.cloneNode(true); 
      reviewQueueCard.parentNode.replaceChild(newRQCard, reviewQueueCard);
      newRQCard.addEventListener('click', async function() {
          const accessTier = window.authState?.accessTier;
          const mainPaywallScreen = document.getElementById("newPaywallScreen");

          if (auth.currentUser.isAnonymous || accessTier === "free_guest") {
              ensureAllScreensHidden();
              if (mainPaywallScreen) mainPaywallScreen.style.display = 'flex';
              return;
          }
          const { dueCount } = await countDueReviews(); // Ensure countDueReviews is defined and async
          if (dueCount === 0) {
              alert("You have no questions due for review today. Good job!");
              return;
          }
          const dueQuestionIds = await getDueQuestionIds(); // Ensure getDueQuestionIds is defined and async
          if (dueQuestionIds.length === 0) {
              alert("No questions found for review. Please try again later.");
              return;
          }
          loadSpecificQuestions(dueQuestionIds); // Ensure loadSpecificQuestions is defined
      });
  }
}

async function populateCategoryDropdownForMainQuiz() {
  const categorySelect = document.getElementById("modalCategorySelect");
  if (!categorySelect) {
      console.error("Main Quiz Category Select dropdown (#modalCategorySelect) not found.");
      return;
  }

  // Clear existing options except the first "All Categories" option
  while (categorySelect.options.length > 1) {
      categorySelect.remove(1);
  }

  try {
      const allQuestions = await fetchQuestionBank(); // Reuses existing function
      let relevantQuestions = allQuestions;

      // If user is free_guest, only show categories that have at least one "Free: true" question
      if (window.authState && window.authState.accessTier === "free_guest") {
          relevantQuestions = allQuestions.filter(q => q.Free === true);
      }
      // For other tiers, all categories from all questions are potentially relevant

      const categories = [...new Set(relevantQuestions
          .map(q => q.Category ? q.Category.trim() : null)
          .filter(cat => cat && cat !== "")
      )].sort();

      categories.forEach(category => {
          const option = document.createElement("option");
          option.value = category;
          option.textContent = category;
          categorySelect.appendChild(option);
      });
      console.log("Main quiz category dropdown populated with:", categories);

  } catch (error) {
      console.error("Error populating main quiz category dropdown:", error);
  }
}

// Function to fix streak calendar alignment
function fixStreakCalendar(streaks) {
  // Get the streak calendar element
  const streakCalendar = document.getElementById("streakCalendar");
  if (!streakCalendar) {
    console.error("Streak calendar element not found");
    return;
  }
  
  // Clear existing circles
  streakCalendar.innerHTML = '';
  
  // Get today's date
  const today = new Date();
  
  // Convert JavaScript's day (0=Sunday, 6=Saturday) to our display format (0=Monday, 6=Sunday)
  let todayDayIndex = today.getDay() - 1; // Convert from JS day to our index
  if (todayDayIndex < 0) todayDayIndex = 6; // Handle Sunday (becomes 6)
  
  console.log("Today:", today);
  console.log("Day of week (0=Sun, 6=Sat):", today.getDay());
  console.log("Our day index (0=Mon, 6=Sun):", todayDayIndex);
  
  // Generate all the days of the week
  for (let i = 0; i < 7; i++) {
    // Calculate the date offset from today
    // i is the position in our display (0=Monday, 6=Sunday)
    // todayDayIndex is today's position in our display
    const offset = i - todayDayIndex;
    
    // Create the date for this position
    const date = new Date(today);
    date.setDate(today.getDate() + offset);
    
    // Create the day circle
    const dayCircle = document.createElement("div");
    dayCircle.className = "day-circle";
    
    // If this is today, add the today class
    if (offset === 0) {
      dayCircle.classList.add("today");
    }
    
    // Check if this day is active in the streak
    if (streaks && streaks.currentStreak > 0) {
      const dayDiff = Math.floor((today - date) / (1000 * 60 * 60 * 24));
      if (dayDiff >= 0 && dayDiff < streaks.currentStreak) {
        dayCircle.classList.add("active");
      }
    }
    
    // Set the date number as the content
    dayCircle.textContent = date.getDate();
    
    // Add to the calendar
    streakCalendar.appendChild(dayCircle);
  }
}

// Initialize the app
window.addEventListener('load', function() {
  // Check streak after Firebase auth is initialized
  const checkAuthAndInitAll = function() {
    if (auth && auth.currentUser) {
      checkAndUpdateStreak();
      setupDashboardEvents();
      initializeDashboard();
    } else {
      // If auth isn't ready yet, check again in 1 second
      setTimeout(checkAuthAndInitAll, 1000);
    }
  };
  
  // Start checking for auth
  checkAuthAndInitAll();
  
  // Also try after a delay to ensure all DOM elements are ready
  setTimeout(function() {
    setupDashboardEvents();
    initializeDashboard();
  }, 2000);
});

// Function to get IDs of questions due for review
async function getDueQuestionIds() {
  if (!auth || !auth.currentUser || !db) {
    return [];
  }
  
  try {
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);
    
    if (!userDocSnap.exists()) {
      return [];
    }
    
    const data = userDocSnap.data();
    const spacedRepetitionData = data.spacedRepetition || {};
    
    // Get current date (just the date portion, no time)
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let dueQuestionIds = [];
    
    // Loop through all questions in spaced repetition data
    for (const questionId in spacedRepetitionData) {
      const reviewData = spacedRepetitionData[questionId];
      if (!reviewData || !reviewData.nextReviewDate) continue;
      
      const reviewDate = new Date(reviewData.nextReviewDate);
      
      // Check if review date is today or earlier by comparing just the date portions
      const reviewDateOnly = new Date(reviewDate.getFullYear(), reviewDate.getMonth(), reviewDate.getDate());
      
      if (reviewDateOnly <= today) {
        dueQuestionIds.push(questionId);
      }
    }
    
    return dueQuestionIds;
  } catch (error) {
    console.error("Error getting due question IDs:", error);
    return [];
  }
}

// NEW version - uses fetchQuestionBank (Firestore)
async function loadSpecificQuestions(questionIds) {
  if (!questionIds || questionIds.length === 0) {
    alert("No questions to review.");
    return;
  }
  console.log("Loading specific review questions:", questionIds.length);

  try {
    // 1. Fetch the entire question bank from Firestore
    // Ensure fetchQuestionBank is imported from quiz.js at the top of app.js
    console.log("Fetching full question bank from Firestore for review queue...");
    const allQuestions = await fetchQuestionBank(); // Uses the updated function from quiz.js
    console.log("Full question bank loaded:", allQuestions.length);

    // 2. Filter the fetched questions based on the provided IDs
    const reviewQuestions = allQuestions.filter(q => {
      // Ensure the question object and the 'Question' field exist before trimming
      const questionText = q && q["Question"] ? q["Question"].trim() : null;
      return questionText && questionIds.includes(questionText);
    });
    console.log("Filtered review questions:", reviewQuestions.length);

    // 3. Handle cases where no matching questions are found
    if (reviewQuestions.length === 0) {
      alert("Could not find the specific questions scheduled for review. They might have been updated or removed from the question bank.");
      // Optionally, navigate back to the dashboard or show a message
      document.getElementById("mainOptions").style.display = "flex"; // Example fallback
      return;
    }

    // 4. Shuffle the review questions
    const shuffledReviewQuestions = shuffleArray([...reviewQuestions]);

    // 5. Initialize the quiz with only these specific review questions
    // Ensure initializeQuiz is imported from quiz.js at the top of app.js
    initializeQuiz(shuffledReviewQuestions); // Pass the filtered & shuffled questions

  } catch (error) {
    console.error("Error loading specific questions for review:", error);
    alert("Error loading review questions. Please try again later.");
    // Optionally, navigate back or show an error message
    document.getElementById("mainOptions").style.display = "flex"; // Example fallback
  }
}

// Then call this function when showing the dashboard after auth
// in the auth state change listener

function ensureEventListenersAttached() {
  // This function makes sure key event listeners are attached
  // Call this whenever dashboard is shown
  
  // Start Quiz button
  const startQuizBtn = document.getElementById("startQuizBtn");
  if (startQuizBtn && !startQuizBtn._hasEventListener) {
    startQuizBtn.addEventListener("click", function() {
      document.getElementById("quizSetupModal").style.display = "block";
    });
    startQuizBtn._hasEventListener = true;
  }
  
  // Check other important buttons
  setupDashboardEvents();
}

// Update the forceReinitializeDashboard function to call clearDebugStyles
function forceReinitializeDashboard() {
  console.log("Force reinitializing dashboard...");
  
  // First ensure all screens are properly hidden
  ensureAllScreensHidden();
  
  // IMPORTANT: Reset all user data displays based on current auth state
  const isAnonymous = auth.currentUser && auth.currentUser.isAnonymous;
  if (isAnonymous) {
    // For anonymous users, ensure stats display 0/blank
    cleanupOnLogout();
  } else {
    // For registered users, refresh displays from database
    if (typeof updateUserXP === 'function') {
      updateUserXP();
    }
    if (typeof updateUserMenu === 'function') {
      updateUserMenu();
    }
  }
  
  // 1. Check for any overlays that might be active and remove them
  const menuOverlay = document.getElementById("menuOverlay");
  if (menuOverlay) {
    menuOverlay.classList.remove("show");
    menuOverlay.style.zIndex = "1599"; // Ensure correct z-index
  }
  
  // 2. Force a redraw/layout recalculation of the dashboard
  const mainOptions = document.getElementById("mainOptions");
  if (mainOptions) {
    // Make sure the mainOptions has a lower z-index than any potential overlays
    mainOptions.style.zIndex = "1";
    mainOptions.style.position = "relative";
    
    // Temporarily hide and show to force a repaint
    const display = mainOptions.style.display;
    mainOptions.style.display = 'none';
    
    // Use a timeout to ensure the browser processes the display change
    setTimeout(() => {
      mainOptions.style.display = display || 'flex';
      
      console.log("Dashboard redraw complete, attaching event listeners...");
      
      // 4. Reattach all event listeners
      setTimeout(() => {
        setupDashboardEventListenersExplicitly();
        
        // --- COMMENT OUT OR DELETE THESE LINES ---
    // setTimeout(() => {
    //   debugOverlays();
    //   setTimeout(clearDebugStyles, 500);
    // }, 200);
    // --- END OF COMMENT OUT/DELETE ---
      }, 50);
    }, 50);
  }
}

// Create a more robust function that explicitly attaches all needed listeners
function setupDashboardEventListenersExplicitly() {
  // Start Quiz Button
  const startQuizBtn = document.getElementById("startQuizBtn");
  if (startQuizBtn) {
    console.log("Found Start Quiz button, attaching listener");
    // Remove any existing listeners by cloning and replacing the element
    const newBtn = startQuizBtn.cloneNode(true);
    startQuizBtn.parentNode.replaceChild(newBtn, startQuizBtn);
    
    // Add the event listener to the new element
    newBtn.addEventListener("click", function(e) {
      console.log("Start Quiz button clicked");
      const quizSetupModal = document.getElementById("quizSetupModal");
      if (quizSetupModal) {
        quizSetupModal.style.display = "block";
      }
    });
  } else {
    console.warn("Start Quiz button not found in DOM");
  }
  
  // User Progress Card
  const userProgressCard = document.getElementById("userProgressCard");
  if (userProgressCard) {
    console.log("Found User Progress card, attaching listener");
    const newCard = userProgressCard.cloneNode(true);
    userProgressCard.parentNode.replaceChild(newCard, userProgressCard);
    newCard.addEventListener("click", function() {
      console.log("User Progress card clicked");
      if (typeof displayPerformance === 'function') {
        window.displayPerformance(); 
      }
    });
  }
  
  // Quick Stats Card
  const quickStatsCard = document.getElementById("quickStatsCard");
  if (quickStatsCard) {
    console.log("Found Quick Stats card, attaching listener");
    const newCard = quickStatsCard.cloneNode(true);
    quickStatsCard.parentNode.replaceChild(newCard, quickStatsCard);
    newCard.addEventListener("click", function() {
      console.log("Quick Stats card clicked");
      if (typeof displayPerformance === 'function') {
        window.displayPerformance(); 
      }
    });
  }
  
  // Leaderboard Preview Card
  const leaderboardPreviewCard = document.getElementById("leaderboardPreviewCard");
  if (leaderboardPreviewCard) {
    console.log("Found Leaderboard Preview card, attaching listener");
    const newCard = leaderboardPreviewCard.cloneNode(true);
    leaderboardPreviewCard.parentNode.replaceChild(newCard, leaderboardPreviewCard);
    newCard.addEventListener("click", function() {
      console.log("Leaderboard Preview card clicked");
      if (typeof showLeaderboard === 'function') {
        showLeaderboard();
      }
    });
  }
  
  // Review Queue Card
  const reviewQueueCard = document.getElementById("reviewQueueCard");
  if (reviewQueueCard) {
    console.log("Found Review Queue card, attaching listener");
    const newCard = reviewQueueCard.cloneNode(true);
    reviewQueueCard.parentNode.replaceChild(newCard, reviewQueueCard);
    newCard.addEventListener("click", function() {
      console.log("Review Queue card clicked");
      if (typeof getDueQuestionIds === 'function') {
        getDueQuestionIds().then(dueQuestionIds => {
          if (dueQuestionIds.length === 0) {
            alert("You have no questions due for review today. Good job!");
            return;
          }
          loadSpecificQuestions(dueQuestionIds);
        });
      }
    });
  }
  
  // Menu Button
  const menuToggle = document.getElementById("menuToggle");
  if (menuToggle) {
    console.log("Found Menu Toggle button, attaching listener");
    const newToggle = menuToggle.cloneNode(true);
    menuToggle.parentNode.replaceChild(newToggle, menuToggle);
    newToggle.addEventListener("click", function() {
      console.log("Menu Toggle button clicked");
      const sideMenu = document.getElementById("sideMenu");
      const menuOverlay = document.getElementById("menuOverlay");
      
      if (sideMenu) sideMenu.classList.add("open");
      if (menuOverlay) menuOverlay.classList.add("show");
    });
  }
  
  // This adds original setup as well in case we missed anything
  if (typeof setupDashboardEvents === 'function') {
    setupDashboardEvents();
  }
  
  console.log("All dashboard event listeners explicitly attached");
}

// Add this function to app.js
// function debugOverlays() {
//   console.log("Debugging overlays...");
//   document.querySelectorAll('*').forEach(el => {
//     if (window.getComputedStyle(el).position === 'fixed' && 
//         el.id !== 'mainOptions' && 
//         !el.classList.contains('toolbar')) {
//       el.style.backgroundColor = 'rgba(255,0,0,0.2)';
//       console.log('Potential overlay:', el);
//     }
//   });
//   document.querySelectorAll('*').forEach(el => {
//     const zIndex = window.getComputedStyle(el).zIndex;
//     if (zIndex !== 'auto' && zIndex > 10) {
//       console.log('High z-index element:', el, 'z-index:', zIndex);
//     }
//   });
// }

// Add this function to your app.js to properly hide all screens
function ensureAllScreensHidden(exceptScreenId) {
  console.log(`Ensuring all screens are properly hidden (except: ${exceptScreenId || 'none'})...`);
  
  // Get all potential overlay screens
  const screens = [
    document.getElementById("welcomeScreen"),
    document.getElementById("loginScreen"),
    document.getElementById("splashScreen")
  ];
  
  // Properly hide all screens except the specified one
  screens.forEach(screen => {
    if (screen && screen.id !== exceptScreenId) {
      // Both set display to none AND set opacity to 0
      screen.style.display = 'none';
      screen.style.opacity = '0';
      console.log(`Hiding screen: ${screen.id}`);
    } else if (screen && screen.id === exceptScreenId) {
      console.log(`Keeping screen visible: ${screen.id}`);
    }
  });
}

// function clearDebugStyles() {
//   console.log("Clearing debug background colors...");
//   document.querySelectorAll('*').forEach(el => {
//     if (el.style.backgroundColor === 'rgba(255, 0, 0, 0.2)') {
//       el.style.backgroundColor = '';
//       console.log(`Cleared debug background from: ${el.id || el.tagName}`);
//     }
//   });
// }

// Add this function to your auth.js or app.js file
async function cleanupOnLogout() {
  console.log("Cleaning up after logout...");

  // Reset the leaderboard loading flag
  isLeaderboardPreviewLoadingOrLoaded = false;
  
  // Clear any cached user data in the UI
  const xpDisplays = [
    document.getElementById("xpDisplay"),
    document.getElementById("dashboardXP"),
    document.getElementById("userXpDisplay")
  ];
  
  // Reset XP displays to 0
  xpDisplays.forEach(element => {
    if (element) {
      element.textContent = "0 XP";
    }
  });
  
  // Reset level displays to 1
  const levelDisplays = [
    document.getElementById("scoreCircle"),
    document.getElementById("dashboardLevel"),
    document.getElementById("userScoreCircle")
  ];
  
  levelDisplays.forEach(element => {
    if (element) {
      element.textContent = "1";
    }
  });
  
  // Reset level progress indicators to 0%
  const progressElements = [
    document.getElementById("levelCircleProgress"),
    document.getElementById("dashboardLevelProgress"),
    document.getElementById("userLevelProgress"),
    document.getElementById("levelProgressBar")
  ];
  
  progressElements.forEach(element => {
    if (element) {
      if (element.style.setProperty) {
        element.style.setProperty('--progress', '0%');
      } else {
        element.style.width = '0%';
      }
    }
  });
  
  // Reset other stats displays
  const statsElements = [
    document.getElementById("dashboardAnswered"),
    document.getElementById("dashboardAccuracy"),
    document.getElementById("currentStreak")
  ];
  
  statsElements.forEach((element, index) => {
    if (element) {
      if (index === 1) { // Accuracy needs % symbol
        element.textContent = "0%";
      } else {
        element.textContent = "0";
      }
    }
  });
  
  // Clear any other cached user-specific data
  // This prevents old data from showing up in the UI
  localStorage.removeItem("quizProgress");
  
  console.log("User display data reset completed");
}

// Add event listeners for Terms and Privacy Policy links
document.addEventListener('DOMContentLoaded', function() {
  // Terms of Service link handler
  document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'registerViewTOS') {
      e.preventDefault();
      document.getElementById('termsOfServiceModal').style.display = 'flex';
    }
    
    // Privacy Policy link handler
    if (e.target && e.target.id === 'registerViewPrivacy') {
      e.preventDefault();
      document.getElementById('privacyPolicyModal').style.display = 'flex';
    }
    
    // Close modal buttons
    if (e.target && e.target.classList.contains('close-modal')) {
      const modal = e.target.closest('.modal');
      if (modal) {
        modal.style.display = 'none';
      }
    }
    
    // Click outside to close
    if (e.target && (e.target.id === 'termsOfServiceModal' || e.target.id === 'privacyPolicyModal')) {
      e.target.style.display = 'none';
    }
  });
  
  // Terms checkbox validation
  const registerForm = document.getElementById('registerForm');
  const agreeTerms = document.getElementById('agreeTerms');
  
  if (registerForm && agreeTerms) {
    registerForm.addEventListener('submit', function(e) {
      if (!agreeTerms.checked) {
        e.preventDefault();
        const termsError = document.getElementById('termsError');
        if (termsError) {
          termsError.textContent = 'You must agree to the Terms of Service and Privacy Policy';
        }
        return false;
      }
    });
  }
});

// Add Forgot Password Functionality
document.addEventListener('DOMContentLoaded', function() {
  // Make sure the modal exists
  ensureForgotPasswordModalExists();
  
  // Add click handler for "Forgot Password" link
  document.addEventListener('click', function(e) {
    // Check if forgot password link was clicked
    if (e.target && e.target.id === 'forgotPasswordLink') {
      e.preventDefault();
      showForgotPasswordModal();
    }
    
    // Handle cancel button click
    if (e.target && e.target.id === 'cancelResetBtn') {
      hideForgotPasswordModal();
    }
  });
  
  // Add submit handler for forgot password form
  const forgotPasswordForm = document.getElementById('forgotPasswordForm');
  if (forgotPasswordForm) {
    forgotPasswordForm.addEventListener('submit', handlePasswordReset);
  }
});

// Make sure the forgot password modal exists in the DOM
function ensureForgotPasswordModalExists() {
  if (!document.getElementById('forgotPasswordModal')) {
    const modal = document.createElement('div');
    modal.id = 'forgotPasswordModal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Reset Password</h2>
          <span class="close-modal">&times;</span>
        </div>
        <div class="modal-body">
          <p>Enter your email address below and we'll send you a link to reset your password.</p>
          
          <form id="forgotPasswordForm">
            <div class="form-group">
              <label for="resetEmail">Email Address</label>
              <input type="email" id="resetEmail" required placeholder="Enter your email">
              <div class="form-error" id="resetEmailError"></div>
            </div>
            
            <div class="reset-loader" id="resetLoader"></div>
            <div id="resetMessage" class="reset-message"></div>
            
            <div class="form-buttons">
              <button type="submit" id="sendResetLinkBtn" class="auth-primary-btn">Send Reset Link</button>
              <button type="button" id="cancelResetBtn" class="auth-secondary-btn">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Add close button functionality
    const closeBtn = modal.querySelector('.close-modal');
    if (closeBtn) {
      closeBtn.addEventListener('click', hideForgotPasswordModal);
    }
    
    // Add click outside to close
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        hideForgotPasswordModal();
      }
    });
  }
}

// Show the forgot password modal
function showForgotPasswordModal() {
  const modal = document.getElementById('forgotPasswordModal');
  if (modal) {
    // Reset form and messages
    const form = document.getElementById('forgotPasswordForm');
    const resetMessage = document.getElementById('resetMessage');
    const resetEmailError = document.getElementById('resetEmailError');
    
    if (form) form.reset();
    if (resetMessage) resetMessage.textContent = '';
    if (resetMessage) resetMessage.className = 'reset-message';
    if (resetEmailError) resetEmailError.textContent = '';
    
    // Show the modal
    modal.style.display = 'flex';
  }
}

// Hide the forgot password modal
function hideForgotPasswordModal() {
  const modal = document.getElementById('forgotPasswordModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Handle password reset form submission
async function handlePasswordReset(e) {
  e.preventDefault();
  
  const emailInput = document.getElementById('resetEmail');
  const resetMessage = document.getElementById('resetMessage');
  const resetEmailError = document.getElementById('resetEmailError');
  const resetLoader = document.getElementById('resetLoader');
  const sendResetLinkBtn = document.getElementById('sendResetLinkBtn');
  const cancelResetBtn = document.getElementById('cancelResetBtn');
  
  // Clear previous messages
  if (resetMessage) resetMessage.textContent = '';
  if (resetMessage) resetMessage.className = 'reset-message';
  if (resetEmailError) resetEmailError.textContent = '';
  
  // Validate email
  const email = emailInput ? emailInput.value.trim() : '';
  if (!email) {
    if (resetEmailError) resetEmailError.textContent = 'Please enter your email address';
    return;
  }
  
  // Show loader and disable buttons
  if (resetLoader) resetLoader.style.display = 'block';
  if (sendResetLinkBtn) sendResetLinkBtn.disabled = true;
  if (cancelResetBtn) cancelResetBtn.disabled = true;
  
  try {
    // Send password reset email using Firebase
    await sendPasswordResetEmail(auth, email);
    
    // Show success message
    if (resetMessage) {
      resetMessage.textContent = 'Password reset email sent! Check your inbox and spam folder.';
      resetMessage.className = 'reset-message success';
    }
    
    // Close the modal after 5 seconds
    setTimeout(hideForgotPasswordModal, 5000);
  } catch (error) {
    console.error('Error sending password reset email:', error);
    
    // Show error message
    if (resetMessage) {
      resetMessage.textContent = getResetErrorMessage(error);
      resetMessage.className = 'reset-message error';
    }
  } finally {
    // Hide loader and enable buttons
    if (resetLoader) resetLoader.style.display = 'none';
    if (sendResetLinkBtn) sendResetLinkBtn.disabled = false;
    if (cancelResetBtn) cancelResetBtn.disabled = false;
  }
}

// Get user-friendly error message for password reset
function getResetErrorMessage(error) {
  const errorCode = error.code;
  
  switch (errorCode) {
    case 'auth/invalid-email':
      return 'Invalid email address format';
    case 'auth/user-not-found':
      return 'No account found with this email';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection.';
    default:
      return error.message || 'An error occurred. Please try again.';
  }
}

// Fix for main login screen
document.addEventListener('DOMContentLoaded', function() {
  // Look for the forgot password link on the main login screen
  const mainLoginForgotPwLink = document.querySelector('#loginScreen a[href="#forgotPassword"]');
  
  if (mainLoginForgotPwLink) {
    // Replace the current click handler with one that uses the actual reset functionality
    mainLoginForgotPwLink.addEventListener('click', function(e) {
      e.preventDefault();
      // Use the existing password reset functionality
      showForgotPasswordModal();
    });
  }
});

// Function to show the registration benefits modal
function showRegistrationBenefitsModal() {
  const modal = document.getElementById('registrationBenefitsModal');
  if (modal) {
    // Reset modal state before showing it
    modal.style.opacity = '1';
    modal.style.zIndex = '9800'; // Ensure high z-index
    modal.style.display = 'flex';
    
    // Clear any previous handlers with completely new buttons
    const createAccountBtn = document.getElementById('createAccountBenefitsBtn');
    const continueAsGuestBtn = document.getElementById('continueAsGuestBtn');
    const closeModal = modal.querySelector('.close-modal');
    
    // Create completely new buttons to eliminate any stale event listeners
    if (createAccountBtn) {
      const newBtn = document.createElement('button');
      newBtn.id = 'createAccountBenefitsBtn';
      newBtn.className = 'auth-primary-btn';
      newBtn.textContent = 'Create Free Account';
      
      createAccountBtn.parentNode.replaceChild(newBtn, createAccountBtn);
      
      newBtn.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent event bubbling
        console.log("Create account button clicked");
        modal.style.display = 'none';
        if (typeof showRegisterForm === 'function') {
          showRegisterForm();
        } else if (typeof window.showRegisterForm === 'function') {
          window.showRegisterForm();
        } else {
          console.error("Registration function not found");
        }
      });
    }
    
    if (continueAsGuestBtn) {
      const newBtn = document.createElement('button');
      newBtn.id = 'continueAsGuestBtn';
      newBtn.className = 'auth-secondary-btn';
      newBtn.textContent = 'Continue as Guest';
      
      continueAsGuestBtn.parentNode.replaceChild(newBtn, continueAsGuestBtn);
      
      newBtn.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent event bubbling
        console.log("Continue as guest button clicked");
        modal.style.display = 'none';
        // Show the main dashboard and ensure it's visible
        const mainOptions = document.getElementById('mainOptions');
        if (mainOptions) {
          mainOptions.style.display = 'flex';
          mainOptions.style.visibility = 'visible';
          
          // Force reinitialize the dashboard to ensure it's properly displayed
          if (typeof initializeDashboard === 'function') {
            setTimeout(initializeDashboard, 100);
          }
        }
      });
    }
    
    if (closeModal) {
      const newClose = document.createElement('span');
      newClose.className = 'close-modal';
      newClose.innerHTML = '&times;';
      
      closeModal.parentNode.replaceChild(newClose, closeModal);
      
      newClose.addEventListener('click', function(e) {
        e.stopPropagation(); // Prevent event bubbling
        console.log("Close modal button clicked");
        modal.style.display = 'none';
        // Show the main dashboard
        const mainOptions = document.getElementById('mainOptions');
        if (mainOptions) {
          mainOptions.style.display = 'flex';
        }
      });
    }
    
    // Also add click handler for the modal background
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        console.log("Modal background clicked");
        modal.style.display = 'none';
        // Show the main dashboard
        const mainOptions = document.getElementById('mainOptions');
        if (mainOptions) {
          mainOptions.style.display = 'flex';
        }
      }
    });
  }
}


// Direct fix for the "Continue as Guest" button in the registration benefits modal
document.addEventListener('DOMContentLoaded', function() {
  // Add a direct event listener for the button, outside of any function
  function fixContinueAsGuestButton() {
    const continueAsGuestBtn = document.getElementById('continueAsGuestBtn');
    
    if (continueAsGuestBtn) {
      console.log("Found Continue as Guest button, adding direct event listener");
      
      // Remove any existing listeners by cloning
      const newBtn = continueAsGuestBtn.cloneNode(true);
      continueAsGuestBtn.parentNode.replaceChild(newBtn, continueAsGuestBtn);
      
      // Add simple, direct click handler
      newBtn.addEventListener('click', function() {
        console.log("Continue as Guest button clicked");
        
        // Close the modal directly
        const modal = document.getElementById('registrationBenefitsModal');
        if (modal) {
          modal.style.display = 'none';
        }
        
        // Show the main dashboard directly
        const mainOptions = document.getElementById('mainOptions');
        if (mainOptions) {
          mainOptions.style.display = 'flex';
          console.log("Main options displayed");
        }
      });
    }
  }
  
  // Run the fix immediately
  fixContinueAsGuestButton();
  
  // Also run the fix after a delay to catch any later DOM changes
  setTimeout(fixContinueAsGuestButton, 1000);
  
  // Add a failsafe method the user can manually call if needed
  window.fixContinueAsGuestButton = fixContinueAsGuestButton;
});

// --- Step 3: Helper Functions ---

// Placeholder function - replace with your actual logic to check subscription
async function checkUserCmeSubscriptionStatus() {
    console.log("Checking CME subscription status (placeholder)...");
    
    if (window.authState && window.authState.user && !window.authState.user.isAnonymous) { // Ensure user is logged in and not guest
        try {
            const userDocRef = doc(db, 'users', window.authState.user.uid);
            const userDocSnap = await getDoc(userDocRef);
            if (userDocSnap.exists()) {
                const userData = userDocSnap.data();
                // --- Replace this line with your actual check ---
                // Example: Check if a field 'cmeSubscriptionActive' is true
                const isActive = userData.cmeSubscriptionActive === true;
                console.log(`Firestore check: User ${window.authState.user.uid}, cmeSubscriptionActive = ${userData.cmeSubscriptionActive}, Result: ${isActive}`);
                return isActive;
            } else {
                console.log("User document not found for subscription check.");
                return false; // No document, no subscription
            }
        } catch (error) {
            console.error("Error checking subscription status in Firestore:", error);
            return false; // Error occurred, assume no subscription
        }
    } else {
         console.log("User not logged in or is anonymous, cannot check subscription.");
         return false; // Not a registered user, no subscription
    }
}

// Function to show the CME Dashboard and hide others
function showCmeDashboard() {
  console.log("Executing showCmeDashboard..."); // For debugging START

  // Define IDs of all top-level views to hide
  const viewsToHide = [
      "mainOptions",
      "performanceView",
      "leaderboardView",
      "aboutView",
      "faqView",
      "welcomeScreen",
      "splashScreen",
      "loginScreen",
      "onboardingLoadingScreen"
      // Add any other top-level view IDs here
  ];
  // Define IDs of modals/forms to hide
  const modalsToHide = [
      "customQuizForm",
      "randomQuizForm",
      "quizSetupModal",
      "cmeQuizSetupModal", // Added CME setup modal
      "cmeClaimModal",     // Added CME claim modal
      "contactModal",
      "feedbackModal",
      "loginModal",
      "registerModal",
      "forgotPasswordModal",
      "registrationBenefitsModal",
      "termsOfServiceModal",
      "privacyPolicyModal"
      // Add other modal IDs
  ];
  // Define elements related to the quiz interface using querySelector for flexibility
  const quizSelectorsToHide = [
      ".swiper",        // The main quiz container
      "#bottomToolbar", // Quiz progress/score bar
      "#iconBar"        // Favorite/Feedback buttons during quiz
  ];

  // Hide all standard views
  viewsToHide.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
          element.style.display = "none";
          console.log(`Hid view: #${id}`);
      } else {
          // console.warn(`View element with ID #${id} not found.`);
      }
  });

  // Hide all modals
  modalsToHide.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
          element.style.display = "none";
          console.log(`Hid modal: #${id}`);
      } else {
           // console.warn(`Modal element with ID #${id} not found.`);
      }
  });

   // Hide quiz interface elements
   quizSelectorsToHide.forEach(selector => {
      const element = document.querySelector(selector); // Use querySelector
      if (element) {
          element.style.display = "none";
          console.log(`Hid quiz element: ${selector}`);
      } else {
           console.warn(`Quiz element with selector ${selector} not found.`);
      }
  });

  // Show the CME dashboard
  const cmeDashboard = document.getElementById("cmeDashboardView");
  if (cmeDashboard) {
      console.log("Attempting to show #cmeDashboardView...");
      cmeDashboard.style.display = "block"; // Or 'flex' depending on your CSS
      console.log("Set #cmeDashboardView display to 'block'.");
      // Load data AFTER showing the view
      loadCmeDashboardData();
      showCmeToolbarInfo();   // <--- ADD THIS LINE to update the toolbar
  } else {
      console.error("CRITICAL: CME Dashboard element (#cmeDashboardView) not found.");
  }
  console.log("showCmeDashboard finished."); // For debugging END
}

window.showCmeDashboard = showCmeDashboard; // Make the function globally accessible


// --- Step 12b: Helper Function to Prepare Claim Modal ---

async function prepareClaimModal() {
  console.log("Preparing claim modal...");
  const availableCreditsSpan = document.getElementById("claimModalAvailableCredits");
  const creditsInput = document.getElementById("creditsToClaimInput");
  const errorDiv = document.getElementById("claimModalError");
  const form = document.getElementById("cmeClaimForm");
  // const biasCommentDiv = document.getElementById("commercialBiasCommentDiv"); // No longer used with new form
  // const biasCommentTextarea = document.getElementById("evalCommercialBiasComment"); // No longer used with new form
  const loadingIndicator = document.getElementById('claimLoadingIndicator');
  const submitButton = document.getElementById('submitCmeClaimBtn');
  const cancelButton = document.getElementById('cancelCmeClaimBtn'); // Get the cancel button
  const linkContainer = document.getElementById('claimModalLink');   // Get the link container
  const closeButtonX = document.getElementById('closeCmeClaimModal'); // Get the 'X' close button

  // Reset form elements and messages
  if (form) form.reset();
  if (errorDiv) {
      errorDiv.textContent = '';
      // Also reset any styling applied to the errorDiv on failure
      errorDiv.style.color = '';
      errorDiv.style.border = '';
      errorDiv.style.backgroundColor = '';
      errorDiv.style.padding = '';
      errorDiv.style.borderRadius = '';
      errorDiv.innerHTML = ''; // Clear any HTML content like the input field for URL
  }
  if (loadingIndicator) loadingIndicator.style.display = 'none';

  // --- KEY CHANGES FOR UI RESET ---
  if (linkContainer) {
      linkContainer.innerHTML = ''; // Clear any old link HTML
      linkContainer.style.display = 'none'; // Hide the link container
  }

  if (submitButton) {
      submitButton.disabled = false;
      submitButton.style.display = 'inline-block'; // Or 'block' if it's full width, match original CSS
      // If you changed its text (e.g., "Processing..."), reset it here if needed, though usually handled in submit logic
      // submitButton.textContent = "Submit Claim";
  }

  if (cancelButton) {
      cancelButton.disabled = false;
      cancelButton.style.display = 'inline-block'; // Or 'block', match original CSS
  }

  if (closeButtonX) {
      closeButtonX.style.display = 'block'; // Ensure the 'X' close button is visible
      // If its onclick was changed, you might need to reset it, but usually not necessary if it just closes.
  }
  // --- END KEY CHANGES ---

  // Fetch latest available credits
  let availableCredits = 0.00;
  if (window.authState && window.authState.user && !window.authState.user.isAnonymous) {
      try {
          const uid = window.authState.user.uid;
          const userDocRef = doc(db, 'users', uid);
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists()) {
              const cmeStats = userDocSnap.data().cmeStats || {};
              const earned = parseFloat(cmeStats.creditsEarned || 0);
              const claimed = parseFloat(cmeStats.creditsClaimed || 0);
              availableCredits = Math.max(0, earned - claimed);
          }
      } catch (error) {
          console.error("Error fetching available credits for modal:", error);
          if (errorDiv) errorDiv.textContent = "Error loading available credits.";
      }
  }

  // Update display and input attributes
  const formattedAvailable = availableCredits.toFixed(2);
  if (availableCreditsSpan) {
      availableCreditsSpan.textContent = formattedAvailable;
  }
  if (creditsInput) {
      creditsInput.value = formattedAvailable; // Default input to max available
      creditsInput.max = formattedAvailable; // Set max attribute dynamically
      creditsInput.min = "0.25"; // Ensure min is set
      creditsInput.step = "0.25"; // Ensure step is set
  }

  console.log(`Claim modal prepared. Available credits: ${formattedAvailable}`);
}

// --- End of Step 12b ---



// --- Replace your entire handleCmeClaimSubmission function with this one ---

async function handleCmeClaimSubmission(event) {
  event.preventDefault();
  console.log("CME Claim Form submitted - calling Cloud Function...");

  const errorDiv = document.getElementById("claimModalError");
  const loadingIndicator = document.getElementById('claimLoadingIndicator');
  const submitButton = document.getElementById('submitCmeClaimBtn');
  const cancelButton = document.getElementById('cancelCmeClaimBtn');
  const form = document.getElementById('cmeClaimForm');
  const creditsInput = document.getElementById('creditsToClaimInput');
  const linkContainer = document.getElementById('claimModalLink');

  // --- UI Helper ---
  const setUiState = (state) => {
      if (state === 'loading') {
          if (loadingIndicator) loadingIndicator.style.display = 'block';
          if (submitButton) submitButton.disabled = true;
          if (cancelButton) cancelButton.disabled = true;
      } else if (state === 'success') {
          if (loadingIndicator) loadingIndicator.style.display = 'none';
          if (submitButton) submitButton.style.display = 'none';
          if (cancelButton) cancelButton.style.display = 'none';
          if (linkContainer) linkContainer.style.display = 'block';
      } else { // 'idle' or 'error'
          if (loadingIndicator) loadingIndicator.style.display = 'none';
          if (submitButton) submitButton.disabled = false;
          if (cancelButton) cancelButton.disabled = false;
      }
  };

  // --- Clear previous errors & Show Loader ---
  if (errorDiv) errorDiv.innerHTML = '';
  setUiState('loading');
  if(loadingIndicator) loadingIndicator.querySelector('p').textContent = 'Processing claim...';

  try {
    // --- 1. Get Form Data & Validate on Client ---
    const formData = new FormData(form);
    const creditsToClaim = parseFloat(creditsInput.value);
    const certificateFullName = formData.get('certificateFullName')?.trim() || '';
    const certificateDegree = formData.get('certificateDegree');

    const evaluationData = {
        licenseNumber: formData.get('licenseNumber')?.trim() || '',
        locationCity: formData.get('locationCity')?.trim() || '',
        locationState: formData.get('locationState'),
        desiredOutcome1: formData.get('desiredOutcome1'),
        desiredOutcome2: formData.get('desiredOutcome2'),
        desiredOutcome3: formData.get('desiredOutcome3'),
        desiredOutcome4: formData.get('desiredOutcome4'),
        desiredOutcome5: formData.get('desiredOutcome5'),
        practiceChangesText: formData.get('evalPracticeChangesText')?.trim() || '',
        commercialBiasExplainText: formData.get('evalCommercialBiasExplainText')?.trim() || '',
    };

    if (!certificateFullName || !certificateDegree || !evaluationData.licenseNumber || !evaluationData.locationCity || !evaluationData.locationState || !evaluationData.desiredOutcome1 || !evaluationData.desiredOutcome2 || !evaluationData.desiredOutcome3 || !evaluationData.desiredOutcome4 || !evaluationData.desiredOutcome5) {
        throw new Error("Please fill out all required fields in the form.");
    }
    if (isNaN(creditsToClaim) || creditsToClaim <= 0 || creditsToClaim % 0.25 !== 0) {
        throw new Error("Invalid credits amount. Must be positive and in increments of 0.25.");
    }

    // --- 2. Call the Cloud Function ---
    if (!window.generateCmeCertificateFunction) {
        throw new Error("Certificate service is not available. Please refresh.");
    }
    
    if(loadingIndicator) loadingIndicator.querySelector('p').textContent = 'Generating certificate...';
    
    const result = await window.generateCmeCertificateFunction({
        certificateFullName,
        creditsToClaim,
        certificateDegree,
        evaluationData // Pass all evaluation data
    });

    if (!result.data.success || !result.data.filePath) {
        throw new Error(result.data.message || "Certificate generation failed on the server.");
    }

    // --- 3. Get Signed URL for Immediate Download ---
    if(loadingIndicator) loadingIndicator.querySelector('p').textContent = 'Preparing download link...';
    const filePath = result.data.filePath;
    const urlResult = await getCertificateDownloadUrlFunction({ filePath });

    if (!urlResult.data.success || !urlResult.data.downloadUrl) {
        throw new Error("Certificate was created, but the download link could not be generated.");
    }

    // --- 4. Display Success and Download Link ---
    const signedUrl = urlResult.data.downloadUrl;
    const pdfFileName = filePath.split('/').pop();
    setUiState('success');
    if (linkContainer) {
        linkContainer.innerHTML = `
            <p style="color: #28a745; font-weight: bold; margin-bottom: 10px;">
                Your CME certificate is ready!
            </p>
            <a href="${signedUrl}" target="_blank" download="${pdfFileName}" class="auth-primary-btn" style="display: inline-block; padding: 10px 15px; text-decoration: none; margin-top: 5px; background-color: #28a745; border: none;">
                Download Certificate
            </a>
            <p style="font-size: 0.8em; color: #666; margin-top: 10px;">(Link opens in a new tab and is valid for 15 minutes.)</p>
        `;
    }

    // --- 5. Refresh Dashboard Data ---
    if (typeof loadCmeDashboardData === 'function') {
        setTimeout(loadCmeDashboardData, 500);
    }

  } catch (error) {
      console.error("Error during claim submission:", error);
      setUiState('error');
      if (errorDiv) {
          errorDiv.innerHTML = `<p style="color: red;">${error.message}</p>`;
      }
  }
}


// --- Step 5b: Populate CME Category Dropdown ---

async function populateCmeCategoryDropdown() {
    const categorySelect = document.getElementById("cmeCategorySelect");
    if (!categorySelect) {
        console.error("CME Category Select dropdown (#cmeCategorySelect) not found.");
        return;
    }

    // Clear existing options except the first "All" option
    while (categorySelect.options.length > 1) {
        categorySelect.remove(1);
    }

    try {
        // Fetch all questions to extract categories
        // Note: This fetches all questions just for categories.
        // If performance becomes an issue with a very large sheet,
        // consider storing categories separately in Firestore.
        const allQuestions = await fetchQuestionBank(); // Assuming fetchQuestionBank is globally available or defined in this file

        // Filter for CME eligible questions first
        const cmeEligibleQuestions = allQuestions.filter(q => {
          const cmeEligibleValue = q["CME Eligible"];
          // Handle both boolean true and string "yes" (case-insensitive)
          return (typeof cmeEligibleValue === 'boolean' && cmeEligibleValue === true) ||
                 (typeof cmeEligibleValue === 'string' && cmeEligibleValue.trim().toLowerCase() === 'yes');
      });

        // Get unique categories from CME-eligible questions
        const categories = [...new Set(cmeEligibleQuestions
            .map(q => q.Category ? q.Category.trim() : null) // Get category, trim whitespace
            .filter(cat => cat && cat !== "") // Filter out null/empty categories
        )].sort(); // Sort alphabetically

        // Add categories to the dropdown
        categories.forEach(category => {
            const option = document.createElement("option");
            option.value = category;
            option.textContent = category;
            categorySelect.appendChild(option);
        });
        console.log("CME Category dropdown populated with:", categories);

    } catch (error) {
        console.error("Error fetching or processing questions for categories:", error);
        // Optionally inform the user
        // alert("Could not load categories. Please try again later.");
    }
}

// --- End of Step 5b Code ---

// --- Step 9: Load and Display CME Dashboard Data ---

// --- Step 9: Load and Display CME Dashboard Data (MODIFIED for Unique Counts & Remaining) ---

let clientActiveCmeYearId = null; 
window.clientActiveCmeYearId = null; // Make it global

// You would call this from your recordCmeAnswer function in user.v2.js
// after a successful call to the recordCmeAnswerV2 cloud function
// e.g., clientActiveCmeYearId = cfResponse.activeYearId;
window.setActiveCmeYearClientSide = (yearId) => {
    clientActiveCmeYearId = yearId;
    console.log("Client-side active CME year set to:", clientActiveCmeYearId);
};


async function loadCmeDashboardData() {
  console.log("Loading CME dashboard data (year-specific remaining)...");
  const trackerContent = document.getElementById("cmeTrackerContent");
  const historyContent = document.getElementById("cmeHistoryContent"); // Keep for history
  const claimButton = document.getElementById("claimCmeBtn"); // Keep for claiming

  if (!trackerContent || !historyContent || !claimButton) {
      console.error("Required CME dashboard elements not found.");
      return;
  }

  trackerContent.innerHTML = "<p>Loading tracker data...</p>";
  historyContent.innerHTML = "<p>Loading history...</p>"; // Keep
  claimButton.disabled = true; // Keep

  if (!window.authState || !window.authState.user || window.authState.user.isAnonymous) {
      trackerContent.innerHTML = "<p>Please log in as a registered user to view CME data.</p>";
      historyContent.innerHTML = "<p>Login required.</p>"; // Keep
      return;
  }

  const uid = window.authState.user.uid;

  let currentActiveYearId = window.clientActiveCmeYearId; // Try cached first

  if (!currentActiveYearId) { // If no cached value, try fetching it
      if (typeof window.getActiveCmeYearIdFromFirestore === 'function') {
          console.log("No cached CME year, attempting to fetch from Firestore for dashboard...");
          currentActiveYearId = await window.getActiveCmeYearIdFromFirestore();
          if (currentActiveYearId && typeof window.setActiveCmeYearClientSide === 'function') {
              window.setActiveCmeYearClientSide(currentActiveYearId); // Cache it
          }
      } else {
          console.error("getActiveCmeYearIdFromFirestore function is not available on window object for dashboard!");
      }
  }

  if (!currentActiveYearId) {
      trackerContent.innerHTML = "<p>Could not determine the current CME year. Please try answering a CME question first to sync the active year, or check back later.</p>";
      // Load history and claim button based on overall stats as a fallback
      try {
        const userDocRefOverall = doc(db, 'users', uid);
        const userDocSnapOverall = await getDoc(userDocRefOverall);
        if (userDocSnapOverall.exists()) {
            const dataOverall = userDocSnapOverall.data();
            const cmeStatsOverall = dataOverall.cmeStats || { creditsEarned: 0, creditsClaimed: 0 };
            const creditsEarnedOverall = parseFloat(cmeStatsOverall.creditsEarned || 0).toFixed(2);
            const creditsClaimedOverall = parseFloat(cmeStatsOverall.creditsClaimed || 0).toFixed(2);
            const creditsAvailableOverall = Math.max(0, parseFloat(creditsEarnedOverall) - parseFloat(creditsClaimedOverall)).toFixed(2);
            if (parseFloat(creditsAvailableOverall) >= 0.25) {
                claimButton.disabled = false;
                claimButton.textContent = `Claim ${creditsAvailableOverall} Credits`;
            } else {
                claimButton.disabled = true;
                claimButton.textContent = "Claim CME Credits";
            }
            // Load history (as before)
            const cmeHistory = dataOverall.cmeClaimHistory || [];
             if (cmeHistory.length > 0) {
                cmeHistory.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));
                let historyHtml = `<table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;"><thead><tr style="border-bottom: 1px solid #ddd; text-align: left;"><th style="padding: 8px 5px;">Date Claimed</th><th style="padding: 8px 5px; text-align: right;">Credits</th><th style="padding: 8px 5px; text-align: center;">Certificate</th></tr></thead><tbody>`;
                cmeHistory.forEach(claim => {
                    const credits = parseFloat(claim.creditsClaimed || 0).toFixed(2);
                    let claimDate = 'Unknown Date';
                    if (claim.timestamp && typeof claim.timestamp.toDate === 'function') { claimDate = claim.timestamp.toDate().toLocaleDateString(); }
                    else if (claim.timestamp instanceof Date) { claimDate = claim.timestamp.toLocaleDateString(); }
                    let downloadCellContent = '-';
                    if (claim.downloadUrl) { downloadCellContent = `<a href="${claim.downloadUrl}" target="_blank" download="${claim.pdfFileName || 'CME_Certificate.pdf'}" class="cme-download-btn" title="Download PDF">⬇️ PDF</a>`; }
                    historyHtml += `<tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px 5px;">${claimDate}</td><td style="padding: 8px 5px; text-align: right;">${credits}</td><td style="padding: 8px 5px; text-align: center;">${downloadCellContent}</td></tr>`;
                });
                historyHtml += `</tbody></table><style>.cme-download-btn { display: inline-block; padding: 3px 8px; font-size: 0.8em; color: white; background-color: #007bff; border: none; border-radius: 4px; text-decoration: none; cursor: pointer; transition: background-color 0.2s; }.cme-download-btn:hover { background-color: #0056b3; }</style>`;
                historyContent.innerHTML = historyHtml;
            } else { historyContent.innerHTML = "<p style='text-align: center; color: #666;'>No credits claimed yet.</p>"; }
        } else {
            trackerContent.innerHTML = "<p>User data not found. Cannot display CME information.</p>";
            historyContent.innerHTML = "<p>User data not found.</p>";
        }
      } catch (e) { 
        console.error("Error loading fallback overall stats for claim button/history", e);
        trackerContent.innerHTML = "<p style='color:red;'>Error loading CME data.</p>";
      }
      return;
  }
  console.log(`Displaying CME dashboard data for year: ${currentActiveYearId}`);

  const yearStatsDocRef = doc(db, 'users', uid, 'cmeStats', currentActiveYearId);
  const mainUserDocRef = doc(db, 'users', uid); 

  try {
      const [yearStatsSnap, mainUserSnap, allQuestions] = await Promise.all([
          getDoc(yearStatsDocRef),
          getDoc(mainUserDocRef),
          fetchQuestionBank()
      ]);

      let totalAnsweredInYear = 0;
      let totalCorrectInYear = 0; // Not directly displayed but good to fetch

      if (yearStatsSnap.exists()) {
          const yearData = yearStatsSnap.data();
          totalAnsweredInYear = yearData.totalAnsweredInYear || 0;
          totalCorrectInYear = yearData.totalCorrectInYear || 0;
      } else {
          console.warn(`No CME stats found for user ${uid} for the active year ${currentActiveYearId}. Displaying 0 for year-specific counts.`);
      }

      const cmeEligibleQuestions = allQuestions.filter(q => {
        const cmeEligibleValue = q["CME Eligible"];
        return (typeof cmeEligibleValue === 'boolean' && cmeEligibleValue === true) ||
               (typeof cmeEligibleValue === 'string' && cmeEligibleValue.trim().toLowerCase() === 'yes');
      });
      const totalCmeEligibleInBank = cmeEligibleQuestions.length;
      const remainingCmeQuestionsThisYear = Math.max(0, totalCmeEligibleInBank - totalAnsweredInYear);

      let overallAccuracy = 0;
      let overallCreditsEarned = "0.00";
      let overallCreditsClaimed = "0.00";
      let overallCreditsAvailable = "0.00";
      let overallTotalCorrect = 0; 
      let overallTotalAnsweredForAccuracy = 0; // For calculating overall accuracy

      if (mainUserSnap.exists()) {
          const mainData = mainUserSnap.data();
          const cmeStatsOverall = mainData.cmeStats || { totalAnswered: 0, totalCorrect: 0, creditsEarned: 0, creditsClaimed: 0 };
          overallTotalCorrect = cmeStatsOverall.totalCorrect || 0;
          overallTotalAnsweredForAccuracy = cmeStatsOverall.totalAnswered || 0;

          if (overallTotalAnsweredForAccuracy > 0) {
              overallAccuracy = Math.round((overallTotalCorrect / overallTotalAnsweredForAccuracy) * 100);
          }
          overallCreditsEarned = parseFloat(cmeStatsOverall.creditsEarned || 0).toFixed(2);
          overallCreditsClaimed = parseFloat(cmeStatsOverall.creditsClaimed || 0).toFixed(2);
          overallCreditsAvailable = Math.max(0, parseFloat(overallCreditsEarned) - parseFloat(overallCreditsClaimed)).toFixed(2);
          
          if (parseFloat(overallCreditsAvailable) >= 0.25) {
              claimButton.disabled = false;
              claimButton.textContent = `Claim ${overallCreditsAvailable} Credits`;
          } else {
              claimButton.disabled = true;
              claimButton.textContent = "Claim CME Credits";
          }

          // --- Replace the old block with this new one ---

          const cmeHistory = mainData.cmeClaimHistory || [];
          if (cmeHistory.length > 0) {
              cmeHistory.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));
              let historyHtml = `<table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;"><thead><tr style="border-bottom: 1px solid #ddd; text-align: left;"><th style="padding: 8px 5px;">Date Claimed</th><th style="padding: 8px 5px; text-align: right;">Credits</th><th style="padding: 8px 5px; text-align: center;">Certificate</th></tr></thead><tbody>`;
              cmeHistory.forEach(claim => {
                  const credits = parseFloat(claim.creditsClaimed || 0).toFixed(2);
                  let claimDate = 'Unknown Date';
                  if (claim.timestamp && typeof claim.timestamp.toDate === 'function') { claimDate = claim.timestamp.toDate().toLocaleDateString(); }
                  else if (claim.timestamp instanceof Date) { claimDate = claim.timestamp.toLocaleDateString(); }
                  
                  // THIS IS THE CORRECTED LOGIC
                  let downloadCellContent = '-';
                  if (claim.filePath) {
                      const filePath = claim.filePath;
                      const fileName = claim.pdfFileName || 'CME_Certificate.pdf';
                      downloadCellContent = `
                          <button
                             onclick="handleCertificateDownload(this, '${filePath}', '${fileName}')"
                             class="cme-history-download-btn"
                             title="Download ${fileName}">
                              ⬇️ PDF
                          </button>`;
                  }
                  // END OF CORRECTED LOGIC

                  historyHtml += `<tr style="border-bottom: 1px solid #eee;"><td style="padding: 8px 5px;">${claimDate}</td><td style="padding: 8px 5px; text-align: right;">${credits}</td><td style="padding: 8px 5px; text-align: center;">${downloadCellContent}</td></tr>`;
              });
              historyHtml += `</tbody></table><style>.cme-history-download-btn { display: inline-block; padding: 3px 8px; font-size: 0.8em; color: white; background-color: #007bff; border: none; border-radius: 4px; text-decoration: none; cursor: pointer; transition: background-color 0.2s; }.cme-history-download-btn:hover { background-color: #0056b3; }</style>`;
              historyContent.innerHTML = historyHtml;
          } else { historyContent.innerHTML = "<p style='text-align: center; color: #666;'>No credits claimed yet.</p>"; }
      } else {
          // Main user document doesn't exist, which is highly unlikely if they are authenticated
          console.error(`Main user document for UID ${uid} not found. Cannot display overall CME stats.`);
          trackerContent.innerHTML = "<p style='color: red;'>Error: User data missing.</p>";
          historyContent.innerHTML = "<p>Error: User data missing.</p>";
          return;
      }


      trackerContent.innerHTML = `
          <div style="text-align: center; margin-bottom:10px; font-weight:bold; color: #0056b3;">Stats for CME Year: ${currentActiveYearId}</div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 15px;">
              <div style="text-align: center;">
                  <div style="font-size: 1.4em; font-weight: bold; color: #0C72D3;">${totalAnsweredInYear}</div>
                  <div style="font-size: 0.8em; color: #555;">Answered (This Year)</div>
              </div>
              <div style="text-align: center;">
                  <div style="font-size: 1.4em; font-weight: bold; color: #0C72D3;">${overallTotalCorrect}</div>
                  <div style="font-size: 0.8em; color: #555;">Correct (Overall)</div>
              </div>
               <div style="text-align: center;">
                  <div style="font-size: 1.4em; font-weight: bold; color: ${overallAccuracy >= 70 ? '#28a745' : '#dc3545'};">${overallAccuracy}%</div>
                  <div style="font-size: 0.8em; color: #555;">Accuracy (Overall)</div>
              </div>
               <div style="text-align: center;">
                  <div style="font-size: 1.4em; font-weight: bold; color: #0C72D3;">${remainingCmeQuestionsThisYear}</div>
                  <div style="font-size: 0.8em; color: #555;">Remaining (This Year)</div>
              </div>
               <div style="text-align: center;">
                  <div style="font-size: 1.4em; font-weight: bold; color: #0C72D3;">${overallCreditsEarned}</div>
                  <div style="font-size: 0.8em; color: #555;">Total Credits Earned</div>
              </div>
               <div style="text-align: center;">
                  <div style="font-size: 1.4em; font-weight: bold; color: #0C72D3;">${overallCreditsAvailable}</div>
                  <div style="font-size: 0.8em; color: #555;">Available to Claim</div>
              </div>
          </div>
          ${overallAccuracy < 70 && overallTotalAnsweredForAccuracy > 0 ? '<p style="color: #dc3545; font-size: 0.85rem; text-align: center; margin-top: 10px;">Note: Overall Accuracy is below 70%. Yearly accuracy also impacts credit earning per year.</p>' : ''}
      `;

    console.log(`CME dashboard data loaded. For Year ${currentActiveYearId}: Answered=${totalAnsweredInYear}, Remaining=${remainingCmeQuestionsThisYear}. Overall available to claim: ${overallCreditsAvailable}`);

  } catch (error) {
      console.error("Error loading CME dashboard data (year-specific):", error);
      trackerContent.innerHTML = "<p style='color: red;'>Error loading tracker data.</p>";
      // Fallback for history and claim button if year-specific load fails but main user doc might still be readable
      try {
        const userDocRefOverall = doc(db, 'users', uid);
        const userDocSnapOverall = await getDoc(userDocRefOverall);
        if (userDocSnapOverall.exists()) {
            const dataOverall = userDocSnapOverall.data();
            const cmeStatsOverall = dataOverall.cmeStats || { creditsEarned: 0, creditsClaimed: 0 };
            const creditsEarnedOverall = parseFloat(cmeStatsOverall.creditsEarned || 0).toFixed(2);
            const creditsClaimedOverall = parseFloat(cmeStatsOverall.creditsClaimed || 0).toFixed(2);
            const creditsAvailableOverall = Math.max(0, parseFloat(creditsEarnedOverall) - parseFloat(creditsClaimedOverall)).toFixed(2);
             if (parseFloat(creditsAvailableOverall) >= 0.25) {
                claimButton.disabled = false;
                claimButton.textContent = `Claim ${creditsAvailableOverall} Credits`;
            } else {
                claimButton.disabled = true;
                claimButton.textContent = "Claim CME Credits";
            }
            const cmeHistory = dataOverall.cmeClaimHistory || [];
            if (cmeHistory.length > 0) { /* ... history display ... */ } else { historyContent.innerHTML = "<p style='text-align: center; color: #666;'>No credits claimed yet.</p>"; }
        }
      } catch (e) { console.error("Error in fallback history/claim button update", e); }
  }
}

// --- Function to Show the CME Info/Paywall Screen ---
function showCmeInfoScreen() {
  console.log("Executing showCmeInfoScreen...");

  // Define IDs of views/modals/elements to hide
  const elementsToHideIds = [
      "mainOptions", "cmeDashboardView", "performanceView", "leaderboardView",
      "aboutView", "faqView", "welcomeScreen", "splashScreen", "loginScreen",
      "onboardingLoadingScreen", "customQuizForm", "randomQuizForm",
      "quizSetupModal", "cmeQuizSetupModal", "cmeClaimModal", "contactModal",
      "feedbackModal", "loginModal", "registerModal", "forgotPasswordModal",
      "registrationBenefitsModal", "termsOfServiceModal", "privacyPolicyModal"
  ];
  const elementsToHideSelectors = [".swiper", "#bottomToolbar", "#iconBar"];

  // Hide elements by ID
  elementsToHideIds.forEach(id => {
      const element = document.getElementById(id);
      if (element) {
          element.style.display = "none";
          console.log(`Hid element: #${id}`);
      }
  });

  // Hide elements by selector
  elementsToHideSelectors.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
          element.style.display = "none";
          console.log(`Hid element: ${selector}`);
      }
  });

  // Show the CME Info Screen
  const cmeInfoScreen = document.getElementById("cmeInfoScreen");
  if (cmeInfoScreen) {
      cmeInfoScreen.style.display = "flex"; // Use 'flex' because of the CSS styling we added
      console.log("Displayed #cmeInfoScreen.");
      document.body.style.overflow = '';
  } else {
      console.error("CME Info Screen (#cmeInfoScreen) not found!");
  }
}

// --- Event Listeners for CME Info Screen Buttons ---

// Back Button
const cmeInfoBackBtn = document.getElementById("cmeInfoBackBtn");
if (cmeInfoBackBtn) {
  cmeInfoBackBtn.addEventListener("click", function() {
      console.log("CME Info Back button clicked.");
      const cmeInfoScreen = document.getElementById("cmeInfoScreen");
      const mainOptions = document.getElementById("mainOptions");

      if (cmeInfoScreen) cmeInfoScreen.style.display = "none";
      if (mainOptions) mainOptions.style.display = "flex"; // Show main dashboard
  });
} else {
  console.error("CME Info Back button (#cmeInfoBackBtn) not found.");
}

// Unlock CME Button
const unlockCmeBtn = document.getElementById("unlockCmeBtn");
if (unlockCmeBtn) {
  unlockCmeBtn.addEventListener("click", function() {
      console.log("Unlock CME button clicked.");

      // Check authentication state
      if (window.authState && window.authState.isRegistered) {
          // User is already registered (e.g., free_guest tier), go directly to CME Pricing Screen
          console.log("User is registered. Showing CME Pricing Screen.");
          showCmePricingScreen();
      } else {
          // User is anonymous (guest), hide the current screen and show the registration modal.
          console.log("User is anonymous. Hiding info screen and showing registration form, will redirect to CME pricing after.");

          // --- FIX: Hide the current screen before showing the modal ---
          const cmeInfoScreen = document.getElementById("cmeInfoScreen");
          if (cmeInfoScreen) {
              cmeInfoScreen.style.display = "none";
          }
          // --- END FIX ---

          if (typeof showRegisterForm === 'function') {
              // Set a flag for post-registration redirection
              sessionStorage.setItem('pendingRedirectAfterRegistration', 'cme_pricing');
              showRegisterForm('cme_pricing'); // Pass 'cme_pricing' as the next step
          } else {
              console.error("showRegisterForm function not found!");
              // Fallback: maybe show main options or an error
              const mainOptions = document.getElementById("mainOptions");
              if (mainOptions) mainOptions.style.display = "flex";
          }
      }
  });
} else {
  console.error("Unlock CME button (#unlockCmeBtn) not found.");
}

// Learn More Link (Placeholder)
const learnMoreCmeLink = document.getElementById("learnMoreCmeLink");
if (learnMoreCmeLink) {
  learnMoreCmeLink.addEventListener("click", function(e) {
      e.preventDefault(); // Prevent default link behavior
      console.log("Learn More link clicked.");
      // Pass the return path so the modal knows where to go back to
      showCmeLearnMoreModal('cmeInfoScreen'); 
  });
} else {
  console.error("Learn More link (#learnMoreCmeLink) not found.");
}

// --- Function to Show the CME Pricing Screen ---
function showCmePricingScreen() {
  console.log("Executing showCmePricingScreen...");

  // Hide the Info Screen first
  const cmeInfoScreen = document.getElementById("cmeInfoScreen");
  if (cmeInfoScreen) {
      cmeInfoScreen.style.display = "none";
  }

  // Show the Pricing Screen
  const cmePricingScreen = document.getElementById("cmePricingScreen");
  if (cmePricingScreen) {
      cmePricingScreen.style.display = "flex"; // Use 'flex' based on CSS
      // Default to Annual view when showing
      updatePricingView('annual');
      console.log("Displayed #cmePricingScreen.");
  } else {
      console.error("CME Pricing Screen (#cmePricingScreen) not found!");
  }
}

// --- Helper function to update pricing view ---
function updatePricingView(planType) {
  const priceDisplay = document.getElementById('cmePriceDisplay');
  const annualBtn = document.getElementById('cmeAnnualBtn');
  const monthlyBtn = document.getElementById('cmeMonthlyBtn');
  const annualFeatureList = document.getElementById('cmeFeatureList'); // Get annual list
  const monthlyFeatureList = document.getElementById('cmeMonthlyFeatureList'); // Get monthly list

  // Exit if any essential element is missing
  if (!priceDisplay || !annualBtn || !monthlyBtn || !annualFeatureList || !monthlyFeatureList) {
       console.error("One or more pricing view elements are missing.");
       return;
  }


  if (planType === 'annual') {
      priceDisplay.textContent = '$149/year';
      annualBtn.classList.add('active');
      monthlyBtn.classList.remove('active');
      annualFeatureList.style.display = 'inline-block'; // Show annual features
      monthlyFeatureList.style.display = 'none'; // Hide monthly features
      console.log("Switched to Annual pricing view.");
  } else if (planType === 'monthly') {
      priceDisplay.textContent = '$14.99/month';
      monthlyBtn.classList.add('active');
      annualBtn.classList.remove('active');
      annualFeatureList.style.display = 'none'; // Hide annual features
      monthlyFeatureList.style.display = 'inline-block'; // Show monthly features
      console.log("Switched to Monthly pricing view.");
  }
}


// --- Event Listeners for CME Pricing Screen Buttons ---

// Back Button (Pricing Screen to Info Screen)
const cmePricingBackBtn = document.getElementById("cmePricingBackBtn");
if (cmePricingBackBtn) {
  cmePricingBackBtn.addEventListener("click", function() {
      console.log("CME Pricing Back button clicked.");
      const cmePricingScreen = document.getElementById("cmePricingScreen");
      const cmeInfoScreen = document.getElementById("cmeInfoScreen");

      if (cmePricingScreen) cmePricingScreen.style.display = "none";
      if (cmeInfoScreen) cmeInfoScreen.style.display = "flex"; // Show info screen again
  });
} else {
  console.error("CME Pricing Back button (#cmePricingBackBtn) not found.");
}

// Annual Toggle Button
const cmeAnnualBtn = document.getElementById("cmeAnnualBtn");
if (cmeAnnualBtn) {
  cmeAnnualBtn.addEventListener("click", function() {
      updatePricingView('annual');
  });
} else {
  console.error("CME Annual button (#cmeAnnualBtn) not found.");
}

// --- Logic for Pricing Screen Tab Switching ---

const annualTabBtn = document.getElementById('cmeAnnualBtn');
const payPerCreditTabBtn = document.getElementById('cmePayPerCreditBtn');
const annualContent = document.getElementById('cmeAnnualContent');
const payPerCreditContent = document.getElementById('cmePayPerCreditContent');

// Listener for Annual Tab
if (annualTabBtn && annualContent && payPerCreditContent) {
    annualTabBtn.addEventListener('click', () => {
        console.log("Annual tab clicked");
        // Update button states
        annualTabBtn.classList.add('active');
        if (payPerCreditTabBtn) payPerCreditTabBtn.classList.remove('active');

        // Update content visibility
        annualContent.style.display = 'block'; // Or 'flex' if you prefer
        payPerCreditContent.style.display = 'none';
    });
} else {
     console.error("Missing elements for Annual tab functionality.");
}

// Listener for Pay-Per-Credit Tab
if (payPerCreditTabBtn && annualContent && payPerCreditContent) {
    payPerCreditTabBtn.addEventListener('click', () => {
        console.log("Pay-Per-Credit tab clicked");
        // Update button states
        payPerCreditTabBtn.classList.add('active');
        if (annualTabBtn) annualTabBtn.classList.remove('active');

        // Update content visibility
        payPerCreditContent.style.display = 'block'; // Or 'flex'
        annualContent.style.display = 'none';
    });
} else {
     console.error("Missing elements for Pay-Per-Credit tab functionality.");
}
// --- End Pricing Screen Tab Switching ---


// --- Add your Stripe Price IDs (Test Mode) ---
const STRIPE_ANNUAL_PRICE_ID = 'price_1RXcMOJDkW3cIYXuu4xEKrm4'; // Replace with your actual Annual Price ID (price_...)
// New unit-price for credits:
const STRIPE_CREDIT_PRICE_ID = 'price_1RXcdsJDkW3cIYXuKTLAM472'; // ← paste your new Price ID
// --- NEW Board Review Price IDs ---
const STRIPE_BR_MONTHLY_PRICE_ID = 'price_1RXcRSJDkW3cIYXuS6n0pM0t'; // <<< PASTE YOUR ID HERE
const STRIPE_BR_3MONTH_PRICE_ID = 'price_1RXcPbJDkW3cIYXusuhRQzqx';   // <<< PASTE YOUR ID HERE
const STRIPE_BR_ANNUAL_PRICE_ID = 'price_1RXcOnJDkW3cIYXusyl4eKpH';    // <<< PASTE YOUR ID HERE

// ---

    // Checkout Button
// --- Listener for CME ANNUAL Subscription Button (Corrected with Metadata) ---
const cmeCheckoutAnnualBtn = document.getElementById("cmeCheckoutAnnualBtn");

if (cmeCheckoutAnnualBtn) {
  cmeCheckoutAnnualBtn.addEventListener("click", async function () {
    const selectedPriceId = STRIPE_ANNUAL_PRICE_ID;   // CME Annual Price ID
    const planNameForMeta = "CME Annual Subscription"; // Descriptive name for metadata
    const tierForMeta = "cme_annual";                  // Specific tier for metadata

    console.log(
      `Requesting CME checkout for ${planNameForMeta} (Tier: ${tierForMeta}) with Price ID: ${selectedPriceId}`
    );

    if (analytics) {
      logEvent(analytics, 'begin_checkout', {
          currency: 'USD',
          value: 149.00,
          item_id: selectedPriceId,
          item_name: planNameForMeta,
          tier: tierForMeta
      });
      console.log(`GA Event: begin_checkout (item: ${planNameForMeta})`);
  }

    const user = window.authFunctions.getCurrentUser();
    if (!user || user.isAnonymous) {
      alert("Please register or log in fully before purchasing a subscription.");
      console.warn(
        "CME Annual checkout attempted by anonymous or non-logged-in user."
      );
      return;
    }

    if (!window.stripe || !createCheckoutSessionFunction) {
      alert("Error: Payment system not ready. Please refresh.");
      console.error(
        "Stripe object or createCheckoutSessionFunction reference missing for CME Annual."
      );
      return;
    }

    cmeCheckoutAnnualBtn.disabled = true;
    cmeCheckoutAnnualBtn.textContent = "Preparing Checkout…";

    try {
      console.log("Forcing ID token refresh for CME Annual checkout…");
      await getIdToken(user, true);
      console.log("ID token refreshed.");

      console.log(
        "Calling createStripeCheckoutSession for CME Annual. User:",
        user.uid
      );
      const result = await createCheckoutSessionFunction({
        priceId: selectedPriceId,
        planName: planNameForMeta, // <<< ADDED
        tier: tierForMeta,         // <<< ADDED
      });

      const sessionId = result.data.sessionId;
      console.log("Received Session ID for CME Annual:", sessionId);

      if (!sessionId) {
        throw new Error(
          "Cloud function did not return a Session ID for CME Annual."
        );
      }

      cmeCheckoutAnnualBtn.textContent = "Redirecting…";
      const { error } = await window.stripe.redirectToCheckout({ sessionId });

      if (error) {
        console.error("Stripe redirectToCheckout error for CME Annual:", error);
        alert(`Could not redirect to checkout: ${error.message}`);
        cmeCheckoutAnnualBtn.disabled = false;
        cmeCheckoutAnnualBtn.textContent = "Subscribe Annually";
      }
    } catch (error) {
      console.error("Error during CME Annual checkout:", error);
      let message = "Could not prepare CME Annual checkout. Please try again.";
      if (error.code && error.message) {
        message = `Error: ${error.message}`;
      } else if (error.message) {
        message = error.message;
      }
      alert(message);
      cmeCheckoutAnnualBtn.disabled = false;
      cmeCheckoutAnnualBtn.textContent = "Subscribe Annually";
    }
  });
} else {
  console.error(
    "CME Annual Checkout button (#cmeCheckoutAnnualBtn) not found."
  );
}

// --- Listener for CME BUY CREDITS Button (Corrected with Metadata) ---
const cmeBuyCreditsBtn = document.getElementById("cmeBuyCreditsBtn");

if (cmeBuyCreditsBtn) {
  cmeBuyCreditsBtn.addEventListener("click", async function () {
    const quantityInput = document.getElementById("creditQty");
    let quantity = 1;

    if (quantityInput) {
      const parsedValue = Number(quantityInput.value);
      if (
        !isNaN(parsedValue) &&
        parsedValue >= 1 &&
        parsedValue <= 25 &&
        Number.isInteger(parsedValue)
      ) {
        quantity = parsedValue;
      } else {
        alert("Please enter a whole number of credits between 1 and 25.");
        if (quantityInput) quantityInput.value = "1"; // Reset to default
        return;
      }
    }

    const selectedPriceId = STRIPE_CREDIT_PRICE_ID; // CME Credit Price ID
    const planNameForMeta = `CME Credits Purchase (${quantity})`; // Descriptive
    const tierForMeta = "cme_credits"; // Specific tier

    console.log(
      `Requesting CME Credits checkout for ${quantity} credits (Tier: ${tierForMeta}) with Price ID: ${selectedPriceId}`
    );

    if (analytics) {
      logEvent(analytics, 'begin_checkout', {
          currency: 'USD',
          value: quantity * 5.00, // Assuming $5 per credit
          quantity: quantity,
          item_id: selectedPriceId,
          item_name: planNameForMeta,
          tier: tierForMeta
      });
      console.log(`GA Event: begin_checkout (item: ${planNameForMeta})`);
  }

    const user = window.authFunctions.getCurrentUser();
    if (!user || user.isAnonymous) {
      alert("Please register or log in fully before purchasing credits.");
      console.warn(
        "CME Credits purchase attempted by anonymous or non-logged-in user."
      );
      return;
    }

    if (!window.stripe || !createCheckoutSessionFunction) {
      alert("Error: Payment system not ready. Please refresh.");
      console.error(
        "Stripe object or createCheckoutSessionFunction reference missing for CME Credits."
      );
      return;
    }

    cmeBuyCreditsBtn.disabled = true;
    cmeBuyCreditsBtn.textContent = "Preparing Purchase…";

    try {
      console.log("Forcing ID token refresh for CME Credits purchase…");
      await getIdToken(user, true);
      console.log("ID token refreshed.");

      console.log(
        "Calling createStripeCheckoutSession for CME Credits. User:",
        user.uid
      );
      const result = await createCheckoutSessionFunction({
        priceId: selectedPriceId,
        quantity,
        planName: planNameForMeta, // <<< ADDED
        tier: tierForMeta,         // <<< ADDED
      });

      const sessionId = result.data.sessionId;
      console.log("Received Session ID for CME Credits:", sessionId);

      if (!sessionId) {
        throw new Error(
          "Cloud function did not return a Session ID for CME Credits."
        );
      }

      cmeBuyCreditsBtn.textContent = "Redirecting…";
      const { error } = await window.stripe.redirectToCheckout({ sessionId });

      if (error) {
        console.error("Stripe redirectToCheckout error for CME Credits:", error);
        alert(`Could not redirect to checkout: ${error.message}`);
        cmeBuyCreditsBtn.disabled = false;
        cmeBuyCreditsBtn.textContent = "Buy Credits";
      }
    } catch (error) {
      console.error("Error during CME Credits purchase:", error);
      let message = "Could not prepare CME Credits purchase. Please try again.";
      if (error.code && error.message) {
        message = `Error: ${error.message}`;
      } else if (error.message) {
        message = error.message;
      }
      alert(message);
      cmeBuyCreditsBtn.disabled = false;
      cmeBuyCreditsBtn.textContent = "Buy Credits";
    }
  });
} else {
  console.error(
    "CME Buy Credits button (#cmeBuyCreditsBtn) not found."
  );
}


// --- Function to Show the CME Learn More Modal ---
function showCmeLearnMoreModal() {
  console.log("Executing showCmeLearnMoreModal...");

  // Hide the Info Screen first (where the link was clicked)
  const cmeInfoScreen = document.getElementById("cmeInfoScreen");
  if (cmeInfoScreen) {
      cmeInfoScreen.style.display = "none";
  }

  // Show the Learn More Modal
  const cmeLearnMoreModal = document.getElementById("cmeLearnMoreModal");
  if (cmeLearnMoreModal) {
      cmeLearnMoreModal.style.display = "flex"; // Use 'flex' based on base modal CSS
      // Scroll modal body to top when opened
      const modalBody = cmeLearnMoreModal.querySelector('.modal-body');
      if(modalBody) modalBody.scrollTop = 0;
      console.log("Displayed #cmeLearnMoreModal.");
  } else {
      console.error("CME Learn More Modal (#cmeLearnMoreModal) not found!");
  }
}

// --- Event Listeners for CME Learn More Modal Buttons ---

// Close Button (X)
const closeCmeLearnMoreModal = document.getElementById("closeCmeLearnMoreModal");
if (closeCmeLearnMoreModal) {
  closeCmeLearnMoreModal.addEventListener("click", function() {
      console.log("CME Learn More Close button clicked.");
      const cmeLearnMoreModal = document.getElementById("cmeLearnMoreModal");
      const cmeInfoScreen = document.getElementById("cmeInfoScreen");

      if (cmeLearnMoreModal) cmeLearnMoreModal.style.display = "none";
      if (cmeInfoScreen) cmeInfoScreen.style.display = "flex"; // Show info screen again
  });
} else {
  console.error("CME Learn More Close button (#closeCmeLearnMoreModal) not found.");
}

// Continue to Checkout Button
const continueToCheckoutBtn = document.getElementById("continueToCheckoutBtn");
if (continueToCheckoutBtn) {
  continueToCheckoutBtn.addEventListener("click", function() {
      console.log("Continue to Checkout button clicked from Learn More modal.");
      const cmeLearnMoreModal = document.getElementById("cmeLearnMoreModal");

      if (cmeLearnMoreModal) cmeLearnMoreModal.style.display = "none";
      showCmePricingScreen(); // Show the pricing screen
  });
} else {
  console.error("Continue to Checkout button (#continueToCheckoutBtn) not found.");
}

// Return to Main Dashboard Button
const returnToDashboardBtn = document.getElementById("returnToDashboardBtn");
if (returnToDashboardBtn) {
  returnToDashboardBtn.addEventListener("click", function() {
      console.log("Return to Dashboard button clicked from Learn More modal.");
      const cmeLearnMoreModal = document.getElementById("cmeLearnMoreModal");
      const cmeInfoScreen = document.getElementById("cmeInfoScreen"); // Also hide info screen if needed
      const mainOptions = document.getElementById("mainOptions");

      if (cmeLearnMoreModal) cmeLearnMoreModal.style.display = "none";
      if (cmeInfoScreen) cmeInfoScreen.style.display = "none"; // Ensure info screen is hidden too
      if (mainOptions) mainOptions.style.display = "flex"; // Show main dashboard
  });
} else {
  console.error("Return to Dashboard button (#returnToDashboardBtn) not found.");
}

// Optional: Close modal if clicking outside the content
const cmeLearnMoreModal = document.getElementById("cmeLearnMoreModal");
if (cmeLearnMoreModal) {
   cmeLearnMoreModal.addEventListener('click', function(event) {
       // Check if the click is directly on the modal background
       if (event.target === cmeLearnMoreModal) {
           console.log("Clicked outside Learn More modal content.");
           const cmeInfoScreen = document.getElementById("cmeInfoScreen");
           cmeLearnMoreModal.style.display = 'none';
           if (cmeInfoScreen) cmeInfoScreen.style.display = "flex"; // Show info screen again
       }
   });
}

// --- Board Review Pricing Screen Tab Logic ---
const brMonthlyBtn = document.getElementById('brMonthlyBtn');
const br3MonthBtn = document.getElementById('br3MonthBtn');
const brAnnualBtn = document.getElementById('brAnnualBtn');

const brMonthlyContent = document.getElementById('brMonthlyContent');
const br3MonthContent = document.getElementById('br3MonthContent');
const brAnnualContent = document.getElementById('brAnnualContent');

// Helper function to update view
function updateBoardReviewPricingView(selectedPlan) {
    // Content visibility
    if (brMonthlyContent) brMonthlyContent.style.display = (selectedPlan === 'monthly') ? 'block' : 'none';
    if (br3MonthContent) br3MonthContent.style.display = (selectedPlan === '3-month') ? 'block' : 'none';
    if (brAnnualContent) brAnnualContent.style.display = (selectedPlan === 'annual') ? 'block' : 'none';

    // Button active states
    if (brMonthlyBtn) brMonthlyBtn.classList.toggle('active', selectedPlan === 'monthly');
    if (br3MonthBtn) br3MonthBtn.classList.toggle('active', selectedPlan === '3-month');
    if (brAnnualBtn) brAnnualBtn.classList.toggle('active', selectedPlan === 'annual');

    console.log(`Board Review pricing view updated to: ${selectedPlan}`);
}

// Event Listeners for tab buttons
if (brMonthlyBtn) {
    brMonthlyBtn.addEventListener('click', function() {
        updateBoardReviewPricingView('monthly');
    });
}

if (br3MonthBtn) {
    br3MonthBtn.addEventListener('click', function() {
        updateBoardReviewPricingView('3-month');
    });
}

if (brAnnualBtn) {
    brAnnualBtn.addEventListener('click', function() {
        updateBoardReviewPricingView('annual');
    });
}
// --- End Board Review Pricing Screen Tab Logic ---

// --- Event Listener for New Paywall "Explore CME Module" Button ---
const exploreCmeModuleBtn = document.getElementById("exploreCmeModuleBtn");

if (exploreCmeModuleBtn) {
    exploreCmeModuleBtn.addEventListener("click", function() {
        console.log("Paywall 'Explore CME Module' button clicked.");

        const newPaywallScreen = document.getElementById("newPaywallScreen");
        const cmeInfoScreen = document.getElementById("cmeInfoScreen"); // Your existing CME Info Screen

        // Hide the main paywall first
        if (newPaywallScreen) {
            newPaywallScreen.style.display = "none";
        }

        // Check authentication state
        if (window.authState && window.authState.isRegistered) {
            // User is already registered, go directly to CME Info Screen
            console.log("User is registered. Showing CME Info Screen.");
            if (cmeInfoScreen) {
                cmeInfoScreen.style.display = "flex";
            } else {
                console.error("CME Info Screen not found!");
                const mainOptions = document.getElementById("mainOptions");
                if (mainOptions) mainOptions.style.display = "flex"; // Fallback
            }
        } else {
            // User is a guest, show the registration modal, then go to CME Info Screen
            console.log("User is a guest. Showing registration form for CME Module.");
            if (typeof showRegisterForm === 'function') {
                // Pass 'cme_info' as the next step.
                // We need to modify showRegisterForm to handle this new nextStep.
                // Set a flag so we know where to redirect after registration
sessionStorage.setItem('pendingRedirectAfterRegistration', 'cme_info');
showRegisterForm('cme_info');
            } else {
                console.error("showRegisterForm function not found!");
                const mainOptions = document.getElementById("mainOptions");
                if (mainOptions) mainOptions.style.display = "flex"; // Fallback
            }
        }
    });
} else {
    console.error("Button with ID 'exploreCmeModuleBtn' not found.");
}

// --- Event Listener for New Paywall "Unlock Board Review Access" Button ---
const unlockBoardReviewBtn = document.getElementById("unlockBoardReviewBtn");

if (unlockBoardReviewBtn) {
    unlockBoardReviewBtn.addEventListener("click", function() {
        console.log("Paywall 'Unlock Board Review Access' button clicked.");

        const newPaywallScreen = document.getElementById("newPaywallScreen");
        const boardReviewPricingScreen = document.getElementById("boardReviewPricingScreen");

        // Hide the main paywall first
        if (newPaywallScreen) {
            newPaywallScreen.style.display = "none";
        }

        // Check authentication state
        // Assuming window.authState.isRegistered is accurately maintained
        if (window.authState && window.authState.isRegistered) {
            // User is already registered, go directly to Board Review Pricing Screen
            console.log("User is registered. Showing Board Review Pricing Screen.");
            if (boardReviewPricingScreen) {
                boardReviewPricingScreen.style.display = "flex"; // Or "block"
                // Ensure the default view (e.g., annual) is active if not already handled
                if (typeof updateBoardReviewPricingView === 'function') {
                    updateBoardReviewPricingView('annual'); // Or your desired default
                }
            } else {
                console.error("Board Review Pricing Screen not found!");
                // Fallback: show main options if pricing screen is missing
                const mainOptions = document.getElementById("mainOptions");
                if (mainOptions) mainOptions.style.display = "flex";
            }
        } else {
            // User is a guest or not yet registered, show the registration modal
            console.log("User is a guest. Showing registration form for Board Review.");
            // We'll call showRegisterForm, but we need a way to redirect after success.
            // For now, showRegisterForm will handle its own post-registration logic (which currently goes to main dashboard).
            // We will modify showRegisterForm in the NEXT step to handle different post-registration destinations.
            if (typeof showRegisterForm === 'function') {
                // Pass a parameter to indicate the next step after registration
                // Set a flag so we know where to redirect after registration
sessionStorage.setItem('pendingRedirectAfterRegistration', 'board_review_pricing');
showRegisterForm('board_review_pricing');
            } else {
                console.error("showRegisterForm function not found!");
                // Fallback: if registration form function is missing, maybe show main options or an error
                const mainOptions = document.getElementById("mainOptions");
                if (mainOptions) mainOptions.style.display = "flex";
            }
        }
    });
} else {
    console.error("Button with ID 'unlockBoardReviewBtn' not found.");
}

// --- Board Review Pricing Screen - Back Button Logic ---
const boardReviewPricingBackBtn = document.getElementById('boardReviewPricingBackBtn');
if (boardReviewPricingBackBtn) {
    boardReviewPricingBackBtn.addEventListener('click', function() {
        console.log("Board Review Pricing screen 'Back to Plans' button clicked.");
        const boardReviewPricingScreen = document.getElementById('boardReviewPricingScreen');
        const newPaywallScreen = document.getElementById('newPaywallScreen');

        if (boardReviewPricingScreen) {
            boardReviewPricingScreen.style.display = 'none';
        }
        if (newPaywallScreen) {
            newPaywallScreen.style.display = 'flex'; // Show the main paywall
        } else {
            console.error("New Paywall Screen not found when going back from BR Pricing.");
            // Fallback to main options if paywall is missing
            const mainOptions = document.getElementById("mainOptions");
            if (mainOptions) mainOptions.style.display = 'flex';
        }
    });
} else {
    console.error("Board Review Pricing Back Button not found.");
}
// --- End Board Review Pricing Screen - Back Button Logic ---

// --- Event Listeners for Board Review Pricing Screen Checkout Buttons ---

// Helper function for Board Review Checkout
async function handleBoardReviewCheckout(priceId, planName, tierName) { // Added tierName
  if (analytics) {
    let price = 0;
    if (priceId === STRIPE_BR_MONTHLY_PRICE_ID) price = 14.99;
    if (priceId === STRIPE_BR_3MONTH_PRICE_ID) price = 39.99; // Example price
    if (priceId === STRIPE_BR_ANNUAL_PRICE_ID) price = 99.99; // Example price

    logEvent(analytics, 'begin_checkout', {
        currency: 'USD',
        value: price,
        item_id: priceId,
        item_name: planName,
        tier: tierName
    });
    console.log(`GA Event: begin_checkout (item: ${planName})`);
}
  console.log(`Requesting Board Review checkout for ${planName} (Tier: ${tierName}) with Price ID: ${priceId}`);

  const user = window.authFunctions.getCurrentUser();
  if (!user || user.isAnonymous) {
      alert("Please ensure you are fully registered and logged in before subscribing.");
      // Optionally, redirect to login/registration or show the main paywall
      // e.g., showLoginForm();
      // or document.getElementById('newPaywallScreen').style.display = 'flex';
      return;
  }
  // Ensure createCheckoutSessionFunction is available (it's imported in app.js from firebase-config.js)
  if (!window.stripe || !createCheckoutSessionFunction) {
      alert('Error: Payment system not ready. Please refresh.');
      console.error('Stripe object or createCheckoutSessionFunction reference missing.');
      return;
  }

  // Get all Board Review checkout buttons to manage their state
  const brCheckoutButtons = [
      document.getElementById("checkoutBrMonthlyBtn"),
      document.getElementById("checkoutBr3MonthBtn"),
      document.getElementById("checkoutBrAnnualBtn")
  ];

  // Disable all BR checkout buttons and show loading text on the clicked one
  let clickedButton = null;
  brCheckoutButtons.forEach(btn => {
      if(btn) {
          btn.disabled = true;
          // Identify which button was clicked to set its text specifically
          if ( (planName === 'Board Review Monthly' && btn.id === "checkoutBrMonthlyBtn") ||
               (planName === 'Board Review 3-Month' && btn.id === "checkoutBr3MonthBtn") ||
               (planName === 'Board Review Annual' && btn.id === "checkoutBrAnnualBtn") ) {
              btn.textContent = 'Preparing...';
              clickedButton = btn;
          } else {
              btn.style.opacity = 0.7; // Dim other buttons
          }
      }
  });

  try {
      console.log("Forcing ID token refresh for Board Review checkout...");
      await getIdToken(user, true); // Ensure fresh token (getIdToken is from firebase-config.js)
      console.log("ID token refreshed.");

      console.log("Calling createStripeCheckoutSession function for user:", user.uid, "Price ID:", priceId, "Plan:", planName, "Tier:", tierName);
      const result = await createCheckoutSessionFunction({
          priceId: priceId,
          planName: planName, // Pass planName for metadata
          tier: tierName      // Pass tier for metadata
      });
      const sessionId = result.data.sessionId;
      console.log("Received Session ID for Board Review:", sessionId);

      if (!sessionId) { throw new Error("Cloud function did not return a Session ID for Board Review."); }

      if (clickedButton) clickedButton.textContent = 'Redirecting...';
      const { error } = await window.stripe.redirectToCheckout({ sessionId: sessionId });

      if (error) {
          console.error("Stripe redirectToCheckout error for Board Review:", error);
          alert(`Could not redirect to checkout: ${error.message}`);
      }
  } catch (error) {
      console.error(`Error during Board Review checkout for ${planName}:`, error);
      let message = `Could not prepare checkout for ${planName}. Please try again.`;
      if (error.code && error.message) { message = `Error: ${error.message}`; }
      else if (error.message) { message = error.message; }
      alert(message);
  } finally {
      // Re-enable buttons and restore original text
      const originalTexts = ['Subscribe Monthly', 'Subscribe 3-Month', 'Subscribe Annually'];
      brCheckoutButtons.forEach((btn, index) => {
          if(btn) {
              btn.disabled = false;
              btn.textContent = originalTexts[index];
              btn.style.opacity = 1; // Restore opacity
          }
      });
  }
}

// Monthly Board Review Checkout
const checkoutBrMonthlyBtn = document.getElementById("checkoutBrMonthlyBtn");
if (checkoutBrMonthlyBtn) {
  checkoutBrMonthlyBtn.addEventListener("click", function() {
      handleBoardReviewCheckout(STRIPE_BR_MONTHLY_PRICE_ID, 'Board Review Monthly', 'board_review');
  });
} else {
  console.error("Board Review Monthly Checkout button (#checkoutBrMonthlyBtn) not found.");
}

// 3-Month Board Review Checkout
const checkoutBr3MonthBtn = document.getElementById("checkoutBr3MonthBtn");
if (checkoutBr3MonthBtn) {
  checkoutBr3MonthBtn.addEventListener("click", function() {
      handleBoardReviewCheckout(STRIPE_BR_3MONTH_PRICE_ID, 'Board Review 3-Month', 'board_review');
  });
} else {
  console.error("Board Review 3-Month Checkout button (#checkoutBr3MonthBtn) not found.");
}

// Annual Board Review Checkout
const checkoutBrAnnualBtn = document.getElementById("checkoutBrAnnualBtn");
if (checkoutBrAnnualBtn) {
  checkoutBrAnnualBtn.addEventListener("click", function() {
      handleBoardReviewCheckout(STRIPE_BR_ANNUAL_PRICE_ID, 'Board Review Annual', 'board_review');
  });
} else {
  console.error("Board Review Annual Checkout button (#checkoutBrAnnualBtn) not found.");
}
// --- End Board Review Checkout Button Listeners ---

// In app.js or a utils.js
async function getActiveCmeYearIdFromFirestore() {
  if (!db) {
      console.error("Firestore (db) not initialized for getActiveCmeYearIdFromFirestore");
      return null;
  }
  const now = new Date(); // Use client-side Date
  const cmeWindowsRef = collection(db, "cmeWindows");

  try {
      const snapshot = await getDocs(cmeWindowsRef);
      if (snapshot.empty) {
          console.warn("Client: No CME windows defined in 'cmeWindows' collection.");
          return null;
      }

      for (const docSnap of snapshot.docs) {
          const windowData = docSnap.data();
          if (windowData.startDate && windowData.endDate) {
              // Ensure startDate and endDate are Date objects for comparison
              const startDate = windowData.startDate.toDate ? windowData.startDate.toDate() : new Date(windowData.startDate);
              const endDate = windowData.endDate.toDate ? windowData.endDate.toDate() : new Date(windowData.endDate);

              if (now >= startDate && now <= endDate) {
                  console.log(`Client: Active CME window found: ${docSnap.id}`);
                  return docSnap.id;
              }
          } else {
              console.warn(`Client: CME window ${docSnap.id} is missing startDate or endDate.`);
          }
      }
      console.log("Client: No currently active CME window found for today's date.");
      return null;
  } catch (error) {
      console.error("Client: Error fetching active CME year ID:", error);
      return null; 
  }
}

// --- Event Listener for Accreditation Button on CME Info Screen ---
const viewAccreditationInfoBtn = document.getElementById("viewAccreditationInfoBtn");
if (viewAccreditationInfoBtn) {
    viewAccreditationInfoBtn.addEventListener("click", function() {
        const accreditationModal = document.getElementById("cmeAccreditationModal");
        if (accreditationModal) {
            console.log("View Accreditation button on Info Screen clicked.");
            accreditationModal.style.display = "flex"; // Show the modal
        } else {
            console.error("CME Accreditation modal not found.");
        }
    });
} else {
    console.error("View Accreditation button on Info Screen (#viewAccreditationInfoBtn) not found.");
}
// app.js - TOP OF FILE
import { shuffleArray, getCurrentQuestionId } from './utils.js';
import { auth, db, doc, getDoc, analytics, logEvent, setUserProperties, collection, getDocs, query, where } from './firebase-config.js'; // Adjust path if needed
import {
  fetchPersistentAnsweredIds, // <<<--- ADD THIS IMPORT
  recordAnswer,               // Needed for regular quizzes
  recordCmeAnswer,            // Needed for CME quizzes
  updateQuestionStats,        // Needed for regular quizzes
  getBookmarks,               // Needed for bookmark filtering
  updateSpacedRepetitionData,
  recordChoiceSelection
} from './user.v2.js';
import { showLeaderboard } from './ui.js'; 

// Quiz management variables
let allQuestions = [];
let selectedCategory = "";
let answeredIds = [];
let currentQuestion = 0;
let totalQuestions = 0;
let score = 0;
let currentFeedbackQuestionId = "";
let currentFeedbackQuestionText = "";
let sessionStartXP = 0;
let questionStartTime = 0;
let currentQuizType = 'regular';

/**
 * Applies a robust, mobile-first scroll lock to the page.
 * This version uses position:fixed to be more effective on iOS.
 */
function lockBodyScroll() {
  console.log("Applying robust scroll lock with position:fixed.");
  const body = document.body;
  
  // Prevent the lock from being applied multiple times
  if (body.classList.contains('scroll-lock')) {
    return;
  }
  
  // 1. Store the current scroll position so we can restore it later
  const scrollY = window.scrollY || window.pageYOffset;
  body.dataset.scrollY = scrollY; // Store it on the body element itself
  
  // 2. Add the state-tracking class
  body.classList.add('scroll-lock');
  
  // 3. Apply the locking styles
  document.documentElement.style.overflow = 'hidden'; // Lock the html element
  body.style.overflow = 'hidden';
  body.style.position = 'fixed'; // The key for iOS stability
  body.style.top = `-${scrollY}px`; // Pin the body at the correct visual position
  body.style.width = '100%';
}

/**
 * Fully restores scrolling to the page after a robust lock.
 */
function unlockBodyScroll() {
  console.log("Unlocking body scroll.");
  const body = document.body;
  
  // Only run the unlock logic if a lock is active
  if (!body.classList.contains('scroll-lock')) {
    return;
  }
  
  // 1. Get the stored scroll position
  const scrollY = parseInt(body.dataset.scrollY || '0');
  
  // 2. Remove all the locking styles
  body.classList.remove('scroll-lock');
  document.documentElement.style.overflow = '';
  body.style.overflow = '';
  body.style.position = '';
  body.style.top = '';
  body.style.width = '';
  
  // 3. Clean up the stored data
  delete body.dataset.scrollY;
  
  // 4. Restore the scroll position immediately
  window.scrollTo(0, scrollY);
}

window.unlockBodyScroll = unlockBodyScroll;

// Replace the OLD fetchQuestionBank function with this NEW one:
async function fetchQuestionBank() {
  console.log("Fetching question bank from Firestore...");
  try {
    // Get a reference to the 'questions' collection in Firestore
    const questionsCollectionRef = collection(db, 'questions');

    // Fetch all documents from the collection
    const querySnapshot = await getDocs(questionsCollectionRef);

    // Map the Firestore documents to an array of question objects
    // This ensures the data structure matches what the rest of the app expects
    const questionsArray = querySnapshot.docs.map(doc => {
      // doc.data() returns the fields of the document
      return doc.data();
    });

    console.log(`Successfully fetched ${questionsArray.length} questions from Firestore.`);
    return questionsArray; // Return the array of question objects

  } catch (error) {
    console.error("Error fetching question bank from Firestore:", error);
    // Rethrow the error or return an empty array so calling functions know there was a problem
    throw error; // Or return [];
  }
}

// MODIFIED loadQuestions function
async function loadQuestions(options = {}) {
  console.log("Loading questions with options:", options);
  window.isOnboardingQuiz = options.isOnboarding || false;

  // Track quiz start
  if (analytics && logEvent) {
    const accessTier = window.authState?.accessTier || 'free_guest';
    const isGuest = !auth.currentUser || auth.currentUser.isAnonymous;
    
    logEvent(analytics, 'quiz_start', {
      quiz_type: options.quizType || 'regular',
      category: options.category || 'all_categories',
      procedure: options.procedure || null, // Add procedure for tracking
      num_questions: options.num || 10,
      user_tier: accessTier,
      is_guest: isGuest,
      board_review_only: options.boardReviewOnly || false,
      spaced_repetition: options.spacedRepetition || false
    });
  }

  try {
    const allQuestionsData = await fetchQuestionBank();
    console.log("Total questions fetched from bank:", allQuestionsData.length);

    let filteredQuestions = []; // Initialize as empty
    const accessTier = window.authState?.accessTier || 'free_guest';

    // ==================================================
    // == START: NEW CASE PREP LOGIC
    // ==================================================
    if (options.quizType === 'case_prep' && options.procedure) {
      console.log(`Case Prep mode activated for procedure: '${options.procedure}'`);

      // --- START: Get User's Specialty ---
      let userSpecialty = null;
      if (auth.currentUser && !auth.currentUser.isAnonymous) {
        try {
          const userDocRef = doc(db, 'users', auth.currentUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists() && userDocSnap.data().specialty) {
            userSpecialty = userDocSnap.data().specialty;
          }
        } catch (error) {
          console.error("Error fetching user specialty for Case Prep:", error);
        }
      }
      // --- END: Get User's Specialty ---

      const premiumProcedures = [
        "Neck Dissection", "Endoscopic Sinus Surgery", "Septoplasty", "Rhinoplasty", "Tonsillectomy", "Congenital Neck Masses", "Mastoidectomy", "Stapedectomy",
        "Submandibular Gland Excision", "Tracheostomy", "Mandible Fracture", "Midface Trauma", "Microlaryngoscopy"
      ];

      const isPremiumProcedure = premiumProcedures.includes(options.procedure);
      const hasPremiumAccess = accessTier === 'board_review' || accessTier === 'cme_annual' || accessTier === 'cme_credits_only';

      if (isPremiumProcedure && !hasPremiumAccess) {
        alert("You need a subscription to access this procedure. Please upgrade your plan.");
        document.getElementById("mainOptions").style.display = "flex";
        return;
      }

      // Filter questions by the selected procedure
      let procedureQuestions = allQuestionsData.filter(q =>
        q.Procedures && q.Procedures.trim().toLowerCase() === options.procedure.trim().toLowerCase()
      );
      console.log(`Found ${procedureQuestions.length} questions for '${options.procedure}'.`);

      // --- START: Filter by Specialty ---
      if (userSpecialty) {
        procedureQuestions = procedureQuestions.filter(q => {
          const questionSpecialty = q.Specialty ? String(q.Specialty).trim() : null;
          // A question without a specialty is considered available to all
          if (!questionSpecialty) return true; 
          // Otherwise, it must match the user's specialty
          return questionSpecialty.toLowerCase() === userSpecialty.toLowerCase();
        });
        console.log(`Found ${procedureQuestions.length} questions after filtering for '${userSpecialty}' specialty.`);
      }
      // --- END: Filter by Specialty ---

      // Handle "Coming Soon" message AFTER all filtering
      if (procedureQuestions.length === 0 && isPremiumProcedure && hasPremiumAccess) {
        alert("Coming soon. This procedure is not yet available for your specialty.");
        document.getElementById("mainOptions").style.display = "flex";
        return;
      }
      
      if (!options.includeAnswered) {
        const answeredIds = await fetchPersistentAnsweredIds();
        if (answeredIds.length > 0) {
          procedureQuestions = procedureQuestions.filter(q =>
            !answeredIds.includes(q["Question"]?.trim())
          );
          console.log(`Questions after 'Include Answered=false' filter for Case Prep:`, procedureQuestions.length);
        }
      }
      
      filteredQuestions = procedureQuestions;

    } else {
      // ==================================================
      // == START: EXISTING QUIZ LOGIC (REGULAR, CME, ETC.)
      // ==================================================
      filteredQuestions = allQuestionsData; // Start with all questions

      let userSpecialty = null;
      if (auth.currentUser) {
        try {
          const userDocRef = doc(db, 'users', auth.currentUser.uid);
          const userDocSnap = await getDoc(userDocRef);
          if (userDocSnap.exists() && userDocSnap.data().specialty) {
            userSpecialty = userDocSnap.data().specialty;
          }
        } catch (error) {
          console.error("Error fetching user specialty:", error);
        }
      }

      let relevantAnsweredIdsForCurrentYear = [];

      if (options.quizType === 'cme' && options.reviewIncorrectCmeOnly === true && options.incorrectCmeQuestionIds) {
        filteredQuestions = filteredQuestions.filter(q =>
          options.incorrectCmeQuestionIds.includes(q["Question"]?.trim())
        );
      } else {
        if (options.quizType === 'cme' && !options.includeAnswered) {
          let currentCmeYear = window.clientActiveCmeYearId;
          if (!currentCmeYear) {
            if (typeof window.getActiveCmeYearIdFromFirestore === 'function') {
              currentCmeYear = await window.getActiveCmeYearIdFromFirestore();
              if (currentCmeYear && typeof window.setActiveCmeYearClientSide === 'function') {
                window.setActiveCmeYearClientSide(currentCmeYear);
              }
            }
          }
          if (currentCmeYear && auth.currentUser && !auth.currentUser.isAnonymous) {
            const uid = auth.currentUser.uid;
            const cmeAnswersForYearRef = collection(db, 'users', uid, 'cmeAnswers');
            const q = query(cmeAnswersForYearRef, where('__name__', ">=", `${currentCmeYear}_`), where('__name__', "<", `${currentCmeYear}_\uffff`));
            const querySnapshot = await getDocs(q);
            querySnapshot.forEach((docSnap) => {
              if (docSnap.data().originalQuestionId) {
                relevantAnsweredIdsForCurrentYear.push(docSnap.data().originalQuestionId.trim());
              }
            });
          }
        } else if (!options.bookmarksOnly && !options.includeAnswered) {
          relevantAnsweredIdsForCurrentYear = await fetchPersistentAnsweredIds();
        }

        if (accessTier === "free_guest") {
          filteredQuestions = filteredQuestions.filter(q => q.Free === true);
        }

        const currentSpecialtyForFilter = options.isOnboarding ? window.selectedSpecialty : userSpecialty;
        if (currentSpecialtyForFilter) {
          filteredQuestions = filteredQuestions.filter(q => {
            const questionSpecialty = q.Specialty ? String(q.Specialty).trim() : null;
            if (!questionSpecialty) return true;
            return questionSpecialty.toLowerCase() === currentSpecialtyForFilter.toLowerCase();
          });
        }

        if ((accessTier === "board_review" || accessTier === "cme_annual" || accessTier === "cme_credits_only") && options.boardReviewOnly === true) {
          filteredQuestions = filteredQuestions.filter(q => q["Board Review"] === true);
        }

        if (options.quizType === 'cme') {
          filteredQuestions = filteredQuestions.filter(q => {
            const cmeEligibleValue = q["CME Eligible"];
            return (typeof cmeEligibleValue === 'boolean' && cmeEligibleValue === true) ||
                   (typeof cmeEligibleValue === 'string' && String(cmeEligibleValue).trim().toLowerCase() === 'yes');
          });
        }

        if (options.bookmarksOnly) {
          const bookmarks = await getBookmarks();
          if (bookmarks.length === 0) {
            alert("You don't have any bookmarks yet. Star questions you want to review later!");
            document.getElementById("mainOptions").style.display = "flex";
            return;
          }
          filteredQuestions = filteredQuestions.filter(q => bookmarks.includes(q["Question"]?.trim()));
        } else if (options.category && options.category !== "") {
          filteredQuestions = filteredQuestions.filter(q =>
            q["Category"] && q["Category"].trim() === options.category
          );
        }

        if (!options.bookmarksOnly && !options.includeAnswered) {
          if (relevantAnsweredIdsForCurrentYear.length > 0) {
            filteredQuestions = filteredQuestions.filter(q =>
              !relevantAnsweredIdsForCurrentYear.includes(q["Question"]?.trim())
            );
          }
        }
      }
      // ==================================================
      // == END: EXISTING QUIZ LOGIC
      // ==================================================
    }

    // --- Common logic for ALL quiz types ---
    if (filteredQuestions.length === 0) {
      let message = "No questions found matching your criteria.";
      if (options.quizType === 'case_prep') {
        message = `No unanswered questions found for '${options.procedure}'. Try including answered questions.`;
      } else if (options.reviewIncorrectCmeOnly) {
        message = "No incorrect CME questions found to review for the current year. Great job!";
      } else if (accessTier === "free_guest") {
        message = "You've completed all available free questions! Upgrade your account to access hundreds more questions and unlock premium features.";
      } else if (options.boardReviewOnly === true) {
        message = "No Board Review questions found matching your criteria.";
      } else if (options.quizType === 'cme') {
        message = "No CME questions found matching your criteria for the current year.";
      } else if (options.bookmarksOnly) {
        message = "No bookmarked questions found matching your criteria.";
      } else if (options.category && options.category !== "") {
        message = `No unanswered questions left in the '${options.category}' category.`;
      }
      alert(message);

      if (options.quizType === 'cme' || options.reviewIncorrectCmeOnly) {
        const cmeDash = document.getElementById("cmeDashboardView");
        if(cmeDash && typeof showCmeDashboard === 'function') showCmeDashboard();
        else if(cmeDash) cmeDash.style.display = "block";
      } else {
        const mainOpts = document.getElementById("mainOptions");
        if(mainOpts) mainOpts.style.display = "flex";
      }
      return;
    }

    let selectedQuestions = shuffleArray(filteredQuestions);
    const numQuestionsToLoad = options.reviewIncorrectCmeOnly ? selectedQuestions.length : (options.num || 10);

    if (selectedQuestions.length > numQuestionsToLoad) {
      selectedQuestions = selectedQuestions.slice(0, numQuestionsToLoad);
    }
    console.log("Final selected questions count:", selectedQuestions.length);

    initializeQuiz(selectedQuestions, options.quizType || 'regular');

  } catch (error) {
    console.error("Error loading questions:", error);
    
    // Check if user is free tier and give them a better message
    const accessTier = window.authState?.accessTier || 'free_guest';
    let errorMessage = "Error loading questions. Please check your connection and try again.";
    
    if (accessTier === 'free_guest') {
      errorMessage = "You've completed all available free questions! Upgrade your account to access hundreds more questions and unlock premium features.";
    }
    
    alert(errorMessage);
    const mainOpts = document.getElementById("mainOptions");
    if(mainOpts) mainOpts.style.display = "flex";
  }
}
// --- End of MODIFIED loadQuestions function ---


// --- Step 6b: Add helper function to fetch CME answered IDs ---
// Place this function definition somewhere in quiz.js or user.js
// If placing in user.js, ensure quiz.js can call it (e.g., make it global: window.fetchCmeAnsweredIds = ...)

async function fetchCmeAnsweredIds() {
    // Return empty array if user not logged in or is guest
    if (!auth || !auth.currentUser || auth.currentUser.isAnonymous) {
        console.log("User not authenticated or is guest, cannot fetch CME answered IDs.");
        return [];
    }

    try {
        const uid = auth.currentUser.uid;
        const userDocRef = doc(db, 'users', uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            // Look for the specific map for CME answered questions
            const cmeAnswered = data.cmeAnsweredQuestions || {};
            return Object.keys(cmeAnswered); // Return an array of the question IDs
        } else {
             console.log("User document not found, returning empty CME answered IDs.");
             return []; // No document, no answered questions
        }
    } catch (error) {
        console.error("Error fetching CME answered IDs:", error);
        return []; // Return empty on error
    }
}

// Add this function to quiz.js
async function loadQuestionsWithSpacedRepetition(options, allQuestions, answeredIds) {
  try {
    // Check if the user is anonymous/guest
    if (auth && auth.currentUser && auth.currentUser.isAnonymous) {
      console.log("Guest user attempted to use spaced repetition");
      
      // Disable spaced repetition for guest users
      options.spacedRepetition = false;
      
      // Show registration benefits modal
      if (typeof window.showRegistrationBenefitsModal === 'function') {
        window.showRegistrationBenefitsModal();
      } else {
        alert("Spaced repetition is available for registered users only. Please create a free account to access this feature.");
      }
      
      // Fall back to regular mode
      loadQuestions(options);
      return;
    }
    // Get user's spaced repetition data
    const spacedRepetitionData = await fetchSpacedRepetitionData();
    if (!spacedRepetitionData) {
      console.log("No spaced repetition data available, falling back to regular mode");
      // Fall back to regular mode if no spaced repetition data
      options.spacedRepetition = false;
      loadQuestions(options);
      return;
    }
    
    const now = new Date();
    
    // Get questions due for review
    const dueQuestionIds = Object.keys(spacedRepetitionData).filter(qId => {
  const data = spacedRepetitionData[qId];
  const nextReviewDate = new Date(data.nextReviewDate);
  console.log("Question ID:", qId);
  console.log("Next review date:", nextReviewDate);
  console.log("Current date:", now);
  console.log("Is due?", nextReviewDate <= now);
  return nextReviewDate <= now;
});
    
    console.log(`Found ${dueQuestionIds.length} questions due for review`);
    
    // Get unanswered questions (excluding those already due for review)
    const unansweredQuestions = allQuestions.filter(q => {
      const qId = q["Question"].trim();
      return !answeredIds.includes(qId) && !dueQuestionIds.includes(qId);
    });
    
    // Get due review questions
    const dueReviewQuestions = allQuestions.filter(q => {
      const qId = q["Question"].trim();
      return dueQuestionIds.includes(qId);
    });
    
    console.log(`Found ${unansweredQuestions.length} unanswered questions`);
    console.log(`Found ${dueReviewQuestions.length} due review questions`);
    
    // Apply category filter if needed
    let filteredUnanswered = unansweredQuestions;
    let filteredDueReview = dueReviewQuestions;
    
    if (options.type === 'custom' && options.category) {
      filteredUnanswered = filteredUnanswered.filter(q => q["Category"] && q["Category"].trim() === options.category);
      filteredDueReview = filteredDueReview.filter(q => q["Category"] && q["Category"].trim() === options.category);
    }
    
    // Shuffle both arrays
    let shuffledUnanswered = shuffleArray(filteredUnanswered);
    let shuffledDueReview = shuffleArray(filteredDueReview);
    
    // Calculate how many to take from each group
    const totalQuestionsNeeded = options.num || 10;
    const dueReviewCount = Math.min(shuffledDueReview.length, totalQuestionsNeeded);
    const unansweredCount = Math.min(shuffledUnanswered.length, totalQuestionsNeeded - dueReviewCount);
    
    // Take the needed questions
    const selectedDueReview = shuffledDueReview.slice(0, dueReviewCount);
    const selectedUnanswered = shuffledUnanswered.slice(0, unansweredCount);
    
    // Combine and shuffle again
    const combinedQuestions = shuffleArray([...selectedDueReview, ...selectedUnanswered]);
    
    console.log(`Selected ${combinedQuestions.length} total questions for spaced repetition quiz`);
    
    if (combinedQuestions.length === 0) {
      alert("No questions available for review or learning at this time. Try disabling spaced repetition or check back later.");
      document.getElementById("mainOptions").style.display = "flex";
      return;
    }
    
    // Initialize the quiz with the selected questions
    initializeQuiz(combinedQuestions);
    
  } catch (error) {
    console.error("Error in spaced repetition mode:", error);
    alert("There was an error loading questions. Please try again.");
    document.getElementById("mainOptions").style.display = "flex";
  }
}

// Initialize the quiz with the selected questions
async function initializeQuiz(questions, quizType = 'regular') {
  console.log(`Initializing quiz. Type: ${quizType}, Questions: ${questions.length}`); // Log quiz type
  currentQuizType = quizType; 
  questionStartTime = Date.now();
  
  if (window.mySwiper) {
      window.mySwiper.destroy(true, true);
  }
  // Get starting XP before the quiz begins
  try {
    const isOnboardingQuiz = window.isOnboardingQuiz || false;
    console.log("Initializing quiz, isOnboarding:", isOnboardingQuiz);
    if (auth && auth.currentUser) {
      const uid = auth.currentUser.uid;
      const userDocRef = doc(db, 'users', uid);
      const userDocSnap = await getDoc(userDocRef);
      
      if (userDocSnap.exists()) {
        const data = userDocSnap.data();
        sessionStartXP = data.stats?.xp || 0;
        console.log("Quiz starting XP:", sessionStartXP);
      }
    }
  } catch (error) {
    console.error("Error getting starting XP:", error);
    sessionStartXP = 0;
  }
  
  currentQuestion = 0;
  score = 0;
  totalQuestions = questions.length;
  answeredIds = [];
  updateProgress();
  
  // Get bookmarks to show the filled star for bookmarked questions
  const bookmarks = await getBookmarks();
  
  const quizSlides = document.getElementById("quizSlides");
  quizSlides.innerHTML = "";
  questions.forEach(question => {
    const questionSlide = document.createElement("div");
    questionSlide.className = "swiper-slide";
    const qId = question["Question"].trim();
    questionSlide.dataset.id = qId;
    questionSlide.dataset.correct = question["Correct Answer"].trim();
    questionSlide.dataset.explanation = question["Explanation"];
    questionSlide.dataset.category = question["Category"] || "Uncategorized";
    questionSlide.dataset.bookmarked = bookmarks.includes(qId) ? "true" : "false";
    const cmeEligibleValue = question["CME Eligible"];
  const isCME = typeof cmeEligibleValue === 'boolean' ? cmeEligibleValue : (cmeEligibleValue && String(cmeEligibleValue).trim().toLowerCase() === 'yes');
  
  questionSlide.dataset.cmeEligible = isCME ? "true" : "false";

    questionSlide.innerHTML = `
      <div class="card">
        ${isCME ? '<div class="cme-tag">CME Eligible</div>' : ''}
        <div class="question">${question["Question"]}</div>
        ${question["Image URL"] && question["Image URL"].trim() !== ""
          ? `<img src="${question["Image URL"].trim()}" class="question-image">`
          : "" }
        <div class="options">
  ${question["Option A"] && question["Option A"].trim() !== ""
    ? `<button class="option-btn" data-option="A"><span class="option-text">A. ${question["Option A"]}</span></button>`
    : "" }
  ${question["Option B"] && question["Option B"].trim() !== ""
    ? `<button class="option-btn" data-option="B"><span class="option-text">B. ${question["Option B"]}</span></button>`
    : "" }
  ${question["Option C"] && question["Option C"].trim() !== ""
    ? `<button class="option-btn" data-option="C"><span class="option-text">C. ${question["Option C"]}</span></button>`
    : "" }
  ${question["Option D"] && question["Option D"].trim() !== ""
    ? `<button class="option-btn" data-option="D"><span class="option-text">D. ${question["Option D"]}</span></button>`
    : "" }
  ${question["Option E"] && question["Option E"] !== ""
    ? `<button class="option-btn" data-option="E"><span class="option-text">E. ${question["Option E"]}</span></button>`
    : "" }
</div>
        <div class="swipe-hint">Select an answer to continue</div>
      </div>
    `;
    quizSlides.appendChild(questionSlide);
    const answerSlide = document.createElement("div");
    answerSlide.className = "swiper-slide";
    answerSlide.innerHTML = `
      <div class="card">
        <div class="answer"></div>
        <p class="swipe-next-hint">Swipe up for next question</p>
      </div>
    `;
    quizSlides.appendChild(answerSlide);
  });

  // --- NEW SCROLL LOGIC ---
  // We will now only ATTEMPT to scroll to the top.
  // The scroll lock will be applied later, when the user answers the first question.
  // This gives the user a chance to manually scroll if the automatic scroll fails on mobile.
  console.log("Attempting to scroll to top. Scroll will remain UNLOCKED for the first question.");
  window.scrollTo({ top: 0, behavior: 'instant' });

  window.mySwiper = new Swiper('.swiper', {
    direction: 'vertical',
    loop: false,
    mousewheel: true,
    touchReleaseOnEdges: true,
    allowSlideNext: false,  // Start locked
    allowSlidePrev: true,   // Allow going back
    
    on: {
      init: function () {
        console.log("Swiper 'init' event fired. Page is ready.");
      }
    }
  });

  // --- START OF MOVED CODE ---
  // This code now runs *after* mySwiper is created.
  window.mySwiper.on('slideChangeTransitionEnd', function() {
    const activeIndex = window.mySwiper.activeIndex;
    
    if (activeIndex % 2 === 0) {
      questionStartTime = Date.now();
      console.log("New question slide. questionStartTime updated to:", questionStartTime);
      updateBookmarkIcon();
    }
    
    // Update swipe permissions for the new slide
    updateSwipePermissions();
  });

  addOptionListeners();

  // Set initial permissions after a small delay to ensure Swiper is fully initialized
  setTimeout(() => {
    updateSwipePermissions();
  }, 100);
  
  // Set the initial bookmark icon state for the first question
  updateBookmarkIcon();

  document.querySelector(".swiper").style.display = "block";
  document.getElementById("bottomToolbar").style.display = "flex";
  document.getElementById("mainOptions").style.display = "none";
  document.getElementById("performanceView").style.display = "none";
  document.getElementById("iconBar").style.display = "flex";
  document.getElementById("aboutView").style.display = "none";
  document.getElementById("faqView").style.display = "none";
  // --- END OF MOVED CODE ---
}

// Function to lock/unlock swiping
function updateSwipePermissions() {
    // Safety check - make sure mySwiper exists and has slides
    if (!window.mySwiper || !window.mySwiper.slides || window.mySwiper.slides.length === 0) {
      console.log("Swiper not ready yet, skipping permission update");
      return;
    }
    
    const activeIndex = window.mySwiper.activeIndex || 0;
    
    // If we're on a question slide (even index)
    if (activeIndex % 2 === 0) {
      const currentSlide = window.mySwiper.slides[activeIndex];
      if (!currentSlide) {
        console.log("Current slide not found");
        return;
      }
      
      const card = currentSlide.querySelector('.card');
      
      // Check if question has been answered
      if (card && card.classList.contains('answered')) {
        window.mySwiper.allowSlideNext = true;  // Allow swiping to answer
        console.log("Unlocked swiping - question answered");
      } else {
        window.mySwiper.allowSlideNext = false; // Lock swiping until answered
        console.log("Locked swiping - question not answered");
      }
    } else {
      // On answer slides (odd index), always allow swiping
      window.mySwiper.allowSlideNext = true;
      console.log("Unlocked swiping - on answer slide");
    }
}

// Update the bookmark icon based on the current question's bookmark status
function updateBookmarkIcon() {
  const favoriteButton = document.getElementById("favoriteButton");
  if (!favoriteButton) return;
  
  const questionId = getCurrentQuestionId();
  if (!questionId) {
    favoriteButton.innerText = "☆";
    favoriteButton.style.color = "";
    return;
  }
  
  const currentSlide = document.querySelector(`.swiper-slide[data-id="${questionId}"]`);
  if (currentSlide && currentSlide.dataset.bookmarked === "true") {
    favoriteButton.innerText = "★";
    favoriteButton.style.color = "#007BFF"; // Blue color for bookmarked items
  } else {
    favoriteButton.innerText = "☆";
    favoriteButton.style.color = "";
  }
}

// Add click event listeners to quiz options
// quiz.js

function addOptionListeners() {
  document.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', async function() {
        // If the scroll is not yet locked, lock it now.
          // This happens on the first answer click of the quiz.
          if (!document.body.classList.contains('scroll-lock')) {
            lockBodyScroll();
          }
          const card = this.closest('.card');
    if (card.classList.contains('answered')) return;
    card.classList.add('answered');
    
    if (window.mySwiper) {
      window.mySwiper.allowSlideNext = true;
      console.log("Unlocked swiping after answer selection");
    }
    const questionSlide = card.closest('.swiper-slide');
    const qId = questionSlide.dataset.id;
    if (!answeredIds.includes(qId)) { answeredIds.push(qId); }
    const correct = questionSlide.dataset.correct;
    const explanation = questionSlide.dataset.explanation;
    const category = questionSlide.dataset.category;
    const options = card.querySelectorAll('.option-btn');
    const selected = this.getAttribute('data-option');
    const isCorrect = (selected === correct);
    const timeSpent = Date.now() - questionStartTime;
    
    // Record which specific choice was selected for statistics
    await recordChoiceSelection(qId, selected);

    if (analytics && logEvent) {
      logEvent(analytics, 'question_answered', {
        question_category: category,
        is_correct: isCorrect,
        time_to_answer_seconds: Math.round(timeSpent / 1000),
        is_cme_eligible: questionSlide.dataset.cmeEligible === "true",
        is_bookmarked: questionSlide.dataset.bookmarked === "true",
        question_source: currentQuizType === 'cme' ? 'cme_module' : 'regular_quiz',
        quiz_position: currentQuestion + 1,
        user_tier: window.authState?.accessTier || 'free_guest'
      });
  }

    // Get peer statistics and update the display
    const peerStats = await getPeerStats(qId);

    options.forEach(option => {
        option.disabled = true;
        const optionLetter = option.getAttribute('data-option');

        // Add the .correct or .incorrect class for styling the border and text
        if (optionLetter === correct) {
            option.classList.add('correct');
        }
        if (optionLetter === selected && !isCorrect) {
            option.classList.add('incorrect');
        }

        // Add peer percentage display if stats are available
        if (peerStats && peerStats.totalResponses > 0) {
            const choiceCount = peerStats[`choice${optionLetter}`] || 0;
            const percentage = Math.round((choiceCount / peerStats.totalResponses) * 100);

            // 1. Create and add the background bar
            const backgroundBar = document.createElement('div');
            backgroundBar.className = 'peer-stat-bar';
            backgroundBar.style.width = percentage + '%';

            if (optionLetter === correct) {
                backgroundBar.classList.add('bar-correct');
            } else if (optionLetter === selected) {
                backgroundBar.classList.add('bar-incorrect');
            } else {
                backgroundBar.classList.add('bar-neutral');
            }
            option.prepend(backgroundBar); // Adds the bar behind the text

            // 2. Create and add the percentage text
            const percentageSpan = document.createElement('span');
            percentageSpan.className = 'peer-percentage';
            percentageSpan.textContent = `${percentage}%`;
            option.appendChild(percentageSpan); // Adds the percentage to the button
        }
    });
          if (!isCorrect) { this.classList.add('incorrect'); }
          const hint = card.querySelector('.swipe-hint');
          console.log("Found hint element:", hint); // Debug log
          if (hint) { 
            console.log("Updating hint text"); // Debug log
            hint.textContent = 'Swipe up for explanation';
            hint.style.color = '#28a745';
            hint.style.display = 'block'; // Force it to be visible
          } else {
            console.log("Hint element not found!"); // Debug log
          }
          const answerSlide = questionSlide.nextElementSibling;

          if (answerSlide) {

              // --- Check if it's the last question ---
              if (currentQuestion + 1 === totalQuestions) {
                  // --- THIS IS THE LAST QUESTION ---
                  console.log(`Quiz complete. Type: ${currentQuizType}, Onboarding: ${window.isOnboardingQuiz}`);

                  // --- Process the final answer FIRST ---
                  currentQuestion++; // Increment counter first
                  if (isCorrect) { score++; }
                  updateProgress(); // Update progress bar/text one last time

                  // ADD THIS: Track quiz completion
              if (analytics && logEvent) {
                const finalAccuracy = Math.round((score / totalQuestions) * 100);
                const totalTimeSpent = Math.round((Date.now() - (questionStartTime - timeSpent)) / 1000);
                
                logEvent(analytics, 'quiz_complete', {
                  quiz_type: currentQuizType,
                  category: category,
                  score: score,
                  total_questions: totalQuestions,
                  accuracy_percentage: finalAccuracy,
                  time_spent_seconds: totalTimeSpent,
                  user_tier: window.authState?.accessTier || 'free_guest'
                });
              }

                  // --- Record the final answer ---
                  if (currentQuizType === 'cme') { // CME recording (Dedicated CME Module Flow - No Change Here)
                      if (typeof recordCmeAnswer === 'function') {
                          await recordCmeAnswer(qId, category, isCorrect, timeSpent);
                          console.log(`Recorded FINAL CME answer for ${qId}`);
                      } else { console.error("recordCmeAnswer not found"); }
                  } else { // Regular or Onboarding recording
                      // 1. Record Regular Answer
                      if (typeof recordAnswer === 'function') {
                          await recordAnswer(qId, category, isCorrect, timeSpent);
                          console.log(`Recorded FINAL regular/onboarding answer for ${qId}`);
                      } else { console.error("recordAnswer not found"); }
                      // 2. Update General Question Stats
                      if (typeof updateQuestionStats === 'function') {
                          await updateQuestionStats(qId, isCorrect);
                      } else { console.error("updateQuestionStats not found"); }

                                                      // 3. *** ADDED: Parallel CME Tracking for Eligible Regular Questions ***
                const isCmeEligible = questionSlide.dataset.cmeEligible === "true";
                if (isCmeEligible) {
                     // --- ADD CHECK FOR AUTHENTICATED USER ---
                    if (auth && auth.currentUser && !auth.currentUser.isAnonymous) {
                        console.log(`FINAL Regular quiz question ${qId} is CME Eligible. Recording parallel CME stats for logged-in user...`);
                        if (typeof recordCmeAnswer === 'function') {
                            await recordCmeAnswer(qId, category, isCorrect, timeSpent);
                            console.log(`Recorded parallel CME stats for FINAL regular quiz question ${qId}`);
                        } else {
                            console.error("recordCmeAnswer function not found for final parallel tracking.");
                        }
                    } else {
                        console.log(`FINAL Regular quiz question ${qId} is CME Eligible, but user is anonymous. Skipping parallel CME recording.`);
                    }
                    // --- END CHECK FOR AUTHENTICATED USER ---
                }
                // *** END: Parallel CME Tracking ***
            }
            // --- End of processing final answer ---


                  // --- Set up the final explanation slide content ---
                  const finalAnswerCard = answerSlide.querySelector('.card');
                  finalAnswerCard.classList.add('answer-card'); // Add class for answer card styling
                  
                  finalAnswerCard.innerHTML = `
                      <div class="explanation-container">
                          <div class="answer-content">
                              <div class="answer">
                                  <strong>You got it ${isCorrect ? "Correct" : "Incorrect"}</strong><br>
                                  Correct Answer: ${correct}<br>
                                  ${explanation}
                              </div>
                          </div>
                      </div>
                      <div class="answer-bottom-actions">
                          <div class="difficulty-buttons">
                              <p class="difficulty-prompt">How difficult was this question?</p>
                              <div class="difficulty-btn-container">
                                  <button class="difficulty-btn easy-btn" data-difficulty="easy">Easy</button>
                                  <button class="difficulty-btn medium-btn" data-difficulty="medium">Medium</button>
                                  <button class="difficulty-btn hard-btn" data-difficulty="hard">Hard</button>
                              </div>
                          </div>
                      </div>
                  `;
                  
                  // Check if content is truncated and add "more" button if needed
setTimeout(() => {
  const answerContent = finalAnswerCard.querySelector('.answer-content');
  const answer = answerContent.querySelector('.answer');
  
  // Add 30px buffer to account for the gradient overlay
  if (answer.scrollHeight > answerContent.clientHeight - 30) {
                          // Content is truncated, add "more" button
                          const moreButton = document.createElement('button');
                          moreButton.className = 'more-button';
                          moreButton.textContent = '...more';
                          
                          // Insert the more button in the explanation container
                          const explanationContainer = finalAnswerCard.querySelector('.explanation-container');
                          explanationContainer.appendChild(moreButton);
                          
                          moreButton.addEventListener('click', function() {
                            answerContent.classList.add('expanded');
                            finalAnswerCard.classList.add('has-expanded-content');
                            moreButton.style.display = 'none';
                            
                            // Force a reflow to ensure scrolling works
                            answerContent.scrollTop = 0;
                            
                            // Prevent swiper from intercepting touch events
                            if (window.mySwiper) {
                                // Store the original state
                                const originalTouchMove = window.mySwiper.allowTouchMove;
                                
                                // Disable swiper touch while scrolling
                                answerContent.addEventListener('touchstart', function(e) {
                                    window.mySwiper.allowTouchMove = false;
                                }, { passive: true });
                                
                                // Re-enable when touch ends outside the content area
                                document.addEventListener('touchend', function(e) {
                                    if (!answerContent.contains(e.target)) {
                                        window.mySwiper.allowTouchMove = originalTouchMove;
                                    }
                                }, { passive: true });
                            }
                        });
                      }
                  }, 100); // Small delay to ensure DOM is rendered
                  
                  // Add difficulty button listeners for the last question
                  addDifficultyListeners(answerSlide, qId, isCorrect); // Use helper

                  // Add the action button to the bottom actions container
                  const bottomActions = finalAnswerCard.querySelector('.answer-bottom-actions');


                                   // --- Add the correct FINAL ACTION BUTTON based on quiz type ---
                                   const lastCard = answerSlide.querySelector('.card');
                                   if (bottomActions) {
                                       if (currentQuizType === 'cme') {
                                           // --- CME Quiz End Action --- (No Change Here)
                                           const returnButton = document.createElement('button');
                                           returnButton.id = "returnToCmeDashboardBtn";
                                           returnButton.className = "start-quiz-btn";
                                           returnButton.textContent = "Return to CME Dashboard";
                                           returnButton.style.display = "block";
                                           returnButton.style.margin = "20px auto";
                                           // Add smaller size styling
                                           returnButton.style.width = "180px";
                                           returnButton.style.fontSize = "0.9rem";
                                           returnButton.style.padding = "10px 15px";
                                           bottomActions.appendChild(returnButton);
                                           returnButton.addEventListener('click', function() {
                                             unlockBodyScroll();
                                               console.log("Return to CME Dashboard button clicked.");
                                               const swiperElement = document.querySelector(".swiper");
                                               const bottomToolbar = document.getElementById("bottomToolbar");
                                               const iconBar = document.getElementById("iconBar");
                                               if (swiperElement) swiperElement.style.display = "none";
                                               if (bottomToolbar) bottomToolbar.style.display = "none";
                                               if (iconBar) iconBar.style.display = "none";
                                               if (typeof window.showCmeDashboard === 'function') {
                                                   window.showCmeDashboard();
                                               } else {
                                                   console.error("window.showCmeDashboard function not found from quiz.js!");
                                                   const mainOpts = document.getElementById("mainOptions");
                                                   if(mainOpts) mainOpts.style.display = "flex";
                                                   alert("Error: Could not navigate back to the dashboard.");
                                               }
                                           });
                                           // --- End CME Action ---
                 
                                          } else if (window.isOnboardingQuiz) {
                                            // --- Onboarding Quiz End Action ---
                                            // Create a button that will trigger the onboarding summary screen.
                                            const summaryButton = document.createElement('button');
                                            summaryButton.id = "viewOnboardingSummaryBtn"; // Use a new ID
                                            summaryButton.className = "start-quiz-btn";
                                            summaryButton.textContent = "Loading Summary..."; // Initial text
                                            summaryButton.style.display = "block";
                                            summaryButton.style.margin = "20px auto";
                                            bottomActions.appendChild(summaryButton);
                                        
                                            // Prepare the summary data in the background.
                                            // This is similar to the regular quiz flow but calls a new function.
                                            if (typeof prepareOnboardingSummary === 'function') {
                                                setTimeout(() => {
                                                    prepareOnboardingSummary();
                                                }, 500); // A small delay to ensure UI updates.
                                            }
                                            // --- End Onboarding Action ---
                 
                                       // --- START OF NEW CODE ---
                                       } else if (currentQuizType === 'deep_link') {
                                           // --- Deep Link Quiz End Action ---
                                           console.log("Deep link quiz finished.");
                                           const returnToAppButton = document.createElement('button');
                                           returnToAppButton.id = "returnToAppBtn";
                                           returnToAppButton.className = "start-quiz-btn";
                                           returnToAppButton.textContent = "Explore the App";
                                           returnToAppButton.style.display = "block";
                                           returnToAppButton.style.margin = "20px auto";
                                           bottomActions.appendChild(returnToAppButton);
                 
                                           returnToAppButton.addEventListener('click', function() {
                                               unlockBodyScroll();
                                               // Hide all quiz elements
                                               const swiperElement = document.querySelector(".swiper");
                                               const bottomToolbar = document.getElementById("bottomToolbar");
                                               const iconBar = document.getElementById("iconBar");
                                               if (swiperElement) swiperElement.style.display = "none";
                                               if (bottomToolbar) bottomToolbar.style.display = "none";
                                               if (iconBar) iconBar.style.display = "none";
                 
                                               // Show the main dashboard
                                               const mainOptions = document.getElementById("mainOptions");
                                               if (mainOptions) mainOptions.style.display = "flex";
                 
                                               // CRITICAL: Re-initialize the dashboard and its event listeners
                                               if (typeof initializeDashboard === 'function') {
                                                   console.log("Re-initializing dashboard after deep link quiz.");
                                                   initializeDashboard();
                                               }
                                               if (typeof setupDashboardEvents === 'function') {
                                                   console.log("Re-attaching dashboard event listeners.");
                                                   setupDashboardEvents();
                                               }
                                           });
                                       // --- END OF NEW CODE ---
                 
                                       } else {
                                           // --- Regular Quiz End Action --- (No Change Here)
                                           const summaryButton = document.createElement('button');
                                           summaryButton.id = "viewSummaryBtn";
                                           summaryButton.className = "start-quiz-btn";
                                           summaryButton.textContent = "Loading Summary...";
                                           summaryButton.style.display = "block";
                                           summaryButton.style.margin = "20px auto";
                                           bottomActions.appendChild(summaryButton);
                                           if (typeof prepareSummary === 'function') {
                                               setTimeout(() => {
                                                   prepareSummary();
                                               }, 500);
                                           }
                                           // --- End Regular Action ---
                                       }
                                      } // end if(bottomActions)

                                  } else {
                                    // --- Logic for NON-last questions ---
                                    const answerCard = answerSlide.querySelector('.card');
                                    answerCard.classList.add('answer-card'); // Add class for answer card styling
                                    
                                    answerCard.innerHTML = `
                                        <div class="explanation-container">
                                            <div class="answer-content">
                                                <div class="answer">
                                                    <strong>You got it ${isCorrect ? "Correct" : "Incorrect"}</strong><br>
                                                    Correct Answer: ${correct}<br>
                                                    ${explanation}
                                                </div>
                                            </div>
                                        </div>
                                        <div class="answer-bottom-actions">
                                            <div class="difficulty-buttons">
                                                <p class="difficulty-prompt">How difficult was this question?</p>
                                                <div class="difficulty-btn-container">
                                                    <button class="difficulty-btn easy-btn" data-difficulty="easy">Easy</button>
                                                    <button class="difficulty-btn medium-btn" data-difficulty="medium">Medium</button>
                                                    <button class="difficulty-btn hard-btn" data-difficulty="hard">Hard</button>
                                                </div>
                                            </div>
                                            <p class="swipe-next-hint">Swipe up for next question</p>
                                        </div>
                                    `;
                                    
                                    // Check if content is truncated and add "more" button if needed
setTimeout(() => {
  const answerContent = answerCard.querySelector('.answer-content');
  const answer = answerContent.querySelector('.answer');
  
  // Add 30px buffer to account for the gradient overlay
  if (answer.scrollHeight > answerContent.clientHeight - 30) {
                                            // Content is truncated, add "more" button
                                            const moreButton = document.createElement('button');
                                            moreButton.className = 'more-button';
                                            moreButton.textContent = '...more';
                                            
                                            // Insert the more button in the explanation container
                                            const explanationContainer = answerCard.querySelector('.explanation-container');
                                            explanationContainer.appendChild(moreButton);
                                            
                                            moreButton.addEventListener('click', function() {
                                              answerContent.classList.add('expanded');
                                              answerCard.classList.add('has-expanded-content');
                                              moreButton.style.display = 'none';
                                              
                                              // Force a reflow to ensure scrolling works
                                              answerContent.scrollTop = 0;
                                              
                                              // Prevent swiper from intercepting touch events
                                              if (window.mySwiper) {
                                                  // Store the original state
                                                  const originalTouchMove = window.mySwiper.allowTouchMove;
                                                  
                                                  // Disable swiper touch while scrolling
                                                  answerContent.addEventListener('touchstart', function(e) {
                                                      window.mySwiper.allowTouchMove = false;
                                                  }, { passive: true });
                                                  
                                                  // Re-enable when touch ends outside the content area
                                                  document.addEventListener('touchend', function(e) {
                                                      if (!answerContent.contains(e.target)) {
                                                          window.mySwiper.allowTouchMove = originalTouchMove;
                                                      }
                                                  }, { passive: true });
                                              }
                                          });
                                        }
                                    }, 100); // Small delay to ensure DOM is rendered
                                    
                                    // Add difficulty listeners
                                    addDifficultyListeners(answerSlide, qId, isCorrect); // Use helper
                  
                                    // Process the answer for non-last questions
                                    currentQuestion++;
                                    if (isCorrect) { score++; }
                                    updateProgress();

                  // --- Record the answer ---
                  if (currentQuizType === 'cme') { // Dedicated CME Module Flow - No Change Here
                      if (typeof recordCmeAnswer === 'function') {
                          await recordCmeAnswer(qId, category, isCorrect, timeSpent);
                          console.log(`Recorded CME answer for ${qId}`);
                      } else { console.error("recordCmeAnswer not found"); }
                  } else { // Regular or Onboarding recording
                      // 1. Record Regular Answer
                      if (typeof recordAnswer === 'function') {
                          await recordAnswer(qId, category, isCorrect, timeSpent);
                          console.log(`Recorded regular/onboarding answer for ${qId}`);
                      } else { console.error("recordAnswer not found"); }
                      // 2. Update General Question Stats
                      if (typeof updateQuestionStats === 'function') {
                          await updateQuestionStats(qId, isCorrect);
                      } else { console.error("updateQuestionStats not found"); }

                                      // 3. *** ADDED: Parallel CME Tracking for Eligible Regular Questions ***
                const isCmeEligible = questionSlide.dataset.cmeEligible === "true";
                if (isCmeEligible) {
                    // --- ADD CHECK FOR AUTHENTICATED USER ---
                    if (auth && auth.currentUser && !auth.currentUser.isAnonymous) {
                        console.log(`Regular quiz question ${qId} is CME Eligible. Recording parallel CME stats for logged-in user...`);
                        if (typeof recordCmeAnswer === 'function') {
                            await recordCmeAnswer(qId, category, isCorrect, timeSpent);
                            console.log(`Recorded parallel CME stats for regular quiz question ${qId}`);
                        } else {
                            console.error("recordCmeAnswer function not found for parallel tracking.");
                        }
                    } else {
                        console.log(`Regular quiz question ${qId} is CME Eligible, but user is anonymous. Skipping parallel CME recording.`);
                    }
                    // --- END CHECK FOR AUTHENTICATED USER ---
                }
                // *** END: Parallel CME Tracking ***
            }
            // --- End of logic for NON-last questions ---
              } // End of if/else for last question check

          } // End of if(answerSlide)

      }); // End of click listener
  }); // End of forEach
} // End of addOptionListeners function

// Prepare summary data and update the button
async function prepareSummary() {
  console.log("Preparing summary...");
  
  try {
    // Get the latest user data to calculate XP earned
    let sessionXP = 0;
    let currentLevel = 1;
    let currentXP = 0;
    let levelProgress = 0; // Added for level progress calculation
    
    if (auth && auth.currentUser) {
      const uid = auth.currentUser.uid;
      const userDocRef = doc(db, 'users', uid);
      const userDocSnap = await getDoc(userDocRef);
      
      if (userDocSnap.exists()) {
        const data = userDocSnap.data();
        if (data.stats) {
          currentXP = data.stats.xp || 0;
          currentLevel = data.stats.level || 1;
          
           // Calculate actual XP earned by comparing end XP with start XP
          sessionXP = currentXP - sessionStartXP;
          console.log("Quiz XP calculation:", currentXP, "-", sessionStartXP, "=", sessionXP);

          // Calculate level progress percentage
          // First, determine XP thresholds for current and next levels
          const levelThresholds = [
            0,     // Level 1
            30,    // Level 2
            75,    // Level 3
            150,   // Level 4
            250,   // Level 5
            400,   // Level 6
            600,   // Level 7
            850,   // Level 8
            1150,  // Level 9
            1500,  // Level 10
            2000,  // Level 11
            2750,  // Level 12
            3750,  // Level 13
            5000,  // Level 14
            6500   // Level 15
          ];
          
          const currentLevelXP = levelThresholds[currentLevel - 1] || 0;
          const nextLevelXP = currentLevel < levelThresholds.length ? levelThresholds[currentLevel] : null;
          
          if (nextLevelXP !== null) {
            const xpInCurrentLevel = currentXP - currentLevelXP;
            const xpRequiredForNextLevel = nextLevelXP - currentLevelXP;
            levelProgress = Math.min(100, Math.floor((xpInCurrentLevel / xpRequiredForNextLevel) * 100));
            console.log("Level progress calculation:", xpInCurrentLevel, "/", xpRequiredForNextLevel, "=", levelProgress + "%");
          } else {
            // Max level reached
            levelProgress = 100;
          }
        }
      }
    }
      
    // Calculate accuracy percentage
    const accuracy = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
    
    // Get appropriate message based on performance
    let performanceMessage = "";
    if (accuracy >= 90) {
      performanceMessage = "Excellent work! You're mastering this material!";
    } else if (accuracy >= 70) {
      performanceMessage = "Great job! Keep up the good work!";
    } else if (accuracy >= 50) {
      performanceMessage = "Good effort! Keep practicing to improve!";
    } else {
      performanceMessage = "Keep practicing! You'll improve with time.";
    }
    
    // Store summary data
    window.summaryData = {
      sessionXP,
      currentLevel,
      currentXP,
      levelProgress, // Store the calculated level progress
      accuracy,
      performanceMessage
    };
    
    // Update the button to be clickable
    const viewSummaryBtn = document.getElementById('viewSummaryBtn');
    if (viewSummaryBtn) {
      viewSummaryBtn.textContent = "View Quiz Summary";
      viewSummaryBtn.addEventListener('click', showSummary);
      console.log("Summary button updated and ready");
    }
  } catch (error) {
    console.error("Error preparing summary:", error);
    // Still update the button with a fallback in case of error
    const viewSummaryBtn = document.getElementById('viewSummaryBtn');
    if (viewSummaryBtn) {
      viewSummaryBtn.textContent = "View Quiz Summary";
      viewSummaryBtn.addEventListener('click', showSummary);
    }
  }
}

// Show summary when button is clicked
function showSummary() {
  console.log("Showing summary...");
  
  const data = window.summaryData || {
    sessionXP: score * 3 + (totalQuestions - score),
    currentLevel: 1,
    currentXP: 0,
    levelProgress: 0,
    accuracy: totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0,
    performanceMessage: "Quiz complete!"
  };

  const accessTier = window.authState?.accessTier; // Get the current access tier
  const isFreeGuest = accessTier === "free_guest"; // Check if user is free_guest

  console.log(`Summary for accessTier: ${accessTier}, isFreeGuest: ${isFreeGuest}`);
  
  // Create and add the summary slide
  const summarySlide = document.createElement("div");
  summarySlide.className = "swiper-slide";

  // Conditionally create the leaderboard button HTML
  let leaderboardButtonHtml = '';
  if (!isFreeGuest) {
    leaderboardButtonHtml = `<button id="leaderboardButton" class="start-quiz-btn">View Leaderboard</button>`;
  } else {
    console.log("User is free_guest, hiding View Leaderboard button on summary.");
  }

  summarySlide.innerHTML = `
    <div class="card quiz-summary-card">
      <div class="summary-header">
        <h2>Quiz Complete!</h2>
      </div>
      
      <div class="summary-score">
        <div class="score-circle" style="background: conic-gradient(#28a745 ${data.accuracy}%, #f0f0f0 0);">
          <span>${data.accuracy}%</span>
        </div>
        <div class="score-text">
          <p><strong>${score} / ${totalQuestions}</strong> correct</p>
          <p>${data.performanceMessage}</p>
        </div>
      </div>
      
      <div class="summary-xp">
        <div class="xp-header">XP Earned This Session</div>
        <div class="xp-value">+${data.sessionXP} XP</div>
        <div class="xp-bar-container">
          <div class="xp-bar" style="width: ${data.levelProgress}%;"></div>
        </div>
        <div class="xp-total">Total: ${data.currentXP} XP (Level ${data.currentLevel})</div>
      </div>
      
      <div class="summary-buttons">
        <button id="startNewQuizButton" class="start-quiz-btn">Start New Quiz</button>
        ${leaderboardButtonHtml}
      </div>
    </div>
  `;
  
  document.getElementById("quizSlides").appendChild(summarySlide);
  window.mySwiper.update();
  window.mySwiper.slideTo(window.mySwiper.slides.length - 1);
  
  // Add event listener for the "Start New Quiz" button
  const startNewQuizButton = document.getElementById("startNewQuizButton");
  if (startNewQuizButton) {
    // Clone and replace to ensure fresh listener
    const newStartNewQuizButton = startNewQuizButton.cloneNode(true);
    startNewQuizButton.parentNode.replaceChild(newStartNewQuizButton, startNewQuizButton);
    newStartNewQuizButton.addEventListener("click", function() {
      unlockBodyScroll();
        window.filterMode = "all"; // Assuming filterMode is a global or appropriately scoped variable
        document.getElementById("aboutView").style.display = "none";
        document.getElementById("faqView").style.display = "none";
        document.querySelector(".swiper").style.display = "none";
        document.getElementById("bottomToolbar").style.display = "none";
        document.getElementById("iconBar").style.display = "none";
        document.getElementById("performanceView").style.display = "none";
        document.getElementById("leaderboardView").style.display = "none";
        document.getElementById("mainOptions").style.display = "flex";
        if (typeof ensureEventListenersAttached === 'function') { // Assuming ensureEventListenersAttached is defined in app.js
            ensureEventListenersAttached();
        }
    });
  }
  
  // Add event listener for the "View Leaderboard" button ONLY if it exists
  if (!isFreeGuest) {
    const leaderboardButton = document.getElementById("leaderboardButton");
    if (leaderboardButton) {
        // Clone and replace to ensure fresh listener
        const newLeaderboardButton = leaderboardButton.cloneNode(true);
        leaderboardButton.parentNode.replaceChild(newLeaderboardButton, leaderboardButton);
        newLeaderboardButton.addEventListener("click", function() {
          unlockBodyScroll();
            document.getElementById("aboutView").style.display = "none";
            document.getElementById("faqView").style.display = "none";
            document.querySelector(".swiper").style.display = "none";
            document.getElementById("bottomToolbar").style.display = "none";
            document.getElementById("iconBar").style.display = "none";
            document.getElementById("performanceView").style.display = "none";
            document.getElementById("faqView").style.display = "none"; // Duplicate, but harmless
            document.getElementById("mainOptions").style.display = "none";
            if (typeof showLeaderboard === 'function') { // Assuming showLeaderboard is defined in ui.js and globally accessible or imported
                showLeaderboard();
            }
            if (typeof ensureEventListenersAttached === 'function') {
                ensureEventListenersAttached();
            }
        });
    }
  }
}

// Update quiz progress and score displays
function updateProgress() {
  const progressPercent = totalQuestions > 0 ? (currentQuestion / totalQuestions) * 100 : 0;
  document.getElementById("progressBar").style.width = progressPercent + "%";
  document.getElementById("questionProgress").textContent = `${currentQuestion} / ${totalQuestions}`;
  document.getElementById("scoreDisplay").textContent = `Score: ${score}`;
  localStorage.setItem("quizProgress", JSON.stringify({
    quizData: allQuestions,
    currentQuestion,
    score,
    answeredIds,
    filterMode: window.filterMode,
    selectedCategory
  }));
  
  // Use the new function name
  if (typeof updateUserXP === 'function') {
    updateUserXP();
  }
}

// --- Helper function for difficulty buttons ---
// Make sure this function is defined in the main scope of quiz.js, not inside another function

async function addDifficultyListeners(answerSlide, questionId, isCorrect) {
    // Find the container for the buttons within the specific answerSlide provided
    const difficultyButtonContainer = answerSlide.querySelector('.difficulty-btn-container');
    if (!difficultyButtonContainer) {
         console.warn("Difficulty button container not found in this slide.");
         return; // Exit if container not found
    }
    const difficultyButtons = difficultyButtonContainer.querySelectorAll('.difficulty-btn');
    if (difficultyButtons.length === 0) {
         console.warn("Difficulty buttons not found in container.");
         return; // Exit if buttons not found
    }

    difficultyButtons.forEach(btn => {
        // Clone and replace to ensure only one listener is attached
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);

        newBtn.addEventListener('click', async function() {
            // 'this' refers to the clicked button (newBtn)
            const currentButtons = this.closest('.difficulty-btn-container').querySelectorAll('.difficulty-btn');

            // Prevent multiple clicks if already selected/disabled
            if (this.classList.contains('selected') || this.disabled) {
                return;
            }

            currentButtons.forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');

            const difficulty = this.getAttribute('data-difficulty');

            // Calculate next review interval based on difficulty and correctness
            let nextReviewInterval = 1; // Default 1 day
            if (isCorrect) {
                if (difficulty === 'easy') nextReviewInterval = 7;
                else if (difficulty === 'medium') nextReviewInterval = 3;
                else if (difficulty === 'hard') nextReviewInterval = 1;
            } else {
                nextReviewInterval = 1; // Always review incorrect soon
            }

            // Store the spaced repetition data (ensure function exists)
            if (typeof updateSpacedRepetitionData === 'function') {
                 try {
                     await updateSpacedRepetitionData(questionId, isCorrect, difficulty, nextReviewInterval);
                 } catch (e) { console.error("Error calling updateSpacedRepetitionData:", e); }
            } else { console.error("updateSpacedRepetitionData function not found"); }


            // Show feedback to the user
            const difficultyButtonsDiv = this.closest('.difficulty-buttons'); // Find the parent div
            if (difficultyButtonsDiv) {
                const existingFeedback = difficultyButtonsDiv.querySelector('.review-scheduled');
                if(existingFeedback) existingFeedback.remove(); // Remove old feedback

                const feedbackEl = document.createElement('p');
                feedbackEl.className = 'review-scheduled';
                feedbackEl.textContent = `Review scheduled in ${nextReviewInterval} ${nextReviewInterval === 1 ? 'day' : 'days'}`;
                difficultyButtonsDiv.appendChild(feedbackEl); // Append feedback within the correct div
            }

            // Disable all buttons after selection
            currentButtons.forEach(b => b.disabled = true);
        });
    });
}

// --- Helper function to avoid repeating recording logic ---
// Place this in the main scope of quiz.js, near addDifficultyListeners

async function recordFinalAnswer(qId, category, isCorrect, timeSpent) {
    // Use the globally stored currentQuizType
    if (currentQuizType === 'cme') {
        // Call CME recording function (ensure it exists, likely in user.js)
        if (typeof recordCmeAnswer === 'function') {
            try {
                await recordCmeAnswer(qId, category, isCorrect, timeSpent);
                console.log(`Recorded CME answer for ${qId} via helper.`);
            } catch (e) { console.error(`Error calling recordCmeAnswer for ${qId}:`, e); }
        } else {
            console.error("recordCmeAnswer function not found when trying to record final answer.");
        }
    } else {
        // Call regular recording functions (ensure they exist, likely in user.js)
        if (typeof recordAnswer === 'function') {
             try {
                await recordAnswer(qId, category, isCorrect, timeSpent);
                console.log(`Recorded regular/onboarding answer for ${qId} via helper.`);
             } catch (e) { console.error(`Error calling recordAnswer for ${qId}:`, e); }
        } else {
            console.error("recordAnswer function not found when trying to record final answer.");
        }
        // Still update general question stats for non-CME quizzes
        if (typeof updateQuestionStats === 'function') {
             try {
                await updateQuestionStats(qId, isCorrect);
             } catch (e) { console.error(`Error calling updateQuestionStats for ${qId}:`, e); }
        } else {
            console.error("updateQuestionStats function not found when trying to record final answer.");
        }
    }
}
// --- End of recordFinalAnswer Helper Function ---

// Function to get peer statistics for a question
async function getPeerStats(questionId) {
  try {
    const choiceStatsRef = doc(db, 'choiceStats', questionId);
    const statsDoc = await getDoc(choiceStatsRef);
    
    if (statsDoc.exists()) {
      return statsDoc.data();
    }
    return null;
  } catch (error) {
    console.error("Error fetching peer stats:", error);
    return null;
  }
}

// Prepares the data for the onboarding summary screen
async function prepareOnboardingSummary() {
  console.log("Preparing onboarding summary...");

  try {
    // Calculate accuracy percentage
    const accuracy = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;

    // Store summary data globally for the next function to use
    window.onboardingSummaryData = {
      accuracy: accuracy,
      score: score,
      totalQuestions: totalQuestions
    };

    // Update the button to be clickable and change its text
    const viewSummaryBtn = document.getElementById('viewOnboardingSummaryBtn');
    if (viewSummaryBtn) {
      viewSummaryBtn.textContent = "Continue";
      // Add a click listener to show the summary screen
      viewSummaryBtn.addEventListener('click', showOnboardingSummary);
      console.log("Onboarding summary button updated and ready");
    }
  } catch (error) {
    console.error("Error preparing onboarding summary:", error);
    // Fallback in case of an error
    const viewSummaryBtn = document.getElementById('viewOnboardingSummaryBtn');
    if (viewSummaryBtn) {
      viewSummaryBtn.textContent = "Continue";
      viewSummaryBtn.addEventListener('click', showOnboardingSummary);
    }
  }
}

// Creates and displays the onboarding summary slide
function showOnboardingSummary() {
  console.log("Showing onboarding summary...");

  // Use the data prepared in the previous step
  const data = window.onboardingSummaryData || {
    accuracy: 0,
    score: 0,
    totalQuestions: 3
  };

  // Find the VERY LAST slide in the swiper, which is the empty answer slide.
  const lastSlide = window.mySwiper.slides[window.mySwiper.slides.length - 1];

  if (!lastSlide) {
    console.error("Could not find the last slide to show the summary.");
    return;
  }

  // Instead of creating a new slide, we will inject our summary HTML into this last slide.
  lastSlide.innerHTML = `
    <div class="card quiz-summary-card">
      <div class="summary-header">
        <h2>Quiz Complete!</h2>
      </div>
      
      <div class="summary-score">
        <div class="score-circle" style="background: conic-gradient(#28a745 ${data.accuracy}%, #f0f0f0 0);">
          <span>${data.accuracy}%</span>
        </div>
        <div class="score-text">
          <p><strong>${data.score} / ${data.totalQuestions}</strong> correct</p>
          <p>Great start! Let's get you familiar with the app.</p>
        </div>
      </div>
      
      <div class="summary-buttons">
        <button id="onboardingSummaryContinueBtn" class="start-quiz-btn">Continue</button>
      </div>
    </div>
  `;

  // We don't need to add a new slide or update the swiper instance.
  // We just need to make sure the user sees this last slide.
  window.mySwiper.slideTo(window.mySwiper.slides.length - 1);

  // Add an event listener for the new "Continue" button.
  // This will call the function in app.js to launch the carousel.
  const continueBtn = document.getElementById("onboardingSummaryContinueBtn");
  if (continueBtn) {
    continueBtn.addEventListener("click", function() {
      console.log("Onboarding summary 'Continue' clicked! Launching carousel...");
      // Check if the function exists on the window object before calling
      if (typeof window.startOnboardingCarousel === 'function') {
        window.startOnboardingCarousel();
      } else {
        console.error("startOnboardingCarousel function not found!");
      }
    });
  }
}

export {
  loadQuestions,
  initializeQuiz, // Export if needed elsewhere, maybe not
  // Add other functions from quiz.js if they need to be called from other files
  fetchQuestionBank, // Export if called from elsewhere (e.g. stats.js)
  updateBookmarkIcon, // Export if called from elsewhere
  addOptionListeners, // Likely internal, probably don't need to export
  prepareSummary, // Likely internal
  showSummary // Likely internal
};
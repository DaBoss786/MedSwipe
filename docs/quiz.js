// app.js - TOP OF FILE
import { shuffleArray, getCurrentQuestionId } from './utils.js';
import {
  applyCategoryAndAnsweredFilters,
  getEmptyQuestionMessage
} from './quiz-filtering.js';
import { auth, db, doc, getDoc, collection, getDocs, query, where } from './firebase-config.js'; // Adjust path if needed
import { logAnalyticsEvent } from './analytics.js';
import {
  recordAnswer,               // Needed for regular quizzes
  recordCmeAnswer,            // Needed for CME quizzes
  updateQuestionStats,        // Needed for regular quizzes
  updateSpacedRepetitionData,
  recordChoiceSelection
} from './user.v2.js';
import { showLeaderboard } from './ui.js'; 
import { playMedium, playLight, playTap } from './haptics.js';
import { getAnsweredQuestionIds } from './answered-questions.js';
import {
  ONBOARDING_ERROR_CODES,
  OnboardingFlowError
} from './onboarding-controller.js';
import {
  applyQuestionAccessPolicy,
  specialtyMatchesQuestion,
  shouldLimitQuestionsToFree,
  userHasBoardReviewAccess as hasBoardReviewAccessByPolicy
} from './specialty-policy.js';

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
let activeQuizRunId = 0;
let quizStartedAt = 0;
const pendingAnswerTasks = new Map();
const ONBOARDING_POOL_CACHE_TTL_MS = 5 * 60 * 1000;
const onboardingQuestionPoolCache = new Map();

function asQuizLoadError(error, fallbackCode = ONBOARDING_ERROR_CODES.QUIZ_INIT_FAILED) {
  if (error instanceof OnboardingFlowError) return error;
  return new OnboardingFlowError(
    error?.code || fallbackCode,
    error?.message || 'The quiz could not be initialized.',
    error ? { cause: error } : {}
  );
}

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

async function fetchQuizUserContext() {
  if (!auth?.currentUser) {
    return { answeredIds: [], bookmarks: [], sessionStartXP: 0 };
  }

  const userDocRef = doc(db, 'users', auth.currentUser.uid);
  const userDocSnap = await getDoc(userDocRef);
  if (!userDocSnap.exists()) {
    return { answeredIds: [], bookmarks: [], sessionStartXP: 0 };
  }

  const data = userDocSnap.data() || {};
  return {
    answeredIds: getAnsweredQuestionIds(data.answeredQuestions),
    bookmarks: Array.isArray(data.bookmarks) ? data.bookmarks : [],
    sessionStartXP: Number(data.stats?.xp || 0)
  };
}

function scopeQuestionsForSpecialty(questions, specialty) {
  const effectiveAuthState = {
    ...getEffectiveAuthState(),
    specialty
  };
  const specialtyScoped = questions.filter((question) =>
    specialtyMatchesQuestion(question, specialty)
  );
  return applyQuestionAccessPolicy(specialtyScoped, effectiveAuthState);
}

async function fetchOnboardingQuestionPool(specialty, options = {}) {
  const specialtyKey = String(specialty || 'ENT').trim().toLowerCase();
  const forceRefresh = options.forceRefresh === true;
  const now = Date.now();
  const cached = onboardingQuestionPoolCache.get(specialtyKey);

  if (!forceRefresh && cached && cached.expiresAt > now) {
    if (cached.result) {
      return { ...cached.result, source: 'cache' };
    }
    return cached.promise;
  }

  const promise = (async () => {
    try {
      const freeQuery = query(
        collection(db, 'questions'),
        where('Free', '==', true)
      );
      const freeSnapshot = await getDocs(freeQuery);
      const freeQuestions = freeSnapshot.docs.map((snapshot) => snapshot.data());
      let questions = scopeQuestionsForSpecialty(freeQuestions, specialty);
      let source = 'network_free';

      if (questions.length < 3) {
        const fullBank = await fetchQuestionBank();
        questions = scopeQuestionsForSpecialty(fullBank, specialty);
        source = 'network_full_fallback';
      }

      if (questions.length < 3) {
        throw new OnboardingFlowError(
          ONBOARDING_ERROR_CODES.INSUFFICIENT_QUESTIONS,
          `Only ${questions.length} eligible onboarding questions were found.`
        );
      }

      const result = { questions, source };
      onboardingQuestionPoolCache.set(specialtyKey, {
        result,
        expiresAt: Date.now() + ONBOARDING_POOL_CACHE_TTL_MS
      });
      return result;
    } catch (error) {
      onboardingQuestionPoolCache.delete(specialtyKey);
      throw asQuizLoadError(
        error,
        error?.code || ONBOARDING_ERROR_CODES.QUESTION_FETCH_FAILED
      );
    }
  })();

  onboardingQuestionPoolCache.set(specialtyKey, {
    promise,
    expiresAt: now + ONBOARDING_POOL_CACHE_TTL_MS
  });
  return promise;
}

function prefetchOnboardingQuestionPool(specialty) {
  return fetchOnboardingQuestionPool(specialty).catch((error) => {
    console.warn('Onboarding question prefetch did not complete:', error);
    return null;
  });
}

function isQuestionCmeEligible(question) {
  const flag = question?.["CME Eligible"];
  if (typeof flag === 'boolean') {
    return flag;
  }
  if (typeof flag === 'string') {
    const normalized = flag.trim().toLowerCase();
    return normalized === 'yes' || normalized === 'true';
  }
  return false;
}

function getCurrentUserSpecialty() {
  const fromAuthState = window.authState?.specialty;
  if (typeof fromAuthState === 'string' && fromAuthState.trim()) {
    return fromAuthState.trim();
  }

  const fromSelectedSpecialty = window.selectedSpecialty;
  if (typeof fromSelectedSpecialty === 'string' && fromSelectedSpecialty.trim()) {
    return fromSelectedSpecialty.trim();
  }

  return 'ENT';
}

function getEffectiveAuthState() {
  const state = window.authState || {};
  return {
    ...state,
    accessTier: state.accessTier || 'free_guest',
    specialty: state.specialty || getCurrentUserSpecialty()
  };
}

function scopeQuestionsForCurrentUser(questions = []) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return [];
  }

  const effectiveAuthState = getEffectiveAuthState();
  const specialty = effectiveAuthState.specialty || null;

  const specialtyScoped = questions.filter((question) =>
    specialtyMatchesQuestion(question, specialty)
  );

  return applyQuestionAccessPolicy(specialtyScoped, effectiveAuthState);
}

function hasBoardReviewAccessForCurrentUser() {
  return hasBoardReviewAccessByPolicy(getEffectiveAuthState());
}

// MODIFIED loadQuestions function
async function loadQuestions(options = {}) {
  console.log("Loading questions with options:", options);
  window.isOnboardingQuiz = options.isOnboarding || false;

  // Track quiz start
  const effectiveAuthState = getEffectiveAuthState();
  const accessTier = effectiveAuthState.accessTier || 'free_guest';
  const isGuest = !auth.currentUser || auth.currentUser.isAnonymous;

  logAnalyticsEvent('quiz_start', {
    quiz_type: options.quizType || 'regular',
    category: options.category || 'all_categories',
    procedure: options.procedure || null,
    num_questions: options.num || 10,
    user_tier: accessTier,
    is_guest: isGuest,
    board_review_only: options.boardReviewOnly || false,
    spaced_repetition: options.spacedRepetition || false,
    search_used: !!options.prefilteredQuestions
  });

  try {
    const userContext = options.userContext || await fetchQuizUserContext();
    let filteredQuestions = []; // Initialize as empty
    let answeredFilterApplied = false;
    let accessibleQuestionCountBeforeAnsweredFilter = 0;

    // --- FIX: This is the corrected logic block ---
    if (options.prefilteredQuestions) {
      // SCENARIO 1: User used the search bar. Use the pre-filtered list.
      console.log("Using pre-filtered questions from modal search.");
      filteredQuestions = scopeQuestionsForCurrentUser(options.prefilteredQuestions);

      if (options.quizType !== 'cme' && !options.bookmarksOnly && !options.includeAnswered) {
        answeredFilterApplied = true;
        accessibleQuestionCountBeforeAnsweredFilter = filteredQuestions.length;
        const answeredIds = userContext.answeredIds;
        filteredQuestions = applyCategoryAndAnsweredFilters({
          questions: filteredQuestions,
          includeAnswered: false,
          answeredIds
        });
      }

    } else {
      // SCENARIO 2: User did NOT search. Perform all filtering now.
      console.log("No pre-filtered questions. Fetching and filtering from scratch.");
      const allQuestionsData = await fetchQuestionBank();
      const scopedQuestionBank = scopeQuestionsForCurrentUser(allQuestionsData);
      
      // This is the original filtering logic, now correctly placed inside the 'else'
      if (options.quizType === 'case_prep' && options.procedure) {
        // Case Prep logic...
        let procedureQuestions = scopedQuestionBank.filter(q =>
          q.Procedures && q.Procedures.trim().toLowerCase() === options.procedure.trim().toLowerCase()
        );
        if (!options.includeAnswered) {
          answeredFilterApplied = true;
          accessibleQuestionCountBeforeAnsweredFilter = procedureQuestions.length;
          const answeredIds = userContext.answeredIds;
          procedureQuestions = procedureQuestions.filter(q => !answeredIds.includes(q["Question"]?.trim()));
        }
        filteredQuestions = procedureQuestions;
      } else {
        // Regular, CME, etc. logic...
        filteredQuestions = scopedQuestionBank; // Start with scoped list
        let relevantAnsweredIdsForCurrentYear = [];

        if (options.quizType === 'cme' && !options.includeAnswered) {
          // ... cme answered logic ...
        } else if (!options.bookmarksOnly && !options.includeAnswered) {
          relevantAnsweredIdsForCurrentYear = userContext.answeredIds;
        }

        if (options.bookmarksOnly) {
          const bookmarks = userContext.bookmarks;
          if (bookmarks.length === 0) {
            alert("You don't have any bookmarks yet!");
            document.getElementById("mainOptions").style.display = "flex";
            return;
          }
          filteredQuestions = filteredQuestions.filter(q => bookmarks.includes(q["Question"]?.trim()));
        }

        filteredQuestions = applyCategoryAndAnsweredFilters({
          questions: filteredQuestions,
          category: options.category,
          bookmarksOnly: options.bookmarksOnly,
          includeAnswered: true,
          answeredIds: []
        });

        if (
          options.quizType !== 'cme' &&
          !options.bookmarksOnly &&
          !options.includeAnswered
        ) {
          answeredFilterApplied = true;
          accessibleQuestionCountBeforeAnsweredFilter = filteredQuestions.length;
          filteredQuestions = applyCategoryAndAnsweredFilters({
            questions: filteredQuestions,
            bookmarksOnly: false,
            includeAnswered: false,
            answeredIds: relevantAnsweredIdsForCurrentYear
          });
        }
      }
    }
    // --- END of corrected logic block ---

    if (options.quizType === 'cme') {
      filteredQuestions = filteredQuestions.filter(isQuestionCmeEligible);

      if (options.reviewIncorrectCmeOnly && Array.isArray(options.incorrectCmeQuestionIds) && options.incorrectCmeQuestionIds.length > 0) {
        const targetIds = new Set(options.incorrectCmeQuestionIds.map(id => (id || '').trim()));
        filteredQuestions = filteredQuestions.filter(q => targetIds.has((q["Question"] || '').trim()));
      }
    }
    filteredQuestions = scopeQuestionsForCurrentUser(filteredQuestions);

    // --- Common logic for ALL quiz types ---
    if (filteredQuestions.length === 0) {
      const isFreeTierLimited = shouldLimitQuestionsToFree(effectiveAuthState);
      const message = getEmptyQuestionMessage({
        quizType: options.quizType || 'regular',
        isFreeTierLimited,
        includeAnswered: options.includeAnswered === true,
        emptyStateContext: options.emptyStateContext || (
          options.category ||
          options.procedure ||
          options.bookmarksOnly ||
          options.prefilteredQuestions
            ? 'filtered'
            : 'all_questions'
        ),
        answeredFilterApplied,
        accessibleQuestionCountBeforeAnsweredFilter
      });
      alert(message);

      const mainOpts = document.getElementById("mainOptions");
      if (mainOpts) mainOpts.style.display = "flex";
      if (options.propagateErrors || options.isOnboarding) {
        throw new OnboardingFlowError(
          ONBOARDING_ERROR_CODES.INSUFFICIENT_QUESTIONS,
          message
        );
      }
      return { status: 'empty' };
    }

    let selectedQuestions = shuffleArray(filteredQuestions);
    const numQuestionsToLoad = options.num || 10;

    if (selectedQuestions.length > numQuestionsToLoad) {
      selectedQuestions = selectedQuestions.slice(0, numQuestionsToLoad);
    }
    console.log("Final selected questions count:", selectedQuestions.length);

    return await initializeQuiz(
      selectedQuestions,
      options.quizType || 'regular',
      userContext
    );

  } catch (error) {
    console.error("Error loading questions:", error);
    if (options.propagateErrors || options.isOnboarding) {
      throw asQuizLoadError(error);
    }
    alert("Error loading questions. Please check your connection and try again.");
    const mainOpts = document.getElementById("mainOptions");
    if (mainOpts) mainOpts.style.display = "flex";
    return { status: 'error', error };
  }
}


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
    const hasBoardAccess = hasBoardReviewAccessForCurrentUser();
    // Check if the user is anonymous/guest
    if (auth && auth.currentUser && auth.currentUser.isAnonymous && !hasBoardAccess) {
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
    const scopedQuestions = scopeQuestionsForCurrentUser(allQuestions);

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
    const unansweredQuestions = scopedQuestions.filter(q => {
      const qId = q["Question"].trim();
      return !answeredIds.includes(qId) && !dueQuestionIds.includes(qId);
    });
    
    // Get due review questions
    const dueReviewQuestions = scopedQuestions.filter(q => {
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

function waitForNextQuizPaint() {
  return new Promise((resolve) => {
    let fallbackTimer = null;
    const finish = () => {
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
      }
      resolve();
    };

    fallbackTimer = setTimeout(finish, 50);
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(finish);
    }
  });
}

// Initialize the quiz with the selected questions
async function initializeQuiz(questions, quizType = 'regular', userContext = null) {
  console.log(`Initializing quiz. Type: ${quizType}, Questions: ${questions.length}`); // Log quiz type
  currentQuizType = quizType; 
  questionStartTime = Date.now();
  quizStartedAt = questionStartTime;
  activeQuizRunId += 1;
  const quizRunId = activeQuizRunId;
  
  if (window.mySwiper) {
      window.mySwiper.destroy(true, true);
  }
  const resolvedUserContext = userContext || await fetchQuizUserContext();
  sessionStartXP = resolvedUserContext.sessionStartXP || 0;
  
  currentQuestion = 0;
  score = 0;
  totalQuestions = questions.length;
  answeredIds = [];
  updateProgress();
  
  // Get bookmarks to show the filled star for bookmarked questions
  const bookmarks = resolvedUserContext.bookmarks || [];
  
  const quizSlides = document.getElementById("quizSlides");
  if (!quizSlides) {
    throw new OnboardingFlowError(
      ONBOARDING_ERROR_CODES.QUIZ_INIT_FAILED,
      'The quiz slide container is unavailable.'
    );
  }
  quizSlides.innerHTML = "";
  questions.forEach((question, questionIndex) => {
    const questionSlide = document.createElement("div");
    questionSlide.className = "swiper-slide";
    const qId = question["Question"].trim();
    questionSlide.dataset.id = qId;
    questionSlide.dataset.questionIndex = String(questionIndex);
    questionSlide.dataset.quizRunId = String(quizRunId);
    questionSlide.dataset.correct = question["Correct Answer"].trim();
    questionSlide.dataset.explanation = question["Explanation"];
    questionSlide.dataset.category = question["Category"] || "Uncategorized";
    questionSlide.dataset.bookmarked = bookmarks.includes(qId) ? "true" : "false";
    questionSlide.dataset.imageUrl = question["Image URL"] || "";
    const cmeEligibleValue = question["CME Eligible"];
  const isCME = typeof cmeEligibleValue === 'boolean' ? cmeEligibleValue : (cmeEligibleValue && String(cmeEligibleValue).trim().toLowerCase() === 'yes');
  
  questionSlide.dataset.cmeEligible = isCME ? "true" : "false";

    questionSlide.innerHTML = `
      <div class="card">
        ${isCME ? '<div class="cme-tag">CME Eligible</div>' : ''}
        <div class="question">${question["Question"]}</div>
            ${question["Image URL"] && question["Image URL"].trim() !== ""
      ? `<button class="view-image-btn">View Image</button>`
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

  const quizContainer = document.querySelector(".swiper");
  if (!quizContainer || !quizSlides.querySelector('.swiper-slide .card')) {
    throw new OnboardingFlowError(
      ONBOARDING_ERROR_CODES.QUIZ_INIT_FAILED,
      'The first quiz card could not be rendered.'
    );
  }

  // Swiper cannot reliably calculate its slides while its root is display:none.
  // Reveal it underneath the onboarding overlay before construction; the
  // controller keeps it inert until this function reports that it is ready.
  quizContainer.style.display = "block";

  const SwiperConstructor = window.Swiper || globalThis.Swiper;
  if (typeof SwiperConstructor !== 'function') {
    throw new OnboardingFlowError(
      ONBOARDING_ERROR_CODES.SWIPER_UNAVAILABLE,
      'The quiz renderer is unavailable.'
    );
  }

  window.mySwiper = new SwiperConstructor('.swiper', {
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
    const previousIndex = window.mySwiper.previousIndex;
    const previousSlide = window.mySwiper.slides?.[previousIndex];

    if (
      typeof previousIndex === 'number' &&
      previousIndex !== activeIndex &&
      previousIndex % 2 === 0
    ) {
      const previousCard = previousSlide?.querySelector('.card');
      if (previousCard) {
        previousCard.dataset.correctPeerHapticEligible = "false";
      }
    }

    if (typeof previousIndex === 'number' && activeIndex > previousIndex && activeIndex % 2 === 0) {
      playLight();
    }
    
    if (activeIndex % 2 === 0) {
      questionStartTime = Date.now();
      console.log("New question slide. questionStartTime updated to:", questionStartTime);
      updateBookmarkIcon();
    }
    
    // Update swipe permissions for the new slide
    updateSwipePermissions();
  });

  addOptionListeners();
  setupImageModalListeners();

  // Set initial permissions after a small delay to ensure Swiper is fully initialized
  setTimeout(() => {
    updateSwipePermissions();
  }, 100);
  
  // Set the initial bookmark icon state for the first question
  updateBookmarkIcon();

  document.getElementById("bottomToolbar").style.display = "flex";
  document.getElementById("mainOptions").style.display = "none";
  document.getElementById("performanceView").style.display = "none";
  document.getElementById("iconBar").style.display = "flex";
  document.getElementById("aboutView").style.display = "none";
  document.getElementById("faqView").style.display = "none";
  // --- END OF MOVED CODE ---

  if (typeof window.mySwiper?.update === 'function') {
    window.mySwiper.update();
  }
  await waitForNextQuizPaint();
  if (typeof window.mySwiper?.update === 'function') {
    window.mySwiper.update();
  }

  if (
    !window.mySwiper ||
    !window.mySwiper.slides ||
    window.mySwiper.slides.length === 0 ||
    quizContainer.style.display === 'none'
  ) {
    throw new OnboardingFlowError(
      ONBOARDING_ERROR_CODES.QUIZ_INIT_FAILED,
      'Swiper did not expose the first quiz card.'
    );
  }

  return {
    status: 'ready',
    questionCount: questions.length,
    firstCardVisible: true,
    swiperReady: true
  };
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

// --- NEW FUNCTION TO HANDLE IMAGE MODAL ---
function setupImageModalListeners() {
  const imageModal = document.getElementById('questionImageModal');
  const modalImage = document.getElementById('modalImage');
  const closeButton = document.getElementById('closeImageModal');

  if (!imageModal || !modalImage || !closeButton) {
    console.error("Image modal elements not found!");
    return;
  }

  // Function to close the modal
  const closeModal = () => {
    imageModal.style.display = 'none';
    modalImage.src = ""; // Clear the image source
  };

  // Add listeners to close the modal
  closeButton.addEventListener('click', closeModal);
  imageModal.addEventListener('click', (event) => {
    // Close only if the user clicks on the dark background, not the image itself
    if (event.target === imageModal) {
      closeModal();
    }
  });

  // Add listeners to all "View Image" buttons
  document.querySelectorAll('.view-image-btn').forEach(button => {
    button.addEventListener('click', function() {
      const questionSlide = this.closest('.swiper-slide');
      const imageUrl = questionSlide.dataset.imageUrl;

      if (imageUrl) {
        modalImage.src = imageUrl;
        imageModal.style.display = 'flex';
      } else {
        alert("Image not found for this question.");
      }
    });
  });
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

function invokeHaptic(hapticFunction) {
  try {
    Promise.resolve(hapticFunction()).catch((error) => {
      console.warn("Quiz haptic failed:", error);
    });
  } catch (error) {
    console.warn("Quiz haptic failed:", error);
  }
}

function emitQuizAnalytics(name, details, { defer = false } = {}) {
  const emit = () => {
    try {
      Promise.resolve(logAnalyticsEvent(name, details)).catch((error) => {
        console.warn(`Quiz analytics event "${name}" failed:`, error);
      });
    } catch (error) {
      console.warn(`Quiz analytics event "${name}" failed:`, error);
    }
  };

  if (defer) {
    Promise.resolve().then(emit);
    return;
  }
  emit();
}

function renderPeerStats(answerContext, peerStats) {
  if (
    !peerStats ||
    peerStats.totalResponses <= 0 ||
    activeQuizRunId !== answerContext.quizRunId ||
    !answerContext.card?.isConnected ||
    answerContext.card.dataset.peerStatsRendered === "true"
  ) {
    return false;
  }

  answerContext.options.forEach((option) => {
    const optionLetter = option.getAttribute('data-option');
    const choiceCount = Number(peerStats[`choice${optionLetter}`]) || 0;
    const percentage = Math.round((choiceCount / peerStats.totalResponses) * 100);

    const backgroundBar = document.createElement('div');
    backgroundBar.className = 'peer-stat-bar';
    backgroundBar.style.width = `${percentage}%`;
    if (optionLetter === answerContext.correct) {
      backgroundBar.classList.add('bar-correct');
    } else if (optionLetter === answerContext.selected) {
      backgroundBar.classList.add('bar-incorrect');
    } else {
      backgroundBar.classList.add('bar-neutral');
    }
    option.prepend(backgroundBar);

    const percentageSpan = document.createElement('span');
    percentageSpan.className = 'peer-percentage';
    percentageSpan.textContent = `${percentage}%`;
    option.appendChild(percentageSpan);
  });

  answerContext.card.dataset.peerStatsRendered = "true";
  return true;
}

function playCorrectPeerHapticIfEligible(answerContext) {
  if (
    !answerContext.isCorrect ||
    answerContext.card.dataset.correctPeerHapticEligible !== "true" ||
    answerContext.card.dataset.correctPeerHapticPlayed === "true" ||
    activeQuizRunId !== answerContext.quizRunId ||
    !answerContext.card.isConnected
  ) {
    return false;
  }

  const swiper = window.mySwiper;
  const activeSlide = swiper?.slides?.[swiper.activeIndex];
  if (activeSlide !== answerContext.questionSlide) {
    answerContext.card.dataset.correctPeerHapticEligible = "false";
    return false;
  }

  answerContext.card.dataset.correctPeerHapticPlayed = "true";
  answerContext.card.dataset.correctPeerHapticEligible = "false";
  invokeHaptic(playMedium);
  return true;
}

function getQuizPlatform() {
  try {
    return window.Capacitor?.getPlatform?.() || 'web';
  } catch (error) {
    return 'web';
  }
}

function startPeerStatsWork(answerContext) {
  const startedAt = Date.now();
  return Promise.resolve()
    .then(() => recordChoiceSelection(answerContext.qId, answerContext.selected))
    .then((peerStats) => {
      const rendered = renderPeerStats(answerContext, peerStats);
      if (rendered) {
        playCorrectPeerHapticIfEligible(answerContext);
      }
      return {
        outcome: peerStats ? (rendered ? 'rendered' : 'stale') : 'unavailable',
        durationMs: Date.now() - startedAt
      };
    })
    .catch((error) => {
      console.error("Unable to record or display peer statistics:", error);
      return {
        outcome: 'failed',
        durationMs: Date.now() - startedAt
      };
    });
}

function createPersistenceOperations(answerContext) {
  if (answerContext.quizType === 'cme') {
    return [{
      name: 'cme_answer',
      run: () => recordCmeAnswer(
        answerContext.qId,
        answerContext.category,
        answerContext.isCorrect,
        answerContext.timeSpent
      )
    }];
  }

  const operations = [
    {
      name: 'answer',
      run: () => recordAnswer(
        answerContext.qId,
        answerContext.category,
        answerContext.isCorrect,
        answerContext.timeSpent
      )
    },
    {
      name: 'question_stats',
      run: () => updateQuestionStats(answerContext.qId, answerContext.isCorrect)
    }
  ];

  if (
    answerContext.isCmeEligible &&
    auth?.currentUser &&
    !auth.currentUser.isAnonymous
  ) {
    operations.push({
      name: 'parallel_cme_answer',
      run: () => recordCmeAnswer(
        answerContext.qId,
        answerContext.category,
        answerContext.isCorrect,
        answerContext.timeSpent
      )
    });
  }

  return operations;
}

function startAnswerPersistence(answerContext) {
  const startedAt = Date.now();
  const taskKey = `${answerContext.quizRunId}:${answerContext.questionIndex}:${answerContext.qId}`;
  const operations = createPersistenceOperations(answerContext);
  const task = Promise.allSettled(
    operations.map(({ run }) => Promise.resolve().then(run))
  ).then((results) => ({
    outcome: results.every((result) => result.status === 'fulfilled')
      ? 'completed'
      : 'partial_failure',
    durationMs: Date.now() - startedAt,
    operations: results.map((result, index) => ({
      name: operations[index].name,
      status: result.status
    }))
  }));

  pendingAnswerTasks.set(taskKey, task);
  task.finally(() => {
    if (pendingAnswerTasks.get(taskKey) === task) {
      pendingAnswerTasks.delete(taskKey);
    }
  });
  return task;
}

function startRemoteAnswerWork(answerContext) {
  const peerTask = startPeerStatsWork(answerContext);
  const persistenceTask = startAnswerPersistence(answerContext);

  if (
    answerContext.isLast &&
    !answerContext.isOnboarding &&
    !['cme', 'deep_link'].includes(answerContext.quizType)
  ) {
    void prepareSummary(answerContext.quizRunId);
  }

  void Promise.all([peerTask, persistenceTask])
    .then(([peerResult, persistenceResult]) => {
      emitQuizAnalytics('quiz_answer_async_result', {
        quiz_type: answerContext.quizType,
        quiz_position: answerContext.questionIndex + 1,
        is_last_question: answerContext.isLast,
        peer_stats_outcome: peerResult.outcome,
        peer_stats_duration_ms: peerResult.durationMs,
        persistence_outcome: persistenceResult.outcome,
        persistence_duration_ms: persistenceResult.durationMs,
        platform: getQuizPlatform()
      });
    })
    .catch((error) => {
      console.warn("Unable to emit quiz answer telemetry:", error);
    });
}

// Add click event listeners to quiz options

function addOptionListeners() {
  document.querySelectorAll('.option-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        // If the scroll is not yet locked, lock it now.
          // This happens on the first answer click of the quiz.
          if (!document.body.classList.contains('scroll-lock')) {
            lockBodyScroll();
          }
          const card = this.closest('.card');
    if (!card || card.dataset.answerCommitted === "true" || card.classList.contains('answered')) return;
    card.dataset.answerCommitted = "true";
    card.classList.add('answered');
    card.dataset.correctPeerHapticEligible = "true";

    const questionSlide = card.closest('.swiper-slide');
    const qId = questionSlide.dataset.id;
    if (!answeredIds.includes(qId)) { answeredIds.push(qId); }
    const correct = questionSlide.dataset.correct;
    const explanation = questionSlide.dataset.explanation;
    const category = questionSlide.dataset.category;
    const options = Array.from(card.querySelectorAll('.option-btn'));
    const selected = this.getAttribute('data-option');
    const isCorrect = (selected === correct);
    const questionIndex = Number.parseInt(questionSlide.dataset.questionIndex, 10);
    const quizRunId = Number.parseInt(questionSlide.dataset.quizRunId, 10);
    const answerSlide = questionSlide.nextElementSibling;
    const timeSpent = Date.now() - questionStartTime;
    const answerContext = Object.freeze({
      quizRunId,
      questionIndex,
      qId,
      selected,
      correct,
      isCorrect,
      explanation,
      category,
      quizType: currentQuizType,
      isOnboarding: Boolean(window.isOnboardingQuiz),
      isLast: questionIndex === totalQuestions - 1,
      isCmeEligible: questionSlide.dataset.cmeEligible === "true",
      timeSpent,
      card,
      questionSlide,
      answerSlide,
      options
    });

    invokeHaptic(playTap);

    emitQuizAnalytics('question_answered', {
      question_category: category,
      is_correct: isCorrect,
      time_to_answer_seconds: Math.round(timeSpent / 1000),
      is_cme_eligible: questionSlide.dataset.cmeEligible === "true",
      is_bookmarked: questionSlide.dataset.bookmarked === "true",
      question_source: currentQuizType === 'cme' ? 'cme_module' : 'regular_quiz',
      quiz_position: questionIndex + 1,
      user_tier: window.authState?.accessTier || 'free_guest'
    }, { defer: true });

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
          if (answerSlide) {

              // --- Check if it's the last question ---
              if (answerContext.isLast) {
                  // --- THIS IS THE LAST QUESTION ---
                  console.log(`Quiz complete. Type: ${currentQuizType}, Onboarding: ${window.isOnboardingQuiz}`);

                  // --- Process the final answer FIRST ---
                  currentQuestion++; // Increment counter first
                  if (isCorrect) { score++; }
                  updateProgress(); // Update progress bar/text one last time

                  // ADD THIS: Track quiz completion
                  const finalAccuracy = Math.round((score / totalQuestions) * 100);
                  const totalTimeSpent = Math.round((Date.now() - quizStartedAt) / 1000);

                  emitQuizAnalytics('quiz_complete', {
                    quiz_type: currentQuizType,
                    category: category,
                    score: score,
                    total_questions: totalQuestions,
                    accuracy_percentage: finalAccuracy,
                    time_spent_seconds: totalTimeSpent,
                    user_tier: window.authState?.accessTier || 'free_guest'
                  }, { defer: true });

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
                                            prepareOnboardingSummary(quizRunId);
                                            const summaryButton = document.createElement('button');
                                            summaryButton.id = "viewOnboardingSummaryBtn"; // Use a new ID
                                            summaryButton.className = "start-quiz-btn";
                                            summaryButton.textContent = "Continue";
                                            summaryButton.style.display = "block";
                                            summaryButton.style.margin = "20px auto";
                                            bottomActions.appendChild(summaryButton);
                                            summaryButton.addEventListener('click', showOnboardingSummary);
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
                                            if (typeof window.clearPendingDeepLink === 'function') {
                                                window.clearPendingDeepLink({ reroute: true });
                                            } else {
                                                window.pendingDeepLinkQuestionId = null;
                                                window.isDeepLinkQuizActive = false;
                                            }
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
                                           setLocalSummaryData(quizRunId);
                                           const summaryButton = document.createElement('button');
                                           summaryButton.id = "viewSummaryBtn";
                                           summaryButton.className = "start-quiz-btn";
                                           summaryButton.textContent = "View Quiz Summary";
                                           summaryButton.style.display = "block";
                                           summaryButton.style.margin = "20px auto";
                                           bottomActions.appendChild(summaryButton);
                                           summaryButton.addEventListener('click', showSummary);
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
                                                      if (window.mySwiper) {
                                                          window.mySwiper.allowTouchMove = false;
                                                      }
                                                  }, { passive: true });
                                                  
                                                  // Re-enable when touch ends outside the content area
                                                  document.addEventListener('touchend', function(e) {
                                                      if (!answerContent.contains(e.target)) {
                                                          if (window.mySwiper) {
                                                              window.mySwiper.allowTouchMove = originalTouchMove;
                                                          }
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

            // --- End of logic for NON-last questions ---
              } // End of if/else for last question check

          } // End of if(answerSlide)

          const explanationReady = Boolean(
            answerSlide?.querySelector('.answer')?.textContent?.trim()
          );
          if (window.mySwiper && explanationReady) {
            window.mySwiper.allowSlideNext = true;
            console.log("Unlocked swiping after the explanation rendered");
          }

          startRemoteAnswerWork(answerContext);

      }); // End of click listener
  }); // End of forEach
} // End of addOptionListeners function

const QUIZ_LEVEL_THRESHOLDS = [
  0, 30, 75, 150, 250, 400, 600, 850, 1150, 1500, 2000, 2750, 3750, 5000, 6500
];

function getPerformanceMessage(accuracy) {
  if (accuracy >= 90) return "Excellent work! You're mastering this material!";
  if (accuracy >= 70) return "Great job! Keep up the good work!";
  if (accuracy >= 50) return "Good effort! Keep practicing to improve!";
  return "Keep practicing! You'll improve with time.";
}

function getLevelForXP(xp) {
  let level = 1;
  for (let index = 1; index < QUIZ_LEVEL_THRESHOLDS.length; index += 1) {
    if (xp < QUIZ_LEVEL_THRESHOLDS[index]) break;
    level = index + 1;
  }
  return level;
}

function getLevelProgressForXP(xp, level) {
  const currentLevelXP = QUIZ_LEVEL_THRESHOLDS[level - 1] || 0;
  const nextLevelXP = level < QUIZ_LEVEL_THRESHOLDS.length
    ? QUIZ_LEVEL_THRESHOLDS[level]
    : null;
  if (nextLevelXP === null) return 100;
  return Math.min(
    100,
    Math.max(0, Math.floor(((xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100))
  );
}

function setLocalSummaryData(quizRunId = activeQuizRunId) {
  const accuracy = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
  const estimatedSessionXP = score * 3 + (totalQuestions - score);
  const estimatedCurrentXP = sessionStartXP + estimatedSessionXP;
  const estimatedLevel = getLevelForXP(estimatedCurrentXP);
  window.summaryData = {
    quizRunId,
    sessionXP: estimatedSessionXP,
    currentLevel: estimatedLevel,
    currentXP: estimatedCurrentXP,
    levelProgress: getLevelProgressForXP(estimatedCurrentXP, estimatedLevel),
    accuracy,
    performanceMessage: getPerformanceMessage(accuracy)
  };
  return window.summaryData;
}

function updateVisibleSummary(summaryData) {
  const summarySlide = document.querySelector(
    `.swiper-slide[data-summary-run-id="${summaryData.quizRunId}"]`
  );
  if (!summarySlide) return;

  const xpValue = summarySlide.querySelector('.xp-value');
  const xpBar = summarySlide.querySelector('.xp-bar');
  const xpTotal = summarySlide.querySelector('.xp-total');
  if (xpValue) xpValue.textContent = `+${summaryData.sessionXP} XP`;
  if (xpBar) xpBar.style.width = `${summaryData.levelProgress}%`;
  if (xpTotal) {
    xpTotal.textContent = `Total: ${summaryData.currentXP} XP (Level ${summaryData.currentLevel})`;
  }
}

// Refresh summary data without blocking the final explanation or summary button.
async function prepareSummary(quizRunId = activeQuizRunId) {
  console.log("Refreshing summary in the background...");
  const localSummary = window.summaryData?.quizRunId === quizRunId
    ? window.summaryData
    : setLocalSummaryData(quizRunId);

  const pendingForRun = Array.from(pendingAnswerTasks.entries())
    .filter(([taskKey]) => taskKey.startsWith(`${quizRunId}:`))
    .map(([, task]) => task);
  if (pendingForRun.length > 0) {
    await Promise.allSettled(pendingForRun);
  }
  if (activeQuizRunId !== quizRunId) return localSummary;
  
  try {
    // Get the latest user data to calculate XP earned
    let sessionXP = localSummary.sessionXP;
    let currentLevel = localSummary.currentLevel;
    let currentXP = localSummary.currentXP;
    let levelProgress = localSummary.levelProgress;
    
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

          levelProgress = getLevelProgressForXP(currentXP, currentLevel);
        }
      }
    }

    if (activeQuizRunId !== quizRunId) return localSummary;
      
    // Calculate accuracy percentage
    const accuracy = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
    
    // Store summary data
    window.summaryData = {
      quizRunId,
      sessionXP,
      currentLevel,
      currentXP,
      levelProgress,
      accuracy,
      performanceMessage: getPerformanceMessage(accuracy)
    };
    updateVisibleSummary(window.summaryData);
    return window.summaryData;
  } catch (error) {
    console.error("Error refreshing summary:", error);
    return localSummary;
  }
}

// Show summary when button is clicked
function showSummary() {
  console.log("Showing summary...");
  
  const data = window.summaryData?.quizRunId === activeQuizRunId
    ? window.summaryData
    : setLocalSummaryData(activeQuizRunId);

  const hasBoardAccess = hasBoardReviewAccessForCurrentUser();

  console.log(`Summary board access: ${hasBoardAccess}`);
  
  // Create and add the summary slide
  const summarySlide = document.createElement("div");
  summarySlide.className = "swiper-slide";
  summarySlide.dataset.summaryRunId = String(activeQuizRunId);

  // Conditionally create the leaderboard button HTML
  let leaderboardButtonHtml = '';
  if (hasBoardAccess) {
    leaderboardButtonHtml = `<button id="leaderboardButton" class="start-quiz-btn">View Leaderboard</button>`;
  } else {
    console.log("User lacks board access, hiding View Leaderboard button on summary.");
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
  if (hasBoardAccess) {
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

// Call the updated function and wait for it to return the correct interval
let finalInterval = 1; // Default to 1 in case of an error
if (typeof updateSpacedRepetitionData === 'function') {
    try {
        // The function now returns the correct interval (custom or default)
        finalInterval = await updateSpacedRepetitionData(questionId, isCorrect, difficulty);
    } catch (e) {
        console.error("Error calling updateSpacedRepetitionData:", e);
    }
} else {
    console.error("updateSpacedRepetitionData function not found");
}

// Show feedback to the user using the CORRECT interval
const difficultyButtonsDiv = this.closest('.difficulty-buttons');
if (difficultyButtonsDiv) {
    const existingFeedback = difficultyButtonsDiv.querySelector('.review-scheduled');
    if (existingFeedback) existingFeedback.remove();

    const feedbackEl = document.createElement('p');
    feedbackEl.className = 'review-scheduled';
    // Use the 'finalInterval' variable that was returned from our updated function
    feedbackEl.textContent = `Review scheduled in ${finalInterval} ${finalInterval === 1 ? 'day' : 'days'}`;
    difficultyButtonsDiv.appendChild(feedbackEl);
}

            // Disable all buttons after selection
            currentButtons.forEach(b => b.disabled = true);
        });
    });
}

// Prepares the data for the onboarding summary screen
function prepareOnboardingSummary(quizRunId = activeQuizRunId) {
  console.log("Preparing onboarding summary...");

  const accuracy = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
  window.onboardingSummaryData = {
    quizRunId,
    accuracy,
    score,
    totalQuestions
  };
  return window.onboardingSummaryData;
}

// Creates and displays the onboarding summary slide
function showOnboardingSummary() {
  console.log("Showing onboarding summary...");

  // Use the data prepared in the previous step
  const data = window.onboardingSummaryData?.quizRunId === activeQuizRunId
    ? window.onboardingSummaryData
    : {
    quizRunId: activeQuizRunId,
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
      if (typeof window.handleOnboardingSummaryContinue === 'function') {
        window.handleOnboardingSummaryContinue();
      } else if (typeof window.startOnboardingCarousel === 'function') {
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
  fetchOnboardingQuestionPool,
  prefetchOnboardingQuestionPool,
  fetchQuizUserContext,
  updateBookmarkIcon, // Export if called from elsewhere
  addOptionListeners, // Likely internal, probably don't need to export
  prepareSummary, // Likely internal
  showSummary // Likely internal
};

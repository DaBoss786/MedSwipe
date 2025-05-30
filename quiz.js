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

// Fetch questions from CSV
async function fetchQuestionBank() {
  return new Promise((resolve, reject) => {
    Papa.parse(csvUrl, {
      download: true,
      header: true,
      complete: function(results) {
        resolve(results.data);
      },
      error: function(error) {
        reject(error);
      }
    });
  });
}

// Load questions according to quiz options
async function loadQuestions(options = {}) {
  console.log("Loading questions with options:", options);
  window.isOnboardingQuiz = options.isOnboarding || false;
  Papa.parse(csvUrl, {
    download: true,
    header: true,
    complete: async function(results) {
      console.log("Questions loaded:", results.data.length);
      allQuestions = results.data;
      const persistentAnsweredIds = await fetchPersistentAnsweredIds();
      answeredIds = persistentAnsweredIds;

      // Check if spaced repetition mode is enabled
      if (options.spacedRepetition) {
        await loadQuestionsWithSpacedRepetition(options, allQuestions, answeredIds);
        return;
      }
      
      // Start with all questions
      let filtered = allQuestions;
      
      // Filter by bookmarks if in bookmarks mode
      if (options.bookmarksOnly) {
        const bookmarks = await getBookmarks();
        console.log("Filtering for bookmarks:", bookmarks);
        if (bookmarks.length === 0) {
          alert("You don't have any bookmarks yet. Star questions you want to review later!");
          document.getElementById("mainOptions").style.display = "flex";
          return;
        }
        filtered = filtered.filter(q => bookmarks.includes(q["Question"].trim()));
      } 
      // Otherwise apply normal filters
      else {
        if (!options.includeAnswered) {
          filtered = filtered.filter(q => !answeredIds.includes(q["Question"].trim()));
        }
        if (options.type === 'custom' && options.category) {
          filtered = filtered.filter(q => q["Category"] && q["Category"].trim() === options.category);
        }
      }
      
      // If we end up with no questions after filtering
      if (filtered.length === 0) {
        if (options.bookmarksOnly) {
          alert("No bookmarked questions found. Star questions you want to review later!");
        } else if (options.type === 'custom' && options.category) {
          alert("No unanswered questions left in this category. Try including answered questions or choosing a different category.");
        } else {
          alert("No unanswered questions left. Try including answered questions for more practice!");
        }
        document.getElementById("mainOptions").style.display = "flex";
        return;
      }
      
      // Shuffle and slice to limit question count
      let selectedQuestions = shuffleArray(filtered);
      if (options.num && options.num < selectedQuestions.length) {
        selectedQuestions = selectedQuestions.slice(0, options.num);
      }
      
      console.log("Selected questions count:", selectedQuestions.length);
      initializeQuiz(selectedQuestions);
    },
    error: function(error) {
      console.error("Error parsing CSV:", error);
      alert("Error loading questions. Please try again later.");
    }
  });
}

// Add this function to quiz.js
async function loadQuestionsWithSpacedRepetition(options, allQuestions, answeredIds) {
  try {
    // Check if the user is anonymous/guest
    if (window.auth && window.auth.currentUser && window.auth.currentUser.isAnonymous) {
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
async function initializeQuiz(questions) {
  // Get starting XP before the quiz begins
  try {
    const isOnboardingQuiz = window.isOnboardingQuiz || false;
    console.log("Initializing quiz, isOnboarding:", isOnboardingQuiz);
    if (window.auth && window.auth.currentUser) {
      const uid = window.auth.currentUser.uid;
      const userDocRef = window.doc(window.db, 'users', uid);
      const userDocSnap = await window.getDoc(userDocRef);
      
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
    
    questionSlide.innerHTML = `
      <div class="card">
        <div class="question">${question["Question"]}</div>
        ${question["Image URL"] && question["Image URL"].trim() !== ""
          ? `<img src="${question["Image URL"].trim()}" class="question-image">`
          : "" }
        <div class="options">
          ${question["Option A"] && question["Option A"].trim() !== ""
            ? `<button class="option-btn" data-option="A">A. ${question["Option A"]}</button>`
            : "" }
          ${question["Option B"] && question["Option B"].trim() !== ""
            ? `<button class="option-btn" data-option="B">B. ${question["Option B"]}</button>`
            : "" }
          ${question["Option C"] && question["Option C"].trim() !== ""
            ? `<button class="option-btn" data-option="C">C. ${question["Option C"]}</button>`
            : "" }
          ${question["Option D"] && question["Option D"].trim() !== ""
            ? `<button class="option-btn" data-option="D">D. ${question["Option D"]}</button>`
            : "" }
          ${question["Option E"] && question["Option E"] !== ""
            ? `<button class="option-btn" data-option="E">E. ${question["Option E"]}</button>`
            : "" }
        </div>
        <div class="swipe-hint" style="display:none;">Swipe up for explanation</div>
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

  window.mySwiper = new Swiper('.swiper', {
    direction: 'vertical',
    loop: false,
    mousewheel: true,
    touchReleaseOnEdges: true
  });

  window.mySwiper.on('slideChangeTransitionEnd', function() {
    const activeIndex = window.mySwiper.activeIndex;
    const previousIndex = window.mySwiper.previousIndex;
    if (activeIndex % 2 === 0) {
      questionStartTime = Date.now();
      console.log("New question slide. questionStartTime updated to:", questionStartTime);
      updateBookmarkIcon();
    }
    if (activeIndex % 2 === 1 && activeIndex > previousIndex) {
      const prevSlide = window.mySwiper.slides[activeIndex - 1];
      const card = prevSlide.querySelector('.card');
      if (!card.classList.contains('answered')) {
        window.mySwiper.slideNext();
      }
    }
  });

  addOptionListeners();
  
  // Set the initial bookmark icon state for the first question
  updateBookmarkIcon();

  document.querySelector(".swiper").style.display = "block";
  document.getElementById("bottomToolbar").style.display = "flex";
  document.getElementById("mainOptions").style.display = "none";
  document.getElementById("performanceView").style.display = "none";
  document.getElementById("iconBar").style.display = "flex";
  document.getElementById("aboutView").style.display = "none";
  document.getElementById("faqView").style.display = "none";
  ensureEventListenersAttached(); // Add this line
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
function addOptionListeners() {
  document.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const card = this.closest('.card');
      if (card.classList.contains('answered')) return;
      card.classList.add('answered');
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
      if (window.analytics && window.logEvent) {
        window.logEvent(window.analytics, 'question_answered', { questionId: qId, isCorrect });
      }
      options.forEach(option => {
        option.disabled = true;
        if (option.getAttribute('data-option') === correct) {
          option.classList.add('correct');
        }
      });
      if (!isCorrect) { this.classList.add('incorrect'); }
      const hint = card.querySelector('.swipe-hint');
      if (hint) { hint.style.display = 'block'; }
      const answerSlide = questionSlide.nextElementSibling;
      if (answerSlide) {
        // If this is the last question, add a "View Summary" button directly to the explanation
        if (currentQuestion + 1 === totalQuestions) {
          // Check if this is the onboarding quiz (window flag set in loadQuestions)
          if (window.isOnboardingQuiz) {
            answerSlide.querySelector('.card').innerHTML = `
              <div class="answer">
                <strong>You got it ${isCorrect ? "Correct" : "Incorrect"}</strong><br>
                Correct Answer: ${correct}<br>
                ${explanation}
              </div>
              <div class="difficulty-buttons">
                <p class="difficulty-prompt">How difficult was this question?</p>
                <div class="difficulty-btn-container">
                  <button class="difficulty-btn easy-btn" data-difficulty="easy">Easy</button>
                  <button class="difficulty-btn medium-btn" data-difficulty="medium">Medium</button>
                  <button class="difficulty-btn hard-btn" data-difficulty="hard">Hard</button>
                </div>
              </div>
              <button id="viewSummaryBtn" style="display:block; margin:20px auto; padding:10px 20px; background-color:#0056b3; color:white; border:none; border-radius:5px; cursor:pointer;">
                Continue
              </button>
            `;
          } else {
            // Regular quiz with summary button
            answerSlide.querySelector('.card').innerHTML = `
              <div class="answer">
                <strong>You got it ${isCorrect ? "Correct" : "Incorrect"}</strong><br>
                Correct Answer: ${correct}<br>
                ${explanation}
              </div>
              <div class="difficulty-buttons">
                <p class="difficulty-prompt">How difficult was this question?</p>
                <div class="difficulty-btn-container">
                  <button class="difficulty-btn easy-btn" data-difficulty="easy">Easy</button>
                  <button class="difficulty-btn medium-btn" data-difficulty="medium">Medium</button>
                  <button class="difficulty-btn hard-btn" data-difficulty="hard">Hard</button>
                </div>
              </div>
              <button id="viewSummaryBtn" style="display:block; margin:20px auto; padding:10px 20px; background-color:#0056b3; color:white; border:none; border-radius:5px; cursor:pointer;">
                Loading Summary...
              </button>
            `;
          }
          
          // Add click handlers for difficulty buttons
          const difficultyButtons = answerSlide.querySelectorAll('.difficulty-btn');
          difficultyButtons.forEach(btn => {
            btn.addEventListener('click', async function() {
              // Remove selected class from all buttons
              difficultyButtons.forEach(b => b.classList.remove('selected'));
              // Add selected class to clicked button
              this.classList.add('selected');
              
              const difficulty = this.getAttribute('data-difficulty');
              const questionId = questionSlide.dataset.id;
              
              // Calculate next review date based on difficulty and correctness
              let nextReviewInterval = 1; // Default 1 day
              
              if (isCorrect) {
                if (difficulty === 'easy') {
                  nextReviewInterval = 7; // 7 days
                } else if (difficulty === 'medium') {
                  nextReviewInterval = 3; // 3 days
                } else if (difficulty === 'hard') {
                  nextReviewInterval = 1; // 1 day
                }
              } else {
                // If answered incorrectly, review it soon regardless of rating
                nextReviewInterval = 1; // 1 day
              }
              
              // Store the spaced repetition data
              await updateSpacedRepetitionData(questionId, isCorrect, difficulty, nextReviewInterval);
              
              // Show feedback to the user
              const feedbackEl = document.createElement('p');
              feedbackEl.className = 'review-scheduled';
              feedbackEl.textContent = `Review scheduled in ${nextReviewInterval} ${nextReviewInterval === 1 ? 'day' : 'days'}`;
              this.closest('.difficulty-buttons').appendChild(feedbackEl);
              
              // Disable all buttons after selection
              difficultyButtons.forEach(b => b.disabled = true);
            });
          });
          
          // Process the answer
          currentQuestion++;
          if (isCorrect) { score++; }
          updateProgress();
          
          // Record the answer in the database
          await recordAnswer(qId, category, isCorrect, timeSpent);
          await updateQuestionStats(qId, isCorrect);
          
          // For onboarding quiz, prepare to show registration benefits
          if (window.isOnboardingQuiz) {
            const viewSummaryBtn = document.getElementById('viewSummaryBtn');
            if (viewSummaryBtn) {
              viewSummaryBtn.textContent = "Continue";
              viewSummaryBtn.addEventListener('click', function() {
                // Hide the quiz
                document.querySelector(".swiper").style.display = "none";
                document.getElementById("bottomToolbar").style.display = "none";
                document.getElementById("iconBar").style.display = "none";
                
                // Show the registration benefits modal
                if (typeof window.showRegistrationBenefitsModal === 'function') {
                  window.showRegistrationBenefitsModal();
                } else {
                  // Fallback if function isn't available
                  document.getElementById("mainOptions").style.display = "flex";
                }
              });
            }
          } else {
            // Prepare regular summary for normal quizzes
            prepareSummary();
          }
        } else {
          // Regular question (not the last one)
          answerSlide.querySelector('.card').innerHTML = `
            <div class="answer">
              <strong>You got it ${isCorrect ? "Correct" : "Incorrect"}</strong><br>
              Correct Answer: ${correct}<br>
              ${explanation}
            </div>
            <div class="difficulty-buttons">
              <p class="difficulty-prompt">How difficult was this question?</p>
              <div class="difficulty-btn-container">
                <button class="difficulty-btn easy-btn" data-difficulty="easy">Easy</button>
                <button class="difficulty-btn medium-btn" data-difficulty="medium">Medium</button>
                <button class="difficulty-btn hard-btn" data-difficulty="hard">Hard</button>
              </div>
            </div>
            <p class="swipe-next-hint">Swipe up for next question</p>
          `;
          
          // Add click handlers for difficulty buttons
          const difficultyButtons = answerSlide.querySelectorAll('.difficulty-btn');
          difficultyButtons.forEach(btn => {
            btn.addEventListener('click', async function() {
              // Remove selected class from all buttons
              difficultyButtons.forEach(b => b.classList.remove('selected'));
              // Add selected class to clicked button
              this.classList.add('selected');
              
              const difficulty = this.getAttribute('data-difficulty');
              const questionId = questionSlide.dataset.id;
              
              // Calculate next review date based on difficulty and correctness
              let nextReviewInterval = 1; // Default 1 day
              
              if (isCorrect) {
                if (difficulty === 'easy') {
                  nextReviewInterval = 7; // 7 days
                } else if (difficulty === 'medium') {
                  nextReviewInterval = 3; // 3 days
                } else if (difficulty === 'hard') {
                  nextReviewInterval = 1; // 1 day
                }
              } else {
                // If answered incorrectly, review it soon regardless of rating
                nextReviewInterval = 1; // 1 day
              }
              
              // Store the spaced repetition data
              await updateSpacedRepetitionData(questionId, isCorrect, difficulty, nextReviewInterval);
              
              // Show feedback to the user
              const feedbackEl = document.createElement('p');
              feedbackEl.className = 'review-scheduled';
              feedbackEl.textContent = `Review scheduled in ${nextReviewInterval} ${nextReviewInterval === 1 ? 'day' : 'days'}`;
              this.closest('.difficulty-buttons').appendChild(feedbackEl);
              
              // Disable all buttons after selection
              difficultyButtons.forEach(b => b.disabled = true);
            });
          });
          
          currentQuestion++;
          if (isCorrect) { score++; }
          updateProgress();
          await recordAnswer(qId, category, isCorrect, timeSpent);
          await updateQuestionStats(qId, isCorrect);
        }
      }
    });
  });
}

// Prepare summary data and update the button
async function prepareSummary() {
  console.log("Preparing summary...");
  
  try {
    // Get the latest user data to calculate XP earned
    let sessionXP = 0;
    let currentLevel = 1;
    let currentXP = 0;
    let levelProgress = 0; // Added for level progress calculation
    
    if (window.auth && window.auth.currentUser) {
      const uid = window.auth.currentUser.uid;
      const userDocRef = window.doc(window.db, 'users', uid);
      const userDocSnap = await window.getDoc(userDocRef);
      
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
    sessionXP: score * 3 + (totalQuestions - score), // Fallback calculation
    currentLevel: 1,
    currentXP: 0,
    levelProgress: 0, // Default to 0 if not calculated
    accuracy: totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0,
    performanceMessage: "Quiz complete!"
  };
  
  // Create and add the summary slide
  const summarySlide = document.createElement("div");
  summarySlide.className = "swiper-slide";
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
          <!-- Use the levelProgress value for the XP bar width instead of sessionXP -->
          <div class="xp-bar" style="width: ${data.levelProgress}%;"></div>
        </div>
        <div class="xp-total">Total: ${data.currentXP} XP (Level ${data.currentLevel})</div>
      </div>
      
      <div class="summary-buttons">
        <button id="startNewQuizButton" class="start-quiz-btn">Start New Quiz</button>
        <button id="leaderboardButton" class="start-quiz-btn">View Leaderboard</button>
      </div>
    </div>
  `;
  
  // Add the slide to the DOM
  document.getElementById("quizSlides").appendChild(summarySlide);
  
  // Update Swiper to recognize the new slide
  window.mySwiper.update();
  
  // Navigate to the summary slide
  window.mySwiper.slideTo(window.mySwiper.slides.length - 1);
  
  // Add event listeners to the buttons
  document.getElementById("startNewQuizButton").addEventListener("click", function() {
    window.filterMode = "all";
    document.getElementById("aboutView").style.display = "none";
    document.getElementById("faqView").style.display = "none";
    document.querySelector(".swiper").style.display = "none";
    document.getElementById("bottomToolbar").style.display = "none";
    document.getElementById("iconBar").style.display = "none";
    document.getElementById("performanceView").style.display = "none";
    document.getElementById("leaderboardView").style.display = "none";
    document.getElementById("mainOptions").style.display = "flex";
    ensureEventListenersAttached(); // Add this line
  });
  
  document.getElementById("leaderboardButton").addEventListener("click", function() {
    document.getElementById("aboutView").style.display = "none";
    document.getElementById("faqView").style.display = "none";
    document.querySelector(".swiper").style.display = "none";
    document.getElementById("bottomToolbar").style.display = "none";
    document.getElementById("iconBar").style.display = "none";
    document.getElementById("performanceView").style.display = "none";
    document.getElementById("faqView").style.display = "none";
    document.getElementById("mainOptions").style.display = "none";
    showLeaderboard();
    ensureEventListenersAttached(); // Add this line
  });
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

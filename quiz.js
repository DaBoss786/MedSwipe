// Quiz management variables
let allQuestions = [];
let selectedCategory = "";
let answeredIds = [];
let currentQuestion = 0;
let totalQuestions = 0;
let score = 0;
let currentFeedbackQuestionId = "";
let currentFeedbackQuestionText = "";

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
  Papa.parse(csvUrl, {
    download: true,
    header: true,
    complete: async function(results) {
      console.log("Questions loaded:", results.data.length);
      allQuestions = results.data;
      const persistentAnsweredIds = await fetchPersistentAnsweredIds();
      answeredIds = persistentAnsweredIds;
      
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

// Initialize the quiz with the selected questions
async function initializeQuiz(questions) {
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
        answerSlide.querySelector('.card').innerHTML = `
          <div class="answer">
            <strong>You got it ${isCorrect ? "Correct" : "Incorrect"}</strong><br>
            Correct Answer: ${correct}<br>
            ${explanation}
          </div>
          <p class="swipe-next-hint">Swipe up for next question</p>
        `;
      }
      currentQuestion++;
      if (isCorrect) { score++; }
      updateProgress();
      await recordAnswer(qId, category, isCorrect, timeSpent);
      await updateQuestionStats(qId, isCorrect);
      if (currentQuestion === totalQuestions) {
        setTimeout(() => {
          const summarySlide = document.createElement("div");
          summarySlide.className = "swiper-slide";
          summarySlide.innerHTML = `
            <div class="card">
              <div class="answer">
                <strong>Final Score: ${score} out of ${totalQuestions}</strong><br>
                ${score/totalQuestions >= 0.8 ? "Great job!" : "Keep practicing!"}
              </div>
              <button id="startNewQuizButton" class="start-quiz-btn">Start New Quiz</button>
              <button id="leaderboardButton" class="start-quiz-btn">Leaderboards</button>
            </div>
          `;
          document.getElementById("quizSlides").appendChild(summarySlide);
          window.mySwiper.update();
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
          });
        }, 1000);
      }
    });
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
  updateUserCompositeScore();
}

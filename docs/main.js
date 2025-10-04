// app.js - TOP OF FILE
import { auth, db, doc, getDoc, runTransaction, serverTimestamp, addDoc, collection, getDocs } from './firebase-config.js'; // Adjust path if needed

// Global helper functions
window.shuffleArray = function(array) {
  return array.sort(() => Math.random() - 0.5);
};

window.fetchPersistentAnsweredIds = async function() {
  const uid = auth.currentUser.uid;
  const userDocRef = doc(db, 'users', uid);
  const userDocSnap = await getDoc(userDocRef);
  if (userDocSnap.exists()){
    let data = userDocSnap.data();
    return Object.keys(data.answeredQuestions || {});
  }
  return [];
};

window.fetchQuestionBank = async function() {
  return new Promise((resolve, reject) => {
    Papa.parse(window.csvUrl, {
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
};

document.addEventListener('DOMContentLoaded', function() {
  let questionStartTime = 0;
  let sessionStartTime = Date.now();

  // Function to close the side menu
  function closeSideMenu() {
    document.getElementById("sideMenu").classList.remove("open");
    document.getElementById("menuOverlay").classList.remove("show");
  }
  window.closeSideMenu = closeSideMenu; // Attach to window

  // Helper to get current question id from the active slide.
  function getCurrentQuestionId() {
    if (!window.mySwiper) return null;
    let activeIndex = window.mySwiper.activeIndex;
    let currentSlide;
    if (activeIndex % 2 !== 0) {
      currentSlide = window.mySwiper.slides[activeIndex - 1];
    } else {
      currentSlide = window.mySwiper.slides[activeIndex];
    }
    return currentSlide && currentSlide.dataset ? currentSlide.dataset.id : null;
  }

  // Reset favorite icon for new questions.
  async function updateFavoriteIcon() {
    let favoriteButton = document.getElementById("favoriteButton");
    favoriteButton.innerText = "☆";
    favoriteButton.style.color = "";
  }

  // Attach event listener for favorite button.
  document.getElementById("favoriteButton").addEventListener("click", async function() {
    let questionId = getCurrentQuestionId();
    if (!questionId) return;
    let bookmarks = await window.getBookmarks();
    if (!bookmarks.includes(questionId.trim())) {
      await window.toggleBookmark(questionId.trim());
      document.getElementById("favoriteButton").innerText = "★";
      document.getElementById("favoriteButton").style.color = "blue";
    }
  });

  // Global functions that must be available to other parts of the code.
  async function updateUserCompositeScore() {
    try {
      const uid = auth.currentUser.uid;
      const userDocRef = doc(db, 'users', uid);
      const userDocSnap = await getDoc(userDocRef);
      if (userDocSnap.exists()) {
        const data = userDocSnap.data();
        const totalAnswered = data.stats?.totalAnswered || 0;
        const totalCorrect = data.stats?.totalCorrect || 0;
        const accuracy = totalAnswered ? totalCorrect / totalAnswered : 0;
        const normTotal = Math.min(totalAnswered, 100) / 100;
        const longestStreak = (data.streaks && data.streaks.longestStreak) ? data.streaks.longestStreak : 0;
        const normStreak = Math.min(longestStreak, 30) / 30;
        const composite = Math.round(((accuracy * 0.5) + (normTotal * 0.3) + (normStreak * 0.2)) * 100);
        document.getElementById("scoreCircle").textContent = composite;
      }
    } catch (error) {
      console.error("Error updating user composite score:", error);
    }
  }
  window.updateUserCompositeScore = updateUserCompositeScore;

  async function loadOverallData() {
    const currentUid = auth.currentUser.uid;
    const currentUsername = await getOrGenerateUsername();
    const querySnapshot = await getDocs(collection(db, 'users'));
    let leaderboardEntries = [];
    querySnapshot.forEach(docSnap => {
      const data = docSnap.data();
      if (data.stats) {
        const totalAnswered = data.stats.totalAnswered || 0;
        const totalCorrect = data.stats.totalCorrect || 0;
        const accuracy = totalAnswered ? totalCorrect / totalAnswered : 0;
        const normTotal = Math.min(totalAnswered, 100) / 100;
        const longestStreak = (data.streaks && data.streaks.longestStreak) ? data.streaks.longestStreak : 0;
        const normStreak = Math.min(longestStreak, 30) / 30;
        const compositeScore = Math.round(((accuracy * 0.5) + (normTotal * 0.3) + (normStreak * 0.2)) * 100);
        leaderboardEntries.push({
          uid: docSnap.id,
          username: data.username || "Anonymous",
          compositeScore: compositeScore
        });
      }
    });
    leaderboardEntries.sort((a, b) => b.compositeScore - a.compositeScore);
    let top10 = leaderboardEntries.slice(0,10);
    let currentUserEntry = leaderboardEntries.find(e => e.uid === currentUid);

    let html = `<h2>Leaderboard - Composite Score</h2>`;
    html += leaderboardTabsHTML("overall");
    html += `
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>Composite Score</th>
          </tr>
        </thead>
        <tbody>
    `;
    top10.forEach((entry, index) => {
      const bold = entry.uid === currentUid ? "style='font-weight:bold;'" : "";
      html += `
        <tr ${bold}>
          <td>${index + 1}</td>
          <td>${entry.username}</td>
          <td>${entry.compositeScore}</td>
        </tr>
      `;
    });
    html += `</tbody></table>`;
    
    if (!top10.some(e => e.uid === currentUid) && currentUserEntry) {
      html += `
        <h3>Your Ranking</h3>
        <table class="leaderboard-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Composite Score</th>
            </tr>
          </thead>
          <tbody>
            <tr style="font-weight:bold;">
              <td>${currentUsername}</td>
              <td>${currentUserEntry.compositeScore}</td>
            </tr>
          </tbody>
        </table>
      `;
    }
    html += `<button class="leaderboard-back-btn" id="leaderboardBack">Back</button>`;
    document.getElementById("leaderboardView").innerHTML = html;
    
    document.getElementById("overallTab").addEventListener("click", function(){ loadOverallData(); });
    document.getElementById("streaksTab").addEventListener("click", function(){ loadStreaksData(); });
    document.getElementById("answeredTab").addEventListener("click", function(){ loadTotalAnsweredData(); });
    
    document.getElementById("leaderboardBack").addEventListener("click", function(){
       document.getElementById("leaderboardView").style.display = "none";
       document.getElementById("mainOptions").style.display = "flex";
       document.getElementById("aboutView").style.display = "none";
    });
  }
  window.loadOverallData = loadOverallData;

  async function updateQuestionStats(questionId, isCorrect) {
    console.log("updateQuestionStats called for:", questionId, "isCorrect:", isCorrect);
    const questionStatsRef = doc(db, "questionStats", questionId);
    try {
      await runTransaction(db, async (transaction) => {
        const statsDoc = await transaction.get(questionStatsRef);
        let statsData = statsDoc.exists() ? statsDoc.data() : { totalAttempts: 0, correctAttempts: 0 };
        statsData.totalAttempts++;
        if (isCorrect) {
          statsData.correctAttempts++;
        }
        transaction.set(questionStatsRef, statsData, { merge: true });
      });
      console.log("Updated stats for question", questionId);
    } catch (error) {
      console.error("Error updating question stats:", error);
    }
  }
  window.updateQuestionStats = updateQuestionStats;

  // -------------------------
  // Other function declarations
  // -------------------------
  function leaderboardTabsHTML(activeTab) {
    return `
      <div id="leaderboardTabs">
        <button class="leaderboard-tab ${activeTab === 'overall' ? 'active' : ''}" id="overallTab">Composite Score</button>
        <button class="leaderboard-tab ${activeTab === 'streaks' ? 'active' : ''}" id="streaksTab">Streaks</button>
        <button class="leaderboard-tab ${activeTab === 'answered' ? 'active' : ''}" id="answeredTab">Total Answered</button>
      </div>
    `;
  }

  function showLeaderboard() {
    document.querySelector(".swiper").style.display = "none";
    document.getElementById("bottomToolbar").style.display = "none";
    document.getElementById("iconBar").style.display = "none";
    document.getElementById("performanceView").style.display = "none";
    document.getElementById("mainOptions").style.display = "none";
    document.getElementById("aboutView").style.display = "none";
    document.getElementById("faqView").style.display = "none";
    document.getElementById("leaderboardView").style.display = "block";
    loadOverallData();
  }
  window.showLeaderboard = showLeaderboard;

  function showAbout() {
    document.querySelector(".swiper").style.display = "none";
    document.getElementById("bottomToolbar").style.display = "none";
    document.getElementById("iconBar").style.display = "none";
    document.getElementById("performanceView").style.display = "none";
    document.getElementById("leaderboardView").style.display = "none";
    document.getElementById("mainOptions").style.display = "none";
    document.getElementById("faqView").style.display = "none";
    
    document.getElementById("aboutView").innerHTML = `
      <h2>About MedSwipe</h2>
      <p>MedSwipe is a dynamic, swipe-based quiz app designed specifically for medical professionals and learners. Our goal is to improve medical education by offering a casual, engaging alternative to traditional, regimented board review resources and question banks.</p>
      <p>Created by a board-certified ENT, MedSwipe brings a fresh, interactive approach to studying medicine. Instead of slogging through lengthy textbooks and overly structured review materials, MedSwipe lets you learn on the go—one swipe at a time. The app is designed to keep you engaged with bite‑sized questions, real‑time performance tracking, and interactive leaderboards that make board review feel less like a chore and more like a game.</p>
      <p>Whether you're a seasoned practitioner or just starting out in medicine, MedSwipe is here to support your learning journey in a way that fits seamlessly into your busy lifestyle.</p>
      <button id="aboutBack" class="start-quiz-btn">Back</button>
    `;
    document.getElementById("aboutView").style.display = "block";
    document.getElementById("aboutBack").addEventListener("click", function() {
      document.getElementById("aboutView").style.display = "none";
      document.getElementById("mainOptions").style.display = "flex";
    });
  }

  function showFAQ() {
    document.querySelector(".swiper").style.display = "none";
    document.getElementById("bottomToolbar").style.display = "none";
    document.getElementById("iconBar").style.display = "none";
    document.getElementById("performanceView").style.display = "none";
    document.getElementById("leaderboardView").style.display = "none";
    document.getElementById("aboutView").style.display = "none";
    document.getElementById("mainOptions").style.display = "none";
    
    document.getElementById("faqView").innerHTML = `
      <h2>FAQ</h2>
      <ul>
        <li>
          <strong>What is MedSwipe?</strong><br>
          MedSwipe is a dynamic, swipe‑based quiz app designed for ENT professionals and learners. It offers a more casual, engaging alternative to traditional, regimented board review resources.
        </li>
        <li>
          <strong>How Does MedSwipe Work?</strong><br>
          MedSwipe presents ENT questions in an intuitive, swipe‑based format. As you answer, your performance is tracked using a composite score that factors in:
          <ul>
            <li>Accuracy: The percentage of correct answers.</li>
            <li>Total Answered: Your overall volume of answered questions (normalized so that beyond a certain point, additional answers don’t disproportionately boost your score).</li>
            <li>Longest Streak: Your longest run of consecutive days answering questions.</li>
          </ul>
          This approach rewards both knowledge and sustained engagement.
        </li>
        <li>
          <strong>What Is the Composite Score?</strong><br>
          Your Composite Score is calculated using a weighted formula such as:<br>
          <em>Composite Score = (Accuracy × 0.5) + (Normalized Total Answered × 0.3) + (Normalized Longest Streak × 0.2)</em><br>
          Where:<br>
          Normalized Total Answered = min(total answered, 100) ÷ 100<br>
          Normalized Longest Streak = min(longest streak, 30) ÷ 30<br>
          This means that answering just a few questions perfectly won’t automatically rank you at the top; sustained engagement is key.
        </li>
        <li>
          <strong>Who Can Access the Leaderboards?</strong><br>
          In our MVP, all users have access to the leaderboards and performance metrics. In the future, if we move to a freemium model, basic leaderboard data will remain free while more detailed analytics may be reserved for registered or premium users.
        </li>
        <li>
          <strong>Is MedSwipe Free?</strong><br>
          For now, MedSwipe is completely free. Our aim is to build an engaged community before we roll out any premium features.
        </li>
        <li>
          <strong>How Do I Provide Feedback?</strong><br>
          Use the "Contact Us" button in the menu to let us know what you think or if you encounter any issues. Your input is crucial for our continued improvement.
        </li>
      </ul>
      <button id="faqBack" class="start-quiz-btn">Back</button>
    `;
    document.getElementById("faqView").style.display = "block";
    document.getElementById("faqBack").addEventListener("click", function() {
      document.getElementById("faqView").style.display = "none";
      document.getElementById("mainOptions").style.display = "flex";
    });
  }

  function showContactModal() {
    document.getElementById("contactModal").style.display = "flex";
  }

  async function displayPerformance() {
    console.log("displayPerformance function called");
    document.querySelector(".swiper").style.display = "none";
    document.getElementById("bottomToolbar").style.display = "none";
    document.getElementById("iconBar").style.display = "none";
    document.getElementById("mainOptions").style.display = "none";
    document.getElementById("leaderboardView").style.display = "none";
    document.getElementById("aboutView").style.display = "none";
    document.getElementById("faqView").style.display = "none";
    document.getElementById("performanceView").style.display = "block";
    
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);
    console.log("User document exists:", userDocSnap.exists());
    
    if (!userDocSnap.exists()) {
      document.getElementById("performanceView").innerHTML = `
        <h2>Performance</h2>
        <p>No performance data available yet.</p>
        <button id='backToMain'>Back</button>
      `;
      document.getElementById("backToMain").addEventListener("click", () => {
        document.getElementById("performanceView").style.display = "none";
        document.getElementById("mainOptions").style.display = "flex";
      });
      return;
    }
    const data = userDocSnap.data();
    const stats = data.stats || {};
    
    const totalAnswered = stats.totalAnswered || 0;
    
    let questionBank = [];
    try {
      questionBank = await window.fetchQuestionBank();
    } catch (error) {
      console.error("Error fetching question bank:", error);
    }
    const totalInBank = questionBank.length;
    console.log("Total in bank: ", totalInBank, "Total answered: ", totalAnswered);
    
    let remaining = totalInBank - totalAnswered;
    if (remaining < 0) { remaining = 0; }
    
    const totalCorrect = stats.totalCorrect || 0;
    const overallPercent = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
    
    let categoryBreakdown = "";
    if (stats.categories) {
      categoryBreakdown = Object.keys(stats.categories).map(cat => {
        const c = stats.categories[cat];
        const answered = c.answered;
        const correct = c.correct;
        const percent = answered > 0 ? Math.round((correct / answered) * 100) : 0;
        return `
          <div class="category-item">
            <strong>${cat}</strong>: ${correct}/${answered} (${percent}%)
            <div class="progress-bar-container">
              <div class="progress-bar" style="width: ${percent}%"></div>
            </div>
          </div>
        `;
      }).join("");
    } else {
      categoryBreakdown = "<p>No category data available.</p>";
    }
    
    document.getElementById("performanceView").innerHTML = `
      <h2 style="text-align:center; color:#0056b3;">Performance</h2>
      <div style="display:flex; flex-direction:column; align-items:center; margin-bottom:20px;">
        <canvas id="overallScoreChart" width="200" height="200"></canvas>
        <p style="font-size:1.2rem; color:#333; margin-top:10px;">
          Overall Score: ${overallPercent}%
        </p>
        <p style="font-size:1rem; color:#333;">
          Total Questions Remaining: ${remaining}
        </p>
      </div>
      <hr>
      <h3 style="text-align:center; color:#0056b3;">By Category</h3>
      ${categoryBreakdown}
      <button id="backToMain" style="margin-top:20px;">Back</button>
    `;
    
    const ctx = document.getElementById("overallScoreChart").getContext("2d");
    new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Correct", "Incorrect"],
        datasets: [{
          data: [
            totalCorrect,
            totalAnswered - totalCorrect
          ],
          backgroundColor: ["#28a745", "#dc3545"]
        }]
      },
      options: {
        responsive: false,
        cutout: "60%",
        plugins: {
          legend: {
            display: true
          }
        }
      }
    });
    
    document.getElementById("backToMain").addEventListener("click", function() {
      document.getElementById("performanceView").style.display = "none";
      document.getElementById("mainOptions").style.display = "flex";
    });
  }

  async function getOrGenerateUsername() {
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);
    let username;
    if (userDocSnap.exists() && userDocSnap.data().username) {
      username = userDocSnap.data().username;
    } else {
      username = generateRandomName();
      await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(userDocRef);
        let data = docSnap.exists() ? docSnap.data() : {};
        data.username = username;
        transaction.set(userDocRef, data, { merge: true });
      });
    }
    return username;
  }

  function generateRandomName() {
    const adjectives = ["Aural", "Otologic", "Laryngic", "Rhinal", "Acoustic", "Vocal"];
    const nouns = ["Cochlea", "Tympanum", "Glottis", "Sinus", "Auricle", "Eustachian"];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 9000) + 1000;
    return `${adj}${noun}${num}`;
  }

  // -------------------------
  // Global quiz variables and functions
  // -------------------------
  let allQuestions = [];
  let selectedCategory = "";
  let answeredIds = [];
  let currentQuestion = 0;
  let totalQuestions = 0;
  let score = 0;
  let currentFeedbackQuestionId = "";
  let currentFeedbackQuestionText = "";

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

  function loadQuestions(options = {}) {
    console.log("Loading questions with options:", options);
    Papa.parse(window.csvUrl, {
      download: true,
      header: true,
      complete: async function(results) {
        console.log("Questions loaded:", results.data.length);
        allQuestions = results.data;
        const persistentAnsweredIds = await window.fetchPersistentAnsweredIds();
        answeredIds = persistentAnsweredIds;
        let filtered = allQuestions;
        if (!options.includeAnswered) {
          filtered = filtered.filter(q => !answeredIds.includes(q["Question"].trim()));
        }
        if (options.type === 'custom' && options.category) {
          filtered = filtered.filter(q => q["Category"] && q["Category"].trim() === options.category);
        }
        let selectedQuestions = window.shuffleArray(filtered);
        if (options.num) {
          selectedQuestions = selectedQuestions.slice(0, options.num);
        }
        console.log("Selected questions count:", selectedQuestions.length);
        initializeQuiz(selectedQuestions);
      },
      error: function(error) {
        console.error("Error parsing CSV:", error);
      }
    });
  }

  function initializeQuiz(questions) {
    currentQuestion = 0;
    score = 0;
    totalQuestions = questions.length;
    answeredIds = [];
    updateProgress();
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

    window.mySwiper = new window.Swiper('.swiper', {
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
      }
      if (activeIndex % 2 === 1 && activeIndex > previousIndex) {
        const prevSlide = window.mySwiper.slides[activeIndex - 1];
        const card = prevSlide.querySelector('.card');
        if (!card.classList.contains('answered')) {
          window.mySwiper.slideNext();
        }
      }
      updateFavoriteIcon();
    });

    addOptionListeners();

    document.querySelector(".swiper").style.display = "block";
    document.getElementById("bottomToolbar").style.display = "flex";
    document.getElementById("mainOptions").style.display = "none";
    document.getElementById("performanceView").style.display = "none";
    document.getElementById("iconBar").style.display = "flex";
    document.getElementById("aboutView").style.display = "none";
    document.getElementById("faqView").style.display = "none";
  }

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
        if (analytics && window.logEvent) {
          window.logEvent(analytics, 'question_answered', { questionId: qId, isCorrect });
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

  // -------------------------
  // Event Listeners for landing page buttons and modals
  // -------------------------
  document.getElementById("customQuizBtn").addEventListener("click", function() {
    window.filterMode = "all";
    closeSideMenu();
    document.getElementById("aboutView").style.display = "none";
    document.getElementById("faqView").style.display = "none";
    document.getElementById("customQuizForm").style.display = "block";
  });

  document.getElementById("randomQuizBtn").addEventListener("click", function() {
    window.filterMode = "all";
    closeSideMenu();
    document.getElementById("aboutView").style.display = "none";
    document.getElementById("faqView").style.display = "none";
    document.getElementById("randomQuizForm").style.display = "block";
  });

  document.getElementById("startCustomQuiz").addEventListener("click", function() {
    let category = document.getElementById("categorySelect").value;
    let numQuestions = parseInt(document.getElementById("customNumQuestions").value) || 10;
    let includeAnswered = document.getElementById("includeAnsweredCheckbox").checked;
    document.getElementById("customQuizForm").style.display = "none";
    loadQuestions({
      type: 'custom',
      category: category,
      num: numQuestions,
      includeAnswered: includeAnswered
    });
  });

  document.getElementById("cancelCustomQuiz").addEventListener("click", function() {
    document.getElementById("customQuizForm").style.display = "none";
  });

  document.getElementById("startRandomQuiz").addEventListener("click", function() {
    let numQuestions = parseInt(document.getElementById("randomNumQuestions").value) || 10;
    let includeAnswered = document.getElementById("includeAnsweredRandomCheckbox").checked;
    document.getElementById("randomQuizForm").style.display = "none";
    loadQuestions({
      type: 'random',
      num: numQuestions,
      includeAnswered: includeAnswered
    });
  });

  document.getElementById("cancelRandomQuiz").addEventListener("click", function() {
    document.getElementById("randomQuizForm").style.display = "none";
  });

  document.getElementById("bookmarksFilter").addEventListener("click", function(e) {
    e.preventDefault();
    closeSideMenu();
  });

  document.getElementById("startNewQuiz").addEventListener("click", function() {
    closeSideMenu();
    window.filterMode = "all";
    document.querySelector(".swiper").style.display = "none";
    document.getElementById("bottomToolbar").style.display = "none";
    document.getElementById("iconBar").style.display = "none";
    document.getElementById("performanceView").style.display = "none";
    document.getElementById("leaderboardView").style.display = "none";
    document.getElementById("faqView").style.display = "none";
    document.getElementById("aboutView").style.display = "none";
    document.getElementById("mainOptions").style.display = "flex";
  });

  document.getElementById("leaderboardItem").addEventListener("click", function() {
    closeSideMenu();
    showLeaderboard();
  });

  document.getElementById("performanceItem").addEventListener("click", function() {
    closeSideMenu();
    displayPerformance();
  });

  document.getElementById("faqItem").addEventListener("click", function() {
    closeSideMenu();
    showFAQ();
  });

  document.getElementById("aboutItem").addEventListener("click", function() {
    closeSideMenu();
    showAbout();
  });

  document.getElementById("contactItem").addEventListener("click", function() {
    closeSideMenu();
    document.querySelector(".swiper").style.display = "none";
    document.getElementById("bottomToolbar").style.display = "none";
    document.getElementById("iconBar").style.display = "none";
    document.getElementById("performanceView").style.display = "none";
    document.getElementById("leaderboardView").style.display = "none";
    document.getElementById("aboutView").style.display = "none";
    document.getElementById("faqView").style.display = "none";
    document.getElementById("mainOptions").style.display = "none";
    showContactModal();
  });

  document.getElementById("menuToggle").addEventListener("click", function() {
    document.getElementById("sideMenu").classList.add("open");
    document.getElementById("menuOverlay").classList.add("show");
  });
  document.getElementById("menuClose").addEventListener("click", function() {
    closeSideMenu();
  });
  document.getElementById("menuOverlay").addEventListener("click", function() {
    closeSideMenu();
  });

  document.getElementById("resetProgress").addEventListener("click", async function(e) {
    e.preventDefault();
    const confirmReset = confirm("Are you sure you want to reset all progress?");
    if (!confirmReset) return;
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);
    try {
      await runTransaction(db, async (transaction) => {
        const userDoc = await transaction.get(userDocRef);
        if (userDoc.exists()) {
          let data = userDoc.data();
          data.answeredQuestions = {};
          data.stats = { totalAnswered: 0, totalCorrect: 0, totalIncorrect: 0, categories: {}, totalTimeSpent: 0 };
          data.streaks = { lastAnsweredDate: null, currentStreak: 0, longestStreak: 0 };
          transaction.set(userDocRef, data, { merge: true });
        }
      });
      alert("Progress has been reset!");
    } catch (error) {
      console.error("Error resetting progress:", error);
      alert("There was an error resetting your progress.");
    }
    closeSideMenu();
  });

  document.getElementById("logoClick").addEventListener("click", function() {
    closeSideMenu();
    document.getElementById("aboutView").style.display = "none";
    document.getElementById("faqView").style.display = "none";
    document.querySelector(".swiper").style.display = "none";
    document.getElementById("bottomToolbar").style.display = "none";
    document.getElementById("iconBar").style.display = "none";
    document.getElementById("performanceView").style.display = "none";
    document.getElementById("leaderboardView").style.display = "none";
    document.getElementById("mainOptions").style.display = "flex";
  });

  document.getElementById("feedbackButton").addEventListener("click", function() {
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
    document.getElementById("feedbackQuestionInfo").textContent = `Feedback for Q: ${currentFeedbackQuestionText}`;
    document.getElementById("feedbackModal").style.display = "flex";
  });

  document.getElementById("closeFeedbackModal").addEventListener("click", function() {
    document.getElementById("feedbackModal").style.display = "none";
  });

  document.getElementById("submitFeedback").addEventListener("click", async function() {
    const feedbackText = document.getElementById("feedbackText").value.trim();
    if (!feedbackText) {
      alert("Please enter your feedback.");
      return;
    }
    try {
      await addDoc(collection(db, "feedback"), {
        questionId: currentFeedbackQuestionId,
        questionText: currentFeedbackQuestionText,
        feedback: feedbackText,
        timestamp: serverTimestamp()
      });
      alert("Thank you for your feedback!");
      document.getElementById("feedbackText").value = "";
      document.getElementById("feedbackModal").style.display = "none";
    } catch (error) {
      console.error("Error submitting feedback:", error);
      alert("There was an error submitting your feedback. Please try again later.");
    }
  });
});

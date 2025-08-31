import { auth, db, doc, getDoc, collection, getDocs, functions, httpsCallable } from './firebase-config.js';
import { fetchQuestionBank } from './quiz.js';

// --- Get a reference to the getLeaderboardData Callable Function ---
let getLeaderboardDataFunction;
try {
    if (functions && httpsCallable) {
        getLeaderboardDataFunction = httpsCallable(functions, 'getLeaderboardData');
        console.log("Callable function reference 'getLeaderboardData' created in stats.js.");
    } else {
        console.error("Firebase Functions or httpsCallable not imported correctly in stats.js.");
    }
} catch (error) {
    console.error("Error getting 'getLeaderboardData' callable function reference in stats.js:", error);
}

// --- Helper function to build a list of users ---
function buildUserList(listData, statKey, statLabel) {
    const currentUid = auth.currentUser.uid;
    if (!listData || listData.length === 0) {
        return '<div class="empty-state">No ranked players yet.</div>';
    }
    return listData.map(user => `
        <li class="leaderboard-entry ${user.uid === currentUid ? 'current-user' : ''}">
            <div class="rank-container rank-${user.rank}">${user.rank}</div>
            <div class="user-info">
                <p class="username">${user.username}</p>
            </div>
            <div class="user-stats">
                <p class="stat-value">${user[statKey]}</p>
                <p class="stat-label">${statLabel}</p>
            </div>
        </li>
    `).join('');
}

// --- Helper function to build the "Your Rank" section ---
function buildYourRank(rankData, statKey, statLabel) {
    if (!rankData) {
        return '<p style="text-align:center; font-style:italic; color:#666;">You are not yet ranked in this category.</p>';
    }
    return `
        <div class="your-ranking">
            <h4>Your Rank</h4>
            <ul class="leaderboard-entry-list" style="padding:0;">
                <li class="leaderboard-entry current-user">
                    <div class="rank-container">${rankData.rank}</div>
                    <div class="user-info">
                        <p class="username">${rankData.username} (You)</p>
                    </div>
                    <div class="user-stats">
                        <p class="stat-value">${rankData[statKey]}</p>
                        <p class="stat-label">${statLabel}</p>
                    </div>
                </li>
            </ul>
        </div>
    `;
}

// --- Functions to RENDER content for each MAIN tab ---

function renderXpLeaderboard(data, container) {
    const content = `
        <div id="xpTimeRangeTabs" class="time-range-tabs">
            <button class="time-range-tab active" data-target="weeklyXpBoard">Weekly</button>
            <button class="time-range-tab" data-target="allTimeXpBoard">All-Time</button>
        </div>
        <div id="weeklyXpBoard" class="leaderboard-content">
            <ul class="leaderboard-entry-list">${buildUserList(data.weeklyXpLeaderboard, 'weeklyXp', 'XP')}</ul>
        </div>
        <div id="allTimeXpBoard" class="leaderboard-content" style="display: none;">
            <ul class="leaderboard-entry-list">${buildUserList(data.xpLeaderboard, 'xp', 'XP')}</ul>
        </div>
        <div id="yourWeeklyXpRank">${buildYourRank(data.currentUserRanks.weeklyXp, 'weeklyXp', 'XP')}</div>
        <div id="yourAllTimeXpRank" style="display: none;">${buildYourRank(data.currentUserRanks.xp, 'xp', 'XP')}</div>
    `;
    container.innerHTML = content;

    // Attach listeners for the SUB-TABS
    const xpTabs = container.querySelectorAll('#xpTimeRangeTabs .time-range-tab');
    xpTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            xpTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const targetId = tab.dataset.target;
            container.querySelector('#weeklyXpBoard').style.display = (targetId === 'weeklyXpBoard') ? 'block' : 'none';
            container.querySelector('#allTimeXpBoard').style.display = (targetId === 'allTimeXpBoard') ? 'block' : 'none';
            container.querySelector('#yourWeeklyXpRank').style.display = (targetId === 'weeklyXpBoard') ? 'block' : 'none';
            container.querySelector('#yourAllTimeXpRank').style.display = (targetId === 'allTimeXpBoard') ? 'block' : 'none';
        });
    });
}

function renderStreakLeaderboard(data, container) {
    container.innerHTML = `
        <div class="leaderboard-content">
            <ul class="leaderboard-entry-list">${buildUserList(data.streakLeaderboard, 'currentStreak', 'Days')}</ul>
        </div>
        ${buildYourRank(data.currentUserRanks.streak, 'currentStreak', 'Days')}
    `;
}

function renderAnsweredLeaderboard(data, container) {
    container.innerHTML = `
        <div class="leaderboard-content">
            <ul class="leaderboard-entry-list">${buildUserList(data.answeredLeaderboard, 'weeklyAnsweredCount', 'Answered')}</ul>
        </div>
        ${buildYourRank(data.currentUserRanks.answered, 'weeklyAnsweredCount', 'Answered')}
    `;
}


// --- Master function to build the leaderboard SHELL and handle MAIN tabs ---
async function initializeLeaderboardView() {
    const leaderboardView = document.getElementById("leaderboardView");
    leaderboardView.innerHTML = `<div style="text-align: center; padding: 40px;"><div class="loading-spinner" style="margin: 0 auto 15px; width: 40px; height: 40px; border: 4px solid rgba(12, 114, 211, 0.2); border-radius: 50%; border-top-color: #0C72D3; animation: spin 1s linear infinite;"></div><p style="color: #0C72D3;">Loading Leaderboards...</p></div>`;

    if (!getLeaderboardDataFunction) {
        leaderboardView.innerHTML = `<h2>Error</h2><p>Leaderboard service is not available.</p>`;
        return;
    }

    try {
        const result = await getLeaderboardDataFunction();
        const data = result.data;

        // Build the page shell with main tabs
        leaderboardView.innerHTML = `
            <h2>Leaderboards</h2>
            <div id="leaderboardMainTabs" class="leaderboard-main-tabs">
                <button class="leaderboard-main-tab active" data-content="xp">XP Rankings</button>
                <button class="leaderboard-main-tab" data-content="streaks">Streaks</button>
                <button class="leaderboard-main-tab" data-content="answered">Most Active</button>
            </div>
            <div id="leaderboardContentArea" class="leaderboard-content-area">
                <!-- Content will be rendered here -->
            </div>
            <button class="leaderboard-back-btn" id="leaderboardBack">Back</button>
        `;

        const contentArea = document.getElementById('leaderboardContentArea');
        const mainTabs = document.querySelectorAll('#leaderboardMainTabs .leaderboard-main-tab');

        // Render the default view (XP)
        renderXpLeaderboard(data, contentArea);

        // Attach listeners for the MAIN tabs
        mainTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                mainTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const contentType = tab.dataset.content;
                if (contentType === 'xp') {
                    renderXpLeaderboard(data, contentArea);
                } else if (contentType === 'streaks') {
                    renderStreakLeaderboard(data, contentArea);
                } else if (contentType === 'answered') {
                    renderAnsweredLeaderboard(data, contentArea);
                }
            });
        });

        // Attach listener for the back button
        document.getElementById("leaderboardBack").addEventListener("click", () => {
            leaderboardView.style.display = "none";
            document.getElementById("mainOptions").style.display = "flex";
        });

    } catch (error) {
        console.error("Error initializing leaderboard view:", error);
        leaderboardView.innerHTML = `<h2>Error</h2><p>Could not load leaderboard data. Please try again later.</p><button class="leaderboard-back-btn" id="leaderboardBack">Back</button>`;
        document.getElementById("leaderboardBack").addEventListener("click", () => {
            leaderboardView.style.display = "none";
            document.getElementById("mainOptions").style.display = "flex";
        });
    }
}

// --- Keep displayPerformance as it is, but make it globally available ---
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
    const userSpecialty = data.specialty; // Get the user's specialty
    const allAnsweredQuestions = data.answeredQuestions || {}; // Get all answered questions from the user's doc
  
    // --- Fetch and Filter Question Bank by Specialty ---
    let questionBank = [];
    let specialtyQuestions = [];
    try {
      questionBank = await fetchQuestionBank();
      if (userSpecialty) {
        specialtyQuestions = questionBank.filter(q => q.Specialty && q.Specialty.trim().toLowerCase() === userSpecialty.trim().toLowerCase());
        console.log(`Filtered question bank for specialty "${userSpecialty}". Found ${specialtyQuestions.length} questions.`);
      } else {
        // Fallback for users without a specialty (e.g., legacy users)
        specialtyQuestions = questionBank;
        console.log("User has no specialty set. Using the entire question bank for stats.");
      }
    } catch (error) {
      console.error("Error fetching or filtering question bank:", error);
      // Display an error and return if the question bank can't be loaded
      document.getElementById("performanceView").innerHTML = `<p>Error loading question data. Please try again later.</p>`;
      return;
    }
  
    // --- Recalculate Stats Based ONLY on Specialty Questions ---
    let totalAnswered = 0;
    let totalCorrect = 0;
    const specialtyCategoryStats = {};
  
    // Create a Set of specialty question IDs for efficient lookup
    const specialtyQuestionIds = new Set(specialtyQuestions.map(q => q.Question.trim()));
  
    // Iterate through the user's answered questions
    for (const questionId in allAnsweredQuestions) {
      // Check if the answered question belongs to the user's specialty
      if (specialtyQuestionIds.has(questionId.trim())) {
        const answerData = allAnsweredQuestions[questionId];
        totalAnswered++;
        if (answerData.isCorrect) {
          totalCorrect++;
        }
        
        const category = answerData.category || "Uncategorized";
        if (!specialtyCategoryStats[category]) {
          specialtyCategoryStats[category] = { answered: 0, correct: 0 };
        }
        specialtyCategoryStats[category].answered++;
        if (answerData.isCorrect) {
          specialtyCategoryStats[category].correct++;
        }
      }
    }
  
    const overallPercent = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
    
    // --- XP and Level logic remains UNCHANGED, using the original stats object ---
    const stats = data.stats || {};
    const xp = stats.xp || 0;
    const level = stats.level || 1;
    const levelThresholds = [0, 30, 75, 150, 250, 400, 600, 850, 1150, 1500, 2000, 2750, 3750, 5000, 6500];
    const currentLevelXp = levelThresholds[level - 1] || 0;
    const nextLevelXp = level < levelThresholds.length ? levelThresholds[level] : null;
    const xpInCurrentLevel = xp - currentLevelXp;
    const xpRequiredForNextLevel = nextLevelXp ? nextLevelXp - currentLevelXp : 1000; 
    const levelProgress = Math.min(100, Math.floor((xpInCurrentLevel / xpRequiredForNextLevel) * 100));
  
    // --- 'Remaining' calculation is now based on the specialty question bank ---
    const totalInSpecialtyBank = specialtyQuestions.length;
    let remaining = totalInSpecialtyBank - totalAnswered;
    if (remaining < 0) { remaining = 0; }
  
    const performanceView = document.getElementById("performanceView");
    if (!performanceView) {
        console.error("Performance view element not found!");
        return;
    }
    
    performanceView.innerHTML = `
      <h2 style="text-align:center; color:#0056b3;">Performance (Specialty: ${userSpecialty || 'Overall'})</h2>
      <div style="display:flex; flex-wrap:wrap; justify-content:center; gap:20px; margin-bottom:20px;">
        <div style="flex:1; min-width:220px; max-width:300px; display:flex; flex-direction:column; align-items:center;">
          <canvas id="overallScoreChart" width="200" height="200"></canvas>
          <p style="font-size:1.2rem; color:#333; margin-top:10px; text-align:center;">
            Accuracy: ${overallPercent}%
          </p>
        </div>
        <div style="flex:1; min-width:220px; max-width:300px; display:flex; flex-direction:column; align-items:center;">
          <div class="level-progress-circle" style="width:100px; height:100px; margin:20px auto;">
            <div class="level-circle-background"></div>
            <div class="level-circle-progress" id="performanceLevelProgress"></div>
            <div class="level-number" style="font-size:2rem; transform:scale(0.85);">${level}</div>
          </div>
          <p style="font-size:1.4rem; color:#0056b3; margin:10px 0 5px 0; text-align:center;">
            ${xp} XP
          </p>
          <p style="font-size:0.9rem; color:#666; margin-top:0; text-align:center;">
            ${nextLevelXp ? `${xpInCurrentLevel}/${xpRequiredForNextLevel} XP to Level ${level + 1}` : 'Max Level Reached!'}
          </p>
        </div>
      </div>
      <div style="background:#f5f5f5; border-radius:8px; padding:15px; margin:20px 0;">
        <h3 style="margin-top:0; color:#0056b3; text-align:center;">Stats Summary (Specialty)</h3>
        <p style="font-size:1rem; color:#333;">Total Questions Answered: <strong>${totalAnswered}</strong></p>
        <p style="font-size:1rem; color:#333;">Correct Answers: <strong>${totalCorrect}</strong> (${overallPercent}%)</p>
        <p style="font-size:1rem; color:#333;">Questions Remaining: <strong>${remaining}</strong></p>
      </div>
      <hr>
      <h3 style="text-align:center; color:#0056b3;">By Category (Specialty)</h3>
      <div id="categoryBreakdownInternal"></div>
      <button id="backToMain" style="margin-top:20px; display:block; margin-left:auto; margin-right:auto;" class="start-quiz-btn">Back</button>
    `;
  
    const categoryBreakdownContainer = document.getElementById("categoryBreakdownInternal");
    const accessTier = window.authState?.accessTier;
    const isRegistered = window.authState?.isRegistered; 
  
    if (categoryBreakdownContainer) {
      if (accessTier === "free_guest") {
          const message1 = "Detailed subject-specific analytics are a premium feature.";
          const message2 = "Upgrade your account to track your performance across different subspecialties!";
          const buttonText = "Upgrade to Access";
          const buttonId = "upgradeForAnalyticsBtn_stats";
          categoryBreakdownContainer.innerHTML = `<div class="guest-analytics-prompt" style="margin-top: 20px; padding: 15px; background: #f2f7ff; border-left: 4px solid #0C72D3; border-radius: 8px; text-align: center;"><p style="color: #0056b3; margin-bottom: 10px;">${message1}</p><p style="color: #0056b3; margin-bottom: 15px;">${message2}</p><button id="${buttonId}" class="start-quiz-btn" style="padding: 10px 20px; font-size: 1rem;">${buttonText}</button></div>`;
          const upgradeButton = document.getElementById(buttonId);
          if (upgradeButton) {
              const newUpgradeButton = upgradeButton.cloneNode(true);
              upgradeButton.parentNode.replaceChild(newUpgradeButton, upgradeButton);
              newUpgradeButton.addEventListener('click', function() {
                  if (performanceView) performanceView.style.display = 'none'; 
                  const mainPaywallScreen = document.getElementById("newPaywallScreen");
                  if (mainPaywallScreen) { mainPaywallScreen.style.display = 'flex'; }
              });
          }
      } else if (isRegistered && (accessTier === "board_review" || accessTier === "cme_annual" || accessTier === "cme_credits_only")) {
          let categoryBreakdownHtml = "";
          // Use the newly calculated specialtyCategoryStats
          if (specialtyCategoryStats && Object.keys(specialtyCategoryStats).length > 0) {
              categoryBreakdownHtml = Object.keys(specialtyCategoryStats).map(cat => {
                  const c = specialtyCategoryStats[cat];
                  const catAnswered = c.answered || 0;
                  const catCorrect = c.correct || 0;
                  const percent = catAnswered > 0 ? Math.round((catCorrect / catAnswered) * 100) : 0;
                  return `<div class="category-item"><strong>${cat}</strong>: ${catCorrect}/${catAnswered} (${percent}%)<div class="progress-bar-container"><div class="progress-bar" style="width: ${percent}%"></div></div></div>`;
              }).join("");
          } else {
              categoryBreakdownHtml = "<p>No category data available yet for your specialty. Answer more questions to see your breakdown!</p>";
          }
          categoryBreakdownContainer.innerHTML = categoryBreakdownHtml;
      }
    }
  
    const canvasElement = document.getElementById("overallScoreChart");
    if (canvasElement) {
      const ctx = canvasElement.getContext("2d");
      // Use the recalculated totalCorrect and totalAnswered for the chart
      new Chart(ctx, { type: "doughnut", data: { labels: ["Correct", "Incorrect"], datasets: [{ data: [totalCorrect, totalAnswered - totalCorrect], backgroundColor: ["#28a745", "#dc3545"] }] }, options: { responsive: false, cutout: "60%", plugins: { legend: { display: true } } } });
    }
    
    const performanceLevelProgress = document.getElementById("performanceLevelProgress");
    if (performanceLevelProgress) {
      // XP progress remains unchanged
      performanceLevelProgress.style.setProperty('--progress', `${levelProgress}%`);
    }
    
    const backButton = document.getElementById("backToMain");
    if (backButton) {
      const newBackButton = backButton.cloneNode(true);
      backButton.parentNode.replaceChild(newBackButton, backButton);
      newBackButton.addEventListener("click", function() {
          if (performanceView) performanceView.style.display = "none";
          const mainOptions = document.getElementById("mainOptions");
          if (mainOptions) mainOptions.style.display = "flex";
      });
    }
  }

// Make functions globally available
window.displayPerformance = displayPerformance;
window.initializeLeaderboardView = initializeLeaderboardView;

// Export the functions that ui.js will call
export { displayPerformance, initializeLeaderboardView };
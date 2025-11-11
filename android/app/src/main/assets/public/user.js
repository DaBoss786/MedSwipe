// Session tracking
let questionStartTime = 0;
let sessionStartTime = Date.now();

// Fetch already answered questions from Firestore
async function fetchPersistentAnsweredIds() {
  if (!window.auth || !window.auth.currentUser) {
    console.log("User not authenticated yet");
    return [];
  }
  
  try {
    const uid = window.auth.currentUser.uid;
    const userDocRef = window.doc(window.db, 'users', uid);
    const userDocSnap = await window.getDoc(userDocRef);
    if (userDocSnap.exists()){
      let data = userDocSnap.data();
      return Object.keys(data.answeredQuestions || {});
    }
  } catch (error) {
    console.error("Error fetching answered IDs:", error);
  }
  return [];
}

// Record answer in Firestore with XP calculation
async function recordAnswer(questionId, category, isCorrect, timeSpent) {
  if (!window.auth || !window.auth.currentUser) {
    console.log("User not authenticated, can't record answer");
    return;
  }
  
  const uid = window.auth.currentUser.uid;
  const userDocRef = window.doc(window.db, 'users', uid);
  
  try {
    let levelUp = false;
    let newLevel = 0;
    let totalXP = 0;
    
    await window.runTransaction(window.db, async (transaction) => {
      const userDoc = await window.getDoc(userDocRef);
      let data = userDoc.exists() ? userDoc.data() : {};
      
      // Initialize stats if needed
      if (!data.stats) {
        data.stats = { 
          totalAnswered: 0, 
          totalCorrect: 0, 
          totalIncorrect: 0, 
          categories: {}, 
          totalTimeSpent: 0,
          xp: 0, // Initialize XP
          level: 1,  // Initialize level
          achievements: {}, // Initialize achievements tracking
          currentCorrectStreak: 0 // Track consecutive correct answers
        };
      }
      
      // Initialize XP if it doesn't exist
      if (data.stats.xp === undefined) {
        data.stats.xp = 0;
      }
      
      // Initialize level if it doesn't exist
      if (data.stats.level === undefined) {
        data.stats.level = 1;
      }
      
      // Initialize achievements tracking
      if (!data.stats.achievements) {
        data.stats.achievements = {};
      }
      
      // Initialize current correct streak
      if (data.stats.currentCorrectStreak === undefined) {
        data.stats.currentCorrectStreak = 0;
      }
      
      if (!data.answeredQuestions) {
        data.answeredQuestions = {};
      }
      if (data.answeredQuestions[questionId]) return;
      
      // Track consecutive correct answers
      if (isCorrect) {
        data.stats.currentCorrectStreak++;
      } else {
        data.stats.currentCorrectStreak = 0;
      }
      
      const currentDate = new Date();
      const currentTimestamp = currentDate.getTime();
      const currentFormatted = currentDate.toLocaleString();
      
      data.answeredQuestions[questionId] = { 
        isCorrect, 
        category, 
        timestamp: currentTimestamp, 
        timestampFormatted: currentFormatted, 
        timeSpent 
      };
      
      // Update basic stats
      data.stats.totalAnswered++;
      if (isCorrect) {
        data.stats.totalCorrect++;
      } else {
        data.stats.totalIncorrect++;
      }
      data.stats.totalTimeSpent = (data.stats.totalTimeSpent || 0) + timeSpent;
      
      // Update category stats
      if (!data.stats.categories[category]) {
        data.stats.categories[category] = { answered: 0, correct: 0, incorrect: 0 };
      }
      data.stats.categories[category].answered++;
      if (isCorrect) {
        data.stats.categories[category].correct++;
      } else {
        data.stats.categories[category].incorrect++;
      }
      
      // Calculate base XP for this answer
      let earnedXP = 1; // Base XP for answering
      let bonusXP = 0; // Track bonus XP
      let bonusMessages = []; // Track bonus messages
      
      if (isCorrect) {
        earnedXP += 2; // Additional XP for correct answer
      }
      
      // Update streaks
      const normalizeDate = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
      let streaks = data.streaks || { lastAnsweredDate: null, currentStreak: 0, longestStreak: 0 };
      let streakUpdated = false;
      
      if (streaks.lastAnsweredDate) {
        const lastDate = new Date(streaks.lastAnsweredDate);
        const normalizedCurrent = normalizeDate(currentDate);
        const normalizedLast = normalizeDate(lastDate);
        const diffDays = Math.round((normalizedCurrent - normalizedLast) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
          streaks.currentStreak += 1;
          streakUpdated = true;
        } else if (diffDays > 1) {
          streaks.currentStreak = 1;
          streakUpdated = true;
        }
        
        streaks.lastAnsweredDate = currentDate.toISOString();
        
        if (streaks.currentStreak > streaks.longestStreak) {
          streaks.longestStreak = streaks.currentStreak;
        }
      } else {
        streaks.lastAnsweredDate = currentDate.toISOString();
        streaks.currentStreak = 1;
        streaks.longestStreak = 1;
        streakUpdated = true;
      }
      
      data.streaks = streaks;
      
      // ===== ACHIEVEMENT BONUSES =====
      
      // First 10 questions answered bonus (one-time)
      if (data.stats.totalAnswered === 10 && !data.stats.achievements.first10Questions) {
        bonusXP += 50;
        bonusMessages.push("First 10 questions answered: +50 XP");
        data.stats.achievements.first10Questions = true;
      }
      
      // Using the app for 7 days straight (one-time)
      if (streaks.currentStreak === 7 && !data.stats.achievements.first7DayStreak) {
        bonusXP += 50;
        bonusMessages.push("7-day streak achieved: +50 XP");
        data.stats.achievements.first7DayStreak = true;
      }
      
      // First 5 correct in a row (one-time)
      if (data.stats.currentCorrectStreak === 5 && !data.stats.achievements.first5Correct) {
        bonusXP += 20;
        bonusMessages.push("First 5 correct in a row: +20 XP");
        data.stats.achievements.first5Correct = true;
      }
      
      // ===== STREAK BONUSES =====
      
      // Current day streak bonuses
      if (streakUpdated) {
        // Only award these when the streak increments
        if (streaks.currentStreak === 3) {
          bonusXP += 5;
          bonusMessages.push("3-day streak: +5 XP");
        } else if (streaks.currentStreak === 7) {
          bonusXP += 15;
          bonusMessages.push("7-day streak: +15 XP");
        } else if (streaks.currentStreak === 14) {
          bonusXP += 30;
          bonusMessages.push("14-day streak: +30 XP");
        } else if (streaks.currentStreak === 30) {
          bonusXP += 75;
          bonusMessages.push("30-day streak: +75 XP");
        } else if (streaks.currentStreak === 60) {
          bonusXP += 150;
          bonusMessages.push("60-day streak: +150 XP");
        } else if (streaks.currentStreak === 100) {
          bonusXP += 500;
          bonusMessages.push("100-day streak: +500 XP");
        }
      }
      
      // ===== CORRECT ANSWER MILESTONE BONUSES =====
      
      // Correct answer count milestones
      if (isCorrect) {
        if (data.stats.totalCorrect === 10) {
          bonusXP += 10;
          bonusMessages.push("10 correct answers: +10 XP");
        } else if (data.stats.totalCorrect === 25) {
          bonusXP += 25;
          bonusMessages.push("25 correct answers: +25 XP");
        } else if (data.stats.totalCorrect === 50) {
          bonusXP += 75;
          bonusMessages.push("50 correct answers: +75 XP");
        }
      }
      
      // ===== CONSECUTIVE CORRECT ANSWER BONUSES =====
      
      // Correct answers in a row
      if (data.stats.currentCorrectStreak === 5) {
        bonusXP += 10;
        bonusMessages.push("5 correct in a row: +10 XP");
      } else if (data.stats.currentCorrectStreak === 10) {
        bonusXP += 25;
        bonusMessages.push("10 correct in a row: +25 XP");
      } else if (data.stats.currentCorrectStreak === 20) {
        bonusXP += 75;
        bonusMessages.push("20 correct in a row: +75 XP");
      }
      
      // Add the earned XP to user's total
      const totalEarnedXP = earnedXP + bonusXP;
      data.stats.xp += totalEarnedXP;
      totalXP = data.stats.xp;
      
      // Store any earned bonus messages
      if (bonusMessages.length > 0) {
        data.stats.lastBonusMessages = bonusMessages;
      } else {
        data.stats.lastBonusMessages = null;
      }
      
      // Get old level for comparison
      const oldLevel = data.stats.level;
      
      // Update level based on XP
      newLevel = calculateLevel(data.stats.xp);
      data.stats.level = newLevel;
      
      // Check if level increased
      if (newLevel > oldLevel) {
        levelUp = true;
      }
      
      transaction.set(userDocRef, data, { merge: true });
    });
    
    console.log("Recorded answer for", questionId);
    
    // Update user information after recording answer
    updateUserXP();
    updateUserMenu();
    
    // Update the dashboard if it exists
    if (typeof initializeDashboard === 'function') {
      initializeDashboard();
    }
    
    // Show level-up animation if level increased
    if (levelUp) {
      setTimeout(() => {
        showLevelUpAnimation(newLevel, totalXP);
      }, 1000);
    }
    
  } catch (error) {
    console.error("Error recording answer:", error);
  }
  // Check if registration prompt should be shown (for guest users)
if (window.auth && window.auth.currentUser && window.auth.currentUser.isAnonymous) {
  if (typeof window.checkRegistrationPrompt === 'function') {
    window.checkRegistrationPrompt();
  }
}
}

// Calculate level based on XP thresholds
function calculateLevel(xp) {
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
  
  let level = 1;
  for (let i = 1; i < levelThresholds.length; i++) {
    if (xp >= levelThresholds[i]) {
      level = i + 1;
    } else {
      break;
    }
  }
  return level;
}

// Calculate progress to next level (as percentage)
function calculateLevelProgress(xp) {
  const levelThresholds = [
    0, 30, 75, 150, 250, 400, 600, 850, 1150, 1500, 2000, 2750, 3750, 5000, 6500
  ];
  
  const level = calculateLevel(xp);
  
  // If at max level, return 100%
  if (level >= levelThresholds.length) {
    return 100;
  }
  
  const currentLevelXp = levelThresholds[level - 1];
  const nextLevelXp = levelThresholds[level];
  const xpInCurrentLevel = xp - currentLevelXp;
  const xpRequiredForNextLevel = nextLevelXp - currentLevelXp;
  
  return Math.min(100, Math.floor((xpInCurrentLevel / xpRequiredForNextLevel) * 100));
}

// XP info for a specific level
function getLevelInfo(level) {
  const levelThresholds = [
    0, 30, 75, 150, 250, 400, 600, 850, 1150, 1500, 2000, 2750, 3750, 5000, 6500
  ];
  
  // Cap at max defined level
  const actualLevel = Math.min(level, levelThresholds.length);
  
  const currentLevelXp = levelThresholds[actualLevel - 1];
  let nextLevelXp = null;
  
  if (actualLevel < levelThresholds.length) {
    nextLevelXp = levelThresholds[actualLevel];
  }
  
  return {
    currentLevelXp,
    nextLevelXp
  };
}

// Update question stats in Firestore
async function updateQuestionStats(questionId, isCorrect) {
  if (!window.db) {
    console.log("Database not initialized");
    return;
  }
  
  console.log("updateQuestionStats called for:", questionId, "isCorrect:", isCorrect);
  const questionStatsRef = window.doc(window.db, "questionStats", questionId);
  try {
    await window.runTransaction(window.db, async (transaction) => {
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

// Update user XP display
async function updateUserXP() {
  if (!window.auth || !window.auth.currentUser || !window.db) {
    console.log("Auth or DB not initialized for updateUserXP");
    return;
  }
  
  try {
    const uid = window.auth.currentUser.uid;
    const userDocRef = window.doc(window.db, 'users', uid);
    const userDocSnap = await window.getDoc(userDocRef);
    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      const xp = data.stats?.xp || 0;
      const level = data.stats?.level || 1;
      const progress = calculateLevelProgress(xp);
      
      // Update level display
      const scoreCircle = document.getElementById("scoreCircle");
      if (scoreCircle) {
        scoreCircle.textContent = level;
      }
      
      // Update XP display
      const xpDisplay = document.getElementById("xpDisplay");
      if (xpDisplay) {
        xpDisplay.textContent = `${xp} XP`;
      }
      
      // Update user menu level display
      const userScoreCircle = document.getElementById("userScoreCircle");
      if (userScoreCircle) {
        userScoreCircle.textContent = level;
      }
      
      // Update user menu XP display
      const userXpDisplay = document.getElementById("userXpDisplay");
      if (userXpDisplay) {
        const levelInfo = getLevelInfo(level);
        if (levelInfo.nextLevelXp) {
          userXpDisplay.textContent = `${xp}/${levelInfo.nextLevelXp} XP`;
        } else {
          userXpDisplay.textContent = `${xp} XP`;
        }
      }
      
      // Update progress bars and circles
      if (typeof updateLevelProgress === 'function') {
        updateLevelProgress(progress);
      }
      
      // Update dashboard if it exists
      if (typeof initializeDashboard === 'function') {
        initializeDashboard();
      }
      
      // Check for and display bonus messages - only if they exist AND we're not already showing notifications
      const lastBonusMessages = data.stats?.lastBonusMessages;
      const notificationsExist = document.getElementById("xpNotifications") && 
                                document.getElementById("xpNotifications").children.length > 0;
                                
      if (lastBonusMessages && Array.isArray(lastBonusMessages) && 
          lastBonusMessages.length > 0 && !notificationsExist) {
        
        showBonusMessages(lastBonusMessages);
        
        // Clear the messages after displaying them
        await window.runTransaction(window.db, async (transaction) => {
          const userDoc = await transaction.get(userDocRef);
          if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData.stats) {
              userData.stats.lastBonusMessages = null;
              transaction.set(userDocRef, userData, { merge: true });
            }
          }
        });
      }
    }
  } catch (error) {
    console.error("Error updating user XP:", error);
  }
}

// Show bonus messages as notifications
function showBonusMessages(messages) {
  if (!messages || messages.length === 0) return;
  
  // Remove existing notification container if it exists
  let existingContainer = document.getElementById("xpNotifications");
  if (existingContainer) {
    existingContainer.remove();
  }
  
  // Create notification container
  let notificationContainer = document.createElement("div");
  notificationContainer.id = "xpNotifications";
  notificationContainer.style.position = "fixed";
  notificationContainer.style.top = "70px";
  notificationContainer.style.right = "20px";
  notificationContainer.style.zIndex = "9999";
  document.body.appendChild(notificationContainer);
  
  // Create and show notifications for each message
  messages.forEach((message, index) => {
    const notification = document.createElement("div");
    notification.className = "xp-notification";
    notification.innerHTML = `<div class="xp-icon">✨</div>${message}`;
    notification.style.backgroundColor = "#0056b3";
    notification.style.color = "white";
    notification.style.padding = "10px 15px";
    notification.style.borderRadius = "6px";
    notification.style.marginBottom = "10px";
    notification.style.boxShadow = "0 2px 10px rgba(0,0,0,0.2)";
    notification.style.display = "flex";
    notification.style.alignItems = "center";
    notification.style.opacity = "0";
    notification.style.transform = "translateX(50px)";
    notification.style.transition = "opacity 0.5s ease, transform 0.5s ease";
    
    const iconDiv = notification.querySelector(".xp-icon");
    if (iconDiv) {
      iconDiv.style.marginRight = "10px";
      iconDiv.style.fontSize = "1.3rem";
    }
    
    notificationContainer.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
      notification.style.opacity = "1";
      notification.style.transform = "translateX(0)";
    }, 100 * index);
    
    // Remove after a delay
    setTimeout(() => {
      notification.style.opacity = "0";
      notification.style.transform = "translateX(50px)";
      setTimeout(() => notification.remove(), 500);
    }, 5000 + 100 * index);
  });
}

// Update the user menu with current username and score
async function updateUserMenu() {
  if (!window.auth || !window.auth.currentUser) {
    console.log("Auth not initialized for updateUserMenu");
    return;
  }
  
  try {
    const username = await getOrGenerateUsername();
    const usernameDisplay = document.getElementById("usernameDisplay");
    if (usernameDisplay) {
      usernameDisplay.textContent = username;
    }
    
    // Update XP display
    updateUserXP();
  } catch (error) {
    console.error("Error updating user menu:", error);
  }
}

// Get or generate a username
async function getOrGenerateUsername() {
  if (!window.auth || !window.auth.currentUser) {
    throw new Error("User not authenticated");
  }
  
  const uid = window.auth.currentUser.uid;
  const userDocRef = window.doc(window.db, 'users', uid);
  const userDocSnap = await window.getDoc(userDocRef);
  let username;
  if (userDocSnap.exists() && userDocSnap.data().username) {
    username = userDocSnap.data().username;
  } else {
    username = generateRandomName();
    await window.runTransaction(window.db, async (transaction) => {
      const docSnap = await transaction.get(userDocRef);
      let data = docSnap.exists() ? docSnap.data() : {};
      data.username = username;
      transaction.set(userDocRef, data, { merge: true });
    });
  }
  return username;
}

// Generate a random username
function generateRandomName() {
  const adjectives = ["Aural", "Otologic", "Laryngo", "Rhino", "Acoustic", "Vocal", "Expert", "Master", "Skillful"];
  const nouns = ["Cochlea", "Tympanum", "Glottis", "Sinus", "Auricle", "Eustachian", "Scalpel", "Endoscope", "Needle", "Foramen"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 9000) + 1000;
  return `${adj}${noun}${num}`;
}

// Bookmark functions - enhanced for toggling
async function getBookmarks() {
  if (!window.auth || !window.auth.currentUser) {
    console.log("User not authenticated for getBookmarks");
    return [];
  }
  
  try {
    const uid = window.auth.currentUser.uid;
    const userDocRef = window.doc(window.db, 'users', uid);
    const userDocSnap = await window.getDoc(userDocRef);
    if(userDocSnap.exists()){
      const data = userDocSnap.data();
      return data.bookmarks || [];
    }
  } catch (error) {
    console.error("Error getting bookmarks:", error);
  }
  return [];
}

// Toggle a bookmark (add if not present, remove if present)
async function toggleBookmark(questionId) {
  if (!window.auth || !window.auth.currentUser) {
    console.log("User not authenticated for toggleBookmark");
    return false;
  }
  
  try {
    const uid = window.auth.currentUser.uid;
    const userDocRef = window.doc(window.db, 'users', uid);
    
    await window.runTransaction(window.db, async (transaction) => {
      const userDoc = await transaction.get(userDocRef);
      let data = userDoc.exists() ? userDoc.data() : {};
      let bookmarks = data.bookmarks || [];
      
      // Check if the question is already bookmarked
      const index = bookmarks.indexOf(questionId);
      
      // If not bookmarked, add it
      if (index === -1) {
        bookmarks.push(questionId);
      } 
      // If already bookmarked, remove it (true toggle functionality)
      else {
        bookmarks.splice(index, 1);
      }
      
      transaction.set(userDocRef, { bookmarks: bookmarks }, { merge: true });
    });
    
    // Get the updated bookmarks list
    const updatedBookmarks = await getBookmarks();
    const isBookmarked = updatedBookmarks.includes(questionId);
    
    // Update the current slide's bookmark attribute
    const currentSlide = document.querySelector(`.swiper-slide[data-id="${questionId}"]`);
    if (currentSlide) {
      currentSlide.dataset.bookmarked = isBookmarked ? "true" : "false";
    }
    
    return isBookmarked;
  } catch (error) {
    console.error("Error toggling bookmark:", error);
    return false;
  }
}

// Function to show the level-up modal and animation
function showLevelUpAnimation(newLevel, totalXP) {
  // Remove any existing level up elements
  const existingLevelUps = document.querySelectorAll('body > :not([id])');
  existingLevelUps.forEach(node => {
    if (node.textContent && node.textContent.includes('LEVEL UP')) {
      node.remove();
    }
  });
  
  // Create modal if it doesn't exist
  let modal = document.getElementById('levelUpModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'levelUpModal';
    modal.innerHTML = `
      <div id="levelUpContent">
        <div id="levelUpHeader">
          <h2 id="levelUpTitle">LEVEL UP!</h2>
        </div>
        <div id="levelUpBadge">
          <span id="levelNumber"></span>
        </div>
        <div id="levelUpBody">
          <p id="levelUpMessage">You've reached a new level!</p>
          <p id="levelUpXP"></p>
          <button id="levelUpButton">Continue</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Add event listener to close button
    document.getElementById('levelUpButton').addEventListener('click', function() {
      hideLevelUpModal();
    });
  }
  
  // Update modal content
  const levelNumber = document.getElementById('levelNumber');
  const levelUpXP = document.getElementById('levelUpXP');
  const levelUpMessage = document.getElementById('levelUpMessage');
  
  if (levelNumber) levelNumber.textContent = newLevel;
  if (levelUpXP) levelUpXP.textContent = `Total XP: ${totalXP}`;
  
  // Custom messages based on level
  if (levelUpMessage) {
    if (newLevel >= 10) {
      levelUpMessage.textContent = "Amazing progress! You've reached an elite level!";
    } else if (newLevel >= 5) {
      levelUpMessage.textContent = "Great job! You're becoming a master!";
    } else {
      levelUpMessage.textContent = "Congratulations! Keep up the good work!";
    }
  }
  
  // Show the modal with proper styling
  if (modal) {
    modal.style.display = 'flex';
    
    // Add fade in effect
    setTimeout(() => {
      modal.style.opacity = '1';
    }, 10);
    
    // Create confetti effect
    createConfetti();
    
    // Play sound effect if available
    if (window.Audio) {
      try {
        const levelUpSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2000/2000.wav');
        levelUpSound.volume = 0.5;
        levelUpSound.play();
      } catch (e) {
        console.log("Sound could not be played", e);
      }
    }
  }
}

// Function to hide the level-up modal
function hideLevelUpModal() {
  const modal = document.getElementById('levelUpModal');
  if (modal) {
    modal.style.opacity = '0';
    setTimeout(() => {
      modal.style.display = 'none';
    }, 300);
  }
}

// Function to create confetti effect
function createConfetti() {
  const colors = ['#FFC700', '#FF3D00', '#00C853', '#2979FF', '#AA00FF', '#D500F9'];
  const modal = document.getElementById('levelUpModal');
  
  if (!modal) return;
  
  // Remove old confetti
  const oldConfetti = modal.querySelectorAll('.confetti');
  oldConfetti.forEach(c => c.remove());
  
  // Create new confetti pieces
  for (let i = 0; i < 50; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.style.left = Math.random() * 100 + '%';
    confetti.style.top = Math.random() * 50 + '%';
    confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.transform = `rotate(${Math.random() * 360}deg)`;
    
    // Random size between 5px and 10px
    const size = 5 + Math.random() * 5;
    confetti.style.width = `${size}px`;
    confetti.style.height = `${size}px`;
    
    // Random animation delay
    confetti.style.animationDelay = Math.random() * 1.5 + 's';
    
    modal.appendChild(confetti);
  }
}

// Clean up any existing LEVEL UP text on page load
document.addEventListener('DOMContentLoaded', function() {
  // Clean up any existing LEVEL UP text
  const textNodes = document.querySelectorAll('body > *:not([id])');
  textNodes.forEach(node => {
    if (node.textContent && node.textContent.includes('LEVEL UP')) {
      node.remove();
    }
  });
});

// Function to update spaced repetition data for a question
async function updateSpacedRepetitionData(questionId, isCorrect, difficulty, nextReviewInterval) {
  if (!window.auth || !window.auth.currentUser) {
    console.log("User not authenticated, can't update spaced repetition data");
    return;
  }
  
  const uid = window.auth.currentUser.uid;
  const userDocRef = window.doc(window.db, 'users', uid);
  
  try {
    await window.runTransaction(window.db, async (transaction) => {
      const userDoc = await transaction.get(userDocRef);
      let data = userDoc.exists() ? userDoc.data() : {};
      
      // Initialize spacedRepetition object if it doesn't exist
      if (!data.spacedRepetition) {
        data.spacedRepetition = {};
      }
      
      // Calculate the next review date
      const now = new Date();
      const nextReviewDate = new Date();
      nextReviewDate.setDate(now.getDate() + nextReviewInterval);
      
      // Update or create the question's spaced repetition data
      data.spacedRepetition[questionId] = {
        lastReviewedAt: now.toISOString(),
        nextReviewDate: nextReviewDate.toISOString(),
        reviewInterval: nextReviewInterval,
        difficulty: difficulty,
        lastResult: isCorrect ? 'correct' : 'incorrect',
        reviewCount: (data.spacedRepetition[questionId]?.reviewCount || 0) + 1
      };
      
      // Update the user document
      transaction.set(userDocRef, data, { merge: true });
    });
    
    console.log(`Spaced repetition data updated for question ${questionId}`);
  } catch (error) {
    console.error("Error updating spaced repetition data:", error);
  }
}

// Make the function available globally
window.updateSpacedRepetitionData = updateSpacedRepetitionData;

// Function to fetch user's spaced repetition data
async function fetchSpacedRepetitionData() {
  if (!window.auth || !window.auth.currentUser) {
    console.log("User not authenticated yet");
    return null;
  }
  
  try {
    const uid = window.auth.currentUser.uid;
    const userDocRef = window.doc(window.db, 'users', uid);
    const userDocSnap = await window.getDoc(userDocRef);
    
    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      return data.spacedRepetition || {};
    }
  } catch (error) {
    console.error("Error fetching spaced repetition data:", error);
  }
  
  return {};
}

// Make the function available globally
window.fetchSpacedRepetitionData = fetchSpacedRepetitionData;

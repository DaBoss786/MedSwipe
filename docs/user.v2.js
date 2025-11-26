// user.js - TOP OF FILE
import { auth, db, doc, getDoc, runTransaction, serverTimestamp, functions, httpsCallable, setDoc, updateProfile } from './firebase-config.js'; // Adjust path if needed
import { setHapticsEnabled } from './haptics.js';
import { isIosNativeApp } from './platform.js';

// user.js - After imports

let recordCmeAnswerFunction; // Keep the variable name the same for simplicity internally
if (functions && httpsCallable) {
  try {
    // Use the NEW function name "recordCmeAnswerV2" when creating the reference
    recordCmeAnswerFunction = httpsCallable(functions, 'recordCmeAnswerV2'); // <--- NEW NAME
    console.log("Callable function reference 'recordCmeAnswerV2' created in user.js.");
  } catch (error) {
    console.error("Error creating 'recordCmeAnswerV2' callable function reference in user.js:", error);
    // Handle error, perhaps by disabling CME recording or alerting the user.
  }
} else {
  console.error("Firebase Functions or httpsCallable not imported correctly in user.js.");
}

// Add this to the top of the file with other function references
let updateUserProfileFunction;
try {
  updateUserProfileFunction = httpsCallable(functions, 'updateUserProfile');
} catch (error) {
  console.error("Error creating updateUserProfile function reference in user.v2.js:", error);
}

const IOS_REVIEW_QUESTION_MILESTONES = [10, 40, 60];

function getAppReviewPlugin() {
  if (typeof window === 'undefined') return undefined;
  return window?.Capacitor?.Plugins?.AppReview;
}

// Session tracking
let questionStartTime = 0;
let sessionStartTime = Date.now();

// Fetch already answered questions from Firestore
async function fetchPersistentAnsweredIds() {
  if (!auth || !auth.currentUser) {
    console.log("User not authenticated yet");
    return [];
  }
  
  try {
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);
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
  if (!auth || !auth.currentUser) {
    console.log("User not authenticated, can't record answer");
    return;
  }
  
  const uid = auth.currentUser.uid;
  const userDocRef = doc(db, 'users', uid);
  
  try {
    let levelUp = false;
    let newLevel = 0;
    let totalXP = 0;
    let shouldPromptForIosReview = false;
    
    await runTransaction(db, async (transaction) => {
      const userDoc = await getDoc(userDocRef);
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
          currentCorrectStreak: 0, // Track consecutive correct answers
          hasPromptedIosReview: false,
          promptedIosReviewMilestones: []
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

      if (data.stats.hasPromptedIosReview === undefined) {
        data.stats.hasPromptedIosReview = false;
      }

      if (!Array.isArray(data.stats.promptedIosReviewMilestones)) {
        if (data.stats.promptedIosReviewMilestones && typeof data.stats.promptedIosReviewMilestones === 'object') {
          data.stats.promptedIosReviewMilestones = Object.values(data.stats.promptedIosReviewMilestones);
        } else {
          data.stats.promptedIosReviewMilestones = [];
        }
      }

      if (data.stats.hasPromptedIosReview && data.stats.promptedIosReviewMilestones.length === 0) {
        data.stats.promptedIosReviewMilestones.push(IOS_REVIEW_QUESTION_MILESTONES[0]);
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

      let promptedMilestones = data.stats.promptedIosReviewMilestones || [];

      if (isIosNativeApp() && promptedMilestones.length === 0) {
        const milestonesAlreadyReached = IOS_REVIEW_QUESTION_MILESTONES.filter((milestone) => {
          return data.stats.totalAnswered >= milestone;
        });

        if (milestonesAlreadyReached.length > 1) {
          const milestonesToBackfill = milestonesAlreadyReached.slice(0, -1);
          if (milestonesToBackfill.length > 0) {
            promptedMilestones = Array.from(new Set([...promptedMilestones, ...milestonesToBackfill]));
            data.stats.promptedIosReviewMilestones = promptedMilestones;
          }
        }
      }

      const milestoneToTrigger = IOS_REVIEW_QUESTION_MILESTONES.find((milestone) => {
        return !promptedMilestones.includes(milestone) && data.stats.totalAnswered >= milestone;
      });

      if (milestoneToTrigger !== undefined && isIosNativeApp()) {
        promptedMilestones.push(milestoneToTrigger);
        data.stats.promptedIosReviewMilestones = Array.from(new Set(promptedMilestones));
        if (milestoneToTrigger === IOS_REVIEW_QUESTION_MILESTONES[0]) {
          data.stats.hasPromptedIosReview = true;
        }
        shouldPromptForIosReview = true;
      }
      
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
          // User came back the next day, increment the streak
          streaks.currentStreak += 1;
          streakUpdated = true;
        } else if (diffDays > 1) {
          // User missed one or more days, reset the current streak
          streaks.currentStreak = 1;
          streakUpdated = true;
        }
        // If diffDays is 0, they are answering on the same day, so we do nothing to the streak.
        
        // ** THE FIX IS HERE **
        // We now check if the (potentially newly updated) current streak is greater than the longest streak.
        // This check happens *after* we've determined the new current streak.
        // This ensures the longest streak is ONLY updated when a new record is set.
        if (streaks.currentStreak > streaks.longestStreak) {
          streaks.longestStreak = streaks.currentStreak;
        }
        
        // Always update the last answered date
        streaks.lastAnsweredDate = currentDate.toISOString();

      } else {
        // This is the user's first answer ever.
        streaks.lastAnsweredDate = currentDate.toISOString();
        streaks.currentStreak = 1;
        streaks.longestStreak = 1;
        streakUpdated = true;
      }
      
      data.streaks = streaks;
      
      // ===== ACHIEVEMENT BONUSES =====
      
      // First correct answer bonus (one-time)
if (isCorrect && data.stats.totalCorrect === 1 && !data.stats.achievements.firstCorrectAnswer) {
  bonusXP += 5;
  bonusMessages.push("First correct answer: +5 XP");
  data.stats.achievements.firstCorrectAnswer = true;
}

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
      
      transaction.update(userDocRef, {
        answeredQuestions: data.answeredQuestions,
        stats: data.stats,
        streaks: data.streaks
    });
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

    if (shouldPromptForIosReview) {
      const reviewPromptDelay = levelUp ? 2200 : 800;
      setTimeout(() => {
        maybeShowIosReviewPrompt();
      }, reviewPromptDelay);
    }
    
  } catch (error) {
    console.error("Error recording answer:", error);
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
  if (!db) {
    console.log("Database not initialized");
    return;
  }
  
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

// Update user XP display
async function updateUserXP() {
  if (!auth || !auth.currentUser || !db) {
    console.log("Auth or DB not initialized for updateUserXP");
    return;
  }
  
  try {
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);
    if (userDocSnap.exists()) {
      const data = userDocSnap.data();
      const totalXP = data.stats?.xp || 0; // Use totalXP from stats
      const currentLevel = data.stats?.level || 1; // Use currentLevel from stats
      
      // Use your existing calculateLevelProgress to get the percentage
      // Assuming calculateLevelProgress is defined in this file and returns an object like { progressPercent: number }
      // or just the number directly. Let's assume it returns the percentage directly for this example.
      // If it returns an object, adjust accordingly: const { progressPercent } = calculateLevelProgress(totalXP);
      const progressPercent = calculateLevelProgress(totalXP); // This should be the percentage

      // Update level display in the main toolbar
      const scoreCircle = document.getElementById("scoreCircle");
      if (scoreCircle) {
        scoreCircle.textContent = currentLevel;
      }
      
      // Update XP display in the main toolbar
      const xpDisplay = document.getElementById("xpDisplay");
      if (xpDisplay) {
        xpDisplay.textContent = `${totalXP} XP`;
      }

      // --- THIS IS THE KEY PART FOR THE MAIN TOOLBAR PROGRESS RING ---
      const mainToolbarLevelCircleProgress = document.getElementById("levelCircleProgress");
      if (mainToolbarLevelCircleProgress) {
        mainToolbarLevelCircleProgress.style.setProperty('--progress', `${progressPercent}%`);
        console.log(`Main Toolbar levelCircleProgress in updateUserXP set to: ${progressPercent}%`);
      } else {
        console.warn("Main Toolbar #levelCircleProgress element NOT FOUND in updateUserXP.");
      }
      // --- END KEY PART ---
      
      // Update user menu level display
      const userScoreCircle = document.getElementById("userScoreCircle");
      if (userScoreCircle) {
        userScoreCircle.textContent = currentLevel;
      }
      
      // Update user menu XP display
      const userXpDisplay = document.getElementById("userXpDisplay");
      if (userXpDisplay) {
        const levelInfo = getLevelInfo(currentLevel); // Use currentLevel
        if (levelInfo.nextLevelXp) {
          userXpDisplay.textContent = `${totalXP}/${levelInfo.nextLevelXp} XP`;
        } else {
          userXpDisplay.textContent = `${totalXP} XP`;
        }
      }
      
      // Update user menu progress circle and bar
      const userLevelProgress = document.getElementById("userLevelProgress");
      if (userLevelProgress) {
        userLevelProgress.style.setProperty('--progress', `${progressPercent}%`);
      }
      const levelProgressBar = document.getElementById("levelProgressBar");
      if (levelProgressBar) {
        levelProgressBar.style.width = `${progressPercent}%`;
      }
      
      // Update dashboard if it exists (this will also update the dashboard's progress circle)
      if (typeof initializeDashboard === 'function') { // Check if initializeDashboard is in global scope (app.js)
        initializeDashboard();
      } else if (typeof window.initializeDashboard === 'function') { // Fallback check
        window.initializeDashboard();
      }
      
      // Check for and display bonus messages
      const lastBonusMessages = data.stats?.lastBonusMessages;
      const notificationsExist = document.getElementById("xpNotifications") && 
                                document.getElementById("xpNotifications").children.length > 0;
                                
      if (lastBonusMessages && Array.isArray(lastBonusMessages) && 
          lastBonusMessages.length > 0 && !notificationsExist) {
        showBonusMessages(lastBonusMessages);
        await runTransaction(db, async (transaction) => {
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
  if (!auth || !auth.currentUser) {
    console.log("Auth not initialized for updateUserMenu (user.js)");
    return;
  }
  console.log("updateUserMenu in user.js is being called.");

  try {
    // Username display is handled by user-profile.js

    const subscribeMenuItem = document.getElementById("subscribeMenuItemUser");
    const registerMenuItem = document.getElementById("registerMenuItem");
    const manageSubscriptionMenuItem = document.getElementById("manageSubscriptionBtn");
    const logoutUserBtnItem = document.getElementById("logoutUserBtn");
    const guestLoginMenuItem = document.getElementById("guestLoginMenuItem"); // Get the new Log In item

    // Ensure all menu items are found
    if (!subscribeMenuItem) console.warn("subscribeMenuItemUser not found in user.js");
    if (!registerMenuItem) console.warn("registerMenuItem not found in user.js");
    if (!manageSubscriptionMenuItem) console.warn("manageSubscriptionBtn not found in user.js");
    if (!logoutUserBtnItem) console.warn("logoutUserBtn (li) not found in user.js");
    if (!guestLoginMenuItem) console.warn("guestLoginMenuItem not found in user.js");


    if (subscribeMenuItem && registerMenuItem && manageSubscriptionMenuItem && logoutUserBtnItem && guestLoginMenuItem) {
        const accessTier = window.authState?.accessTier;
        const isAnonymousUser = window.authState?.user?.isAnonymous;
        const hasPremiumAccess = typeof window.userHasAnyPremiumAccess === "function"
            ? window.userHasAnyPremiumAccess()
            : (accessTier && accessTier !== "free_guest");
        const menuList = subscribeMenuItem.parentElement;

        // Default to hiding all dynamic items
        subscribeMenuItem.style.display = "none";
        registerMenuItem.style.display = "none";
        manageSubscriptionMenuItem.style.display = "none";
        logoutUserBtnItem.style.display = "none";
        guestLoginMenuItem.style.display = "none"; // Hide Log In by default

        if (isAnonymousUser) {
            if (hasPremiumAccess) {
                // ANONYMOUS PREMIUM: Offer registration only
                registerMenuItem.style.display = "block";
                if (menuList) {
                    const firstElement = menuList.firstElementChild;
                    if (firstElement !== registerMenuItem) {
                        menuList.insertBefore(registerMenuItem, firstElement);
                    }
                }
            } else {
                // ANONYMOUS FREE: Show Subscribe, Register, and Log In
                subscribeMenuItem.style.display = "block"; // Or "list-item"
                registerMenuItem.style.display = "block";
                guestLoginMenuItem.style.display = "block"; // Or "list-item"

                if (menuList) {
                    const firstElement = menuList.firstElementChild;
                    if (firstElement !== subscribeMenuItem) {
                        menuList.insertBefore(subscribeMenuItem, firstElement);
                    }
                    if (subscribeMenuItem.nextElementSibling !== registerMenuItem) {
                        menuList.insertBefore(registerMenuItem, subscribeMenuItem.nextElementSibling);
                    }
                    if (registerMenuItem.nextElementSibling !== guestLoginMenuItem) {
                        menuList.insertBefore(guestLoginMenuItem, registerMenuItem.nextElementSibling);
                    }
                }
            }
            // Logout button remains hidden for anonymous
        } else { // User is REGISTERED (not anonymous)
            logoutUserBtnItem.style.display = "block"; // Show logout for any registered user

            if (accessTier === "free_guest") {
                // REGISTERED FREE_GUEST: Show "Subscribe to Premium"
                subscribeMenuItem.style.display = "block"; // Or "list-item"
                // Log In button remains hidden for registered users
            } else if (accessTier && accessTier !== "free_guest") {
                // PAYING TIER: Show "Manage Subscription"
                manageSubscriptionMenuItem.style.display = "block"; // Or "list-item"
                // Subscribe and Log In remain hidden
            }
        }

        // --- Event Listeners ---

        // Event listener for "Subscribe to Premium" button
        const newSubscribeMenuItem = subscribeMenuItem.cloneNode(true);
        subscribeMenuItem.parentNode.replaceChild(newSubscribeMenuItem, subscribeMenuItem);
        newSubscribeMenuItem.addEventListener("click", function(e) {
            e.preventDefault();
            if (typeof closeUserMenu === 'function') closeUserMenu();
            if (typeof ensureAllScreensHidden === 'function') ensureAllScreensHidden();
            if (typeof showPaywallScreen === 'function') {
                showPaywallScreen();
            } else {
                console.error("showPaywallScreen function not found.");
            }
        });

        // Event listener for "Register Now" button
        const newRegisterMenuItem = registerMenuItem.cloneNode(true);
        registerMenuItem.parentNode.replaceChild(newRegisterMenuItem, registerMenuItem);
        newRegisterMenuItem.addEventListener("click", function(e) {
            e.preventDefault();
            if (typeof closeUserMenu === 'function') closeUserMenu();
            if (typeof window.showRegisterForm === 'function') {
                window.showRegisterForm();
            } else {
                console.error("showRegisterForm function not found.");
            }
        });

        // Event listener for "Log In" button (for anonymous users)
        const newGuestLoginMenuItem = guestLoginMenuItem.cloneNode(true);
        guestLoginMenuItem.parentNode.replaceChild(newGuestLoginMenuItem, guestLoginMenuItem);
        newGuestLoginMenuItem.addEventListener("click", function(e) {
            e.preventDefault();
            console.log("User menu 'Log In' clicked by anonymous user.");
            if (typeof closeUserMenu === 'function') closeUserMenu();
            // Assuming showLoginForm is globally available from app.js or auth-ui.js
            if (typeof window.showLoginForm === 'function') {
                window.showLoginForm();
            } else {
                console.error("showLoginForm function not found.");
            }
        });

        // The event listener for "Log Out" (logoutUserBtnItem) should be in app.js
        // as it's a more static button whose action doesn't change, only visibility.

    }

  } catch (error) {
    console.error("Error updating user menu (user.js):", error);
  }
}


// Get or generate a username
async function getOrGenerateUsername() {
  if (!auth || !auth.currentUser) {
    throw new Error("User not authenticated");
  }
  
  const uid = auth.currentUser.uid;
  const userDocRef = doc(db, 'users', uid);
  const userDocSnap = await getDoc(userDocRef);
  let username;
  if (userDocSnap.exists() && userDocSnap.data().username) {
    username = userDocSnap.data().username;
  } else {
    username = generateRandomName();
    // in user.v2.js -> getOrGenerateUsername
await runTransaction(db, async (transaction) => {
  // We don't need to get the document first if we are only setting one field.
  // The transaction ensures this is an atomic operation.
  transaction.update(userDocRef, { username: username });
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
  if (!auth || !auth.currentUser) {
    console.log("User not authenticated for getBookmarks");
    return [];
  }
  
  try {
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);
    if(userDocSnap.exists()){
      const data = userDocSnap.data();
      return data.bookmarks || [];
    }
  } catch (error) {
    console.error("Error getting bookmarks:", error);
  }
  return [];
}

// Replace the entire toggleBookmark function
async function toggleBookmark(questionId) {
  if (!auth || !auth.currentUser) {
    console.log("User not authenticated for toggleBookmark");
    return false;
  }

  // Optimistic UI update
  const currentSlide = document.querySelector(`.swiper-slide[data-id="${questionId}"]`);
  const isCurrentlyBookmarked = currentSlide ? currentSlide.dataset.bookmarked === "true" : false;
  const newBookmarkState = !isCurrentlyBookmarked;

  if (currentSlide) {
    currentSlide.dataset.bookmarked = newBookmarkState ? "true" : "false";
  }
  // This is imported from quiz.js, ensure it's available
  if (typeof window.updateBookmarkIcon === 'function') {
      window.updateBookmarkIcon();
  } else if (typeof updateBookmarkIcon === 'function') {
      updateBookmarkIcon();
  }


  try {
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);

    // Get current bookmarks from Firestore to ensure we have the latest state
    const userDoc = await getDoc(userDocRef);
    if (!userDoc.exists()) {
        console.error("User doc not found for bookmarking.");
        return false;
    }

    const data = userDoc.data();
    let bookmarks = data.bookmarks || [];
    const index = bookmarks.indexOf(questionId);

    if (newBookmarkState) { // If we want to add it
        if (index === -1) bookmarks.push(questionId);
    } else { // If we want to remove it
        if (index > -1) bookmarks.splice(index, 1);
    }

    // Update through the secure Cloud Function
    if (updateUserProfileFunction) {
      await updateUserProfileFunction({ bookmarks: bookmarks });
      console.log(`Bookmark toggled for ${questionId}. New state: ${newBookmarkState}`);
    } else {
      throw new Error("updateUserProfileFunction is not available.");
    }

    return newBookmarkState;

  } catch (error) {
    console.error("Error toggling bookmark:", error);
    // Revert optimistic UI update on error
    if (currentSlide) {
        currentSlide.dataset.bookmarked = isCurrentlyBookmarked ? "true" : "false";
    }
    if (typeof window.updateBookmarkIcon === 'function') window.updateBookmarkIcon();
    else if (typeof updateBookmarkIcon === 'function') updateBookmarkIcon();
    
    return isCurrentlyBookmarked;
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
async function updateSpacedRepetitionData(questionId, isCorrect, difficulty) {
  if (!auth || !auth.currentUser) {
    console.log("User not authenticated, can't update spaced repetition data");
    return;
  }
  
  const uid = auth.currentUser.uid;
  const userDocRef = doc(db, 'users', uid);
  
  try {
    let finalInterval; // <<< FIX: Declare the variable OUTSIDE the transaction

    await runTransaction(db, async (transaction) => {
      const userDoc = await transaction.get(userDocRef);
      let data = userDoc.exists() ? userDoc.data() : {};
      
      // Initialize spacedRepetition object if it doesn't exist
      if (!data.spacedRepetition) {
        data.spacedRepetition = {};
      }
      
      // Define default intervals
      let intervals = { hard: 1, medium: 3, easy: 7 };

      // Check for and use user's custom settings if they exist
      if (data.spacedRepetitionSettings) {
          intervals.hard = data.spacedRepetitionSettings.hardInterval || 1;
          intervals.medium = data.spacedRepetitionSettings.mediumInterval || 3;
          intervals.easy = data.spacedRepetitionSettings.easyInterval || 7;
      }

      // Calculate next review interval based on difficulty and correctness
      finalInterval = intervals.hard; // <<< FIX: ASSIGN value, don't re-declare with 'let'
      if (isCorrect) {
          if (difficulty === 'easy') finalInterval = intervals.easy;
          else if (difficulty === 'medium') finalInterval = intervals.medium;
          else if (difficulty === 'hard') finalInterval = intervals.hard;
      }

      // Calculate the next review date
      const now = new Date();
      const nextReviewDate = new Date();
      nextReviewDate.setDate(now.getDate() + finalInterval);
      
      // Update or create the question's spaced repetition data
      data.spacedRepetition[questionId] = {
        lastReviewedAt: now.toISOString(),
        nextReviewDate: nextReviewDate.toISOString(),
        reviewInterval: finalInterval,
        difficulty: difficulty,
        lastResult: isCorrect ? 'correct' : 'incorrect',
        reviewCount: (data.spacedRepetition[questionId]?.reviewCount || 0) + 1
      };
      
      // Update the user document
      transaction.update(userDocRef, {
        spacedRepetition: data.spacedRepetition
      });
    });

    console.log(`Spaced repetition data updated for question ${questionId}`);
    return finalInterval; // <<< FIX: This will now work correctly
    
  } catch (error) {
    console.error("Error updating spaced repetition data:", error);
    return 1; // Return a default value in case of an error
  }
}

// Make the function available globally
window.updateSpacedRepetitionData = updateSpacedRepetitionData;

// Function to fetch user's spaced repetition data
async function fetchSpacedRepetitionData() {
  if (!auth || !auth.currentUser) {
    console.log("User not authenticated yet");
    return null;
  }
  
  try {
    const uid = auth.currentUser.uid;
    const userDocRef = doc(db, 'users', uid);
    const userDocSnap = await getDoc(userDocRef);
    
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

// --- Step 8: Function to Record CME Answers and Update Stats ---

/* =========================================================
   CME CREDIT CONFIG  — FINAL (22 May 2025)
   ========================================================= */
   const MINUTES_PER_QUESTION       = 4.8;   // committee-validated
   const MINUTES_PER_QUARTER_CREDIT = 15;    // 0.25 credit = 15 min
   const ACCURACY_THRESHOLD         = 0.70;  // ≥ 70 % overall accuracy
   const MAX_CME_CREDITS            = 24.0;  // 300 Qs → 1 440 min → 24 cr
   
   // --- Step 8: Function to Record CME Answers and Update Stats ---

   async function recordCmeAnswer(questionId, category, isCorrect, timeSpent) {
    if (!auth || !auth.currentUser || auth.currentUser.isAnonymous) {
      console.log("User not authenticated or is guest; CME answer not submitted to CF.");
      // Optionally, you could prompt the user to log in/register here if CME is a core feature they're trying to access.
      return;
    }
  
    if (!recordCmeAnswerFunction) {
      console.error("recordCmeAnswer Cloud Function reference (for recordCmeAnswerV2) is not available. Cannot record CME answer.");
      alert("There was a problem connecting to the CME recording service. Please try again later or contact support if the issue persists.");
      return;
    }
  
    const uid = auth.currentUser.uid;
    console.log(`Calling Cloud Function (target: recordCmeAnswerV2) for user ${uid}, QID: ${questionId.substring(0,50)}...`);
  
    try {
      const dataToSend = {
        questionId: questionId, // This is the full question text
        category: category,
        isCorrect: isCorrect,
        timeSpent: timeSpent, // timeSpent is sent, though the new CF doesn't currently use it.
      };
  
      const result = await recordCmeAnswerFunction(dataToSend);
      const cfResponse = result.data;
  
      console.log("Cloud Function 'recordCmeAnswerV2' raw response:", JSON.stringify(cfResponse, null, 2));
  
      if (cfResponse) {
        // --- STORE activeYearId from response ---
        if (cfResponse.activeYearId && typeof window.setActiveCmeYearClientSide === 'function') {
          window.setActiveCmeYearClientSide(cfResponse.activeYearId);
          console.log(`Client-side active CME year updated to: ${cfResponse.activeYearId}`);
        } else if (cfResponse.activeYearId === null && cfResponse.status === "no_active_year") {
          // If CF explicitly says no active year, clear client-side cache too
          if (typeof window.setActiveCmeYearClientSide === 'function') window.setActiveCmeYearClientSide(null);
        }
        // --- END STORE ---
  
        // Log the detailed response from the Cloud Function
        console.log(
          `CME CF Response Details:
          Status: ${cfResponse.status}
          Message: ${cfResponse.message}
          Active Year ID: ${cfResponse.activeYearId || 'N/A'}
          Credits This Answer: ${cfResponse.creditedThisAnswer !== undefined ? cfResponse.creditedThisAnswer.toFixed(2) : 'N/A'}
          New Year Total Credits: ${cfResponse.newYearTotalCredits !== undefined ? cfResponse.newYearTotalCredits.toFixed(2) : 'N/A'}
          Total Answered In Year: ${cfResponse.totalAnsweredInYear !== undefined ? cfResponse.totalAnsweredInYear : 'N/A'}
          Overall Credits Earned: ${cfResponse.overallCreditsEarned !== undefined ? cfResponse.overallCreditsEarned.toFixed(2) : 'N/A'}
          Overall Total Answered: ${cfResponse.overallTotalAnswered !== undefined ? cfResponse.overallTotalAnswered : 'N/A'}
          Overall Total Correct: ${cfResponse.overallTotalCorrect !== undefined ? cfResponse.overallTotalCorrect : 'N/A'}`
        );
  
        // Handle specific statuses for user feedback
        switch (cfResponse.status) {
          case "tier_ineligible":
            // alert(`CME Credits: ${cfResponse.message}`); // OLD: Show alert
            console.log(`CME Credits (Info): ${cfResponse.message} (User tier not eligible, no alert shown)`); // NEW: Log to console instead of alert
            break;
          case "no_active_year":
            // alert(`CME Credits: ${cfResponse.message}`); // Inform user about no active year
            console.log(`CME Credits (no active year): ${cfResponse.message}`);
            break;
          case "success":
          case "already_correct":
          case "still_incorrect":
          case "limit_reached":
          case "accuracy_low":
          case "no_change":
            // For these statuses, the CF message is usually sufficient for console.
            // The main action is to refresh the dashboard.
            // You could add a more subtle UI notification here if desired, instead of an alert.
            console.log(`CME Update: ${cfResponse.message}`);
            break;
          default:
            console.warn("CME recording: Received an unexpected status from CF: ", cfResponse.status, cfResponse.message);
            // alert(`Received an unexpected response from CME service: ${cfResponse.status}`);
            break;
        }
  
        // Refresh dashboards to reflect any changes in CME stats.
        // These functions should fetch the latest data from Firestore.
        if (typeof window.loadCmeDashboardData === 'function') {
           console.log("Refreshing CME dashboard data after CF call...");
           window.loadCmeDashboardData();
        }
        // Also refresh the main dashboard if it's visible, as it might show overall CME stats too
        if (typeof window.initializeDashboard === 'function') {
            const mainOptionsEl = document.getElementById('mainOptions');
            if (mainOptionsEl && mainOptionsEl.style.display !== 'none') {
                console.log("Refreshing main dashboard data after CF call...");
                window.initializeDashboard();
            }
        }
  
      } else {
        console.error("Cloud Function 'recordCmeAnswerV2' returned undefined or no data in result.data.");
        alert("Received an incomplete response from the CME recording service. Please try again.");
      }
    } catch (error) {
      console.error("Error calling 'recordCmeAnswerV2' Cloud Function:", error);
      let alertMessage = `An error occurred while recording your CME answer. Please try again.`;
      if (error.code && error.message) { // Firebase HttpsError
        alertMessage = `Error: ${error.message}`;
        if (error.details) { // v2 HttpsError might not have 'details' in the same way as v1
          alertMessage += ` (Details: ${JSON.stringify(error.details)})`;
        }
      } else if (error.message) { // Generic error
        alertMessage = error.message;
      }
      alert(alertMessage);
    }
  }
// --- End of new recordCmeAnswer function ---
   // --- End of Step 8 ---
   

// NEW FUNCTION to save onboarding selections
async function saveOnboardingSelections(specialty, experienceLevel, username) {
  if (!auth || !auth.currentUser) {
    console.error("User not authenticated. Cannot save onboarding selections.");
    // Potentially throw an error or handle this case, though in onboarding,
    // an anonymous user should have been created by now by auth.js.
    return;
  }

  const uid = auth.currentUser.uid;
  const userDocRef = doc(db, 'users', uid);

  const dataToSave = {
    username: username,
    specialty: specialty,
    experienceLevel: experienceLevel,
    onboardingCompletedAt: serverTimestamp(), // Mark when these were saved
    updatedAt: serverTimestamp() // Good practice to update this timestamp
  };

  try {
    // Check if the document exists.
    // While onAuthStateChanged in auth.js usually creates the doc for anon users,
    // this onboarding step might happen very quickly for a brand new anon user.
    const userDocSnap = await getDoc(userDocRef);

    if (!userDocSnap.exists()) {
      // Document doesn't exist, so we're creating it with these onboarding details
      // and some essential defaults. auth.js will later merge/update if needed.
      console.log(`User doc for ${uid} (anonymous) not found during onboarding save. Creating with onboarding data.`);
      // SLIM WRITE: Only write non-sensitive fields. The backend will add defaults.
      await setDoc(userDocRef, {
        ...dataToSave,
        email: null,
        createdAt: serverTimestamp(),
        // --- SENSITIVE FIELDS REMOVED ---
        // isRegistered, accessTier, etc., will be set by a Cloud Function.
        stats: { xp: 0, level: 1, totalAnswered: 0, totalCorrect: 0 },
        bookmarks: [],
        cmeStats: { creditsEarned: 0, creditsClaimed: 0, totalAnswered: 0, totalCorrect: 0 },
      });
      console.log("New user document created with onboarding selections for UID:", uid);
    } else {
      // Document exists, merge the new data
      await setDoc(userDocRef, dataToSave, { merge: true });
      console.log("Onboarding selections saved for existing UID:", uid, dataToSave);
    }

    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        const needsUpdate = currentUser.displayName !== username;
        if (needsUpdate) {
          await updateProfile(currentUser, { displayName: username });
          console.log("Firebase Auth displayName updated to onboarding username for UID:", uid);
        }
      } catch (profileErr) {
        console.warn("Unable to update Firebase Auth displayName during onboarding save:", profileErr);
      }

      if (updateUserProfileFunction && !currentUser.isAnonymous) {
        try {
          await updateUserProfileFunction({
            username,
            specialty,
            experienceLevel
          });
          console.log("Server-side profile synced with onboarding selections for UID:", uid);
        } catch (callableErr) {
          console.warn("updateUserProfileFunction failed during onboarding save:", callableErr);
        }
      }
    }

    if (window.authState) {
      window.authState.username = username;
      if (window.authState.user) {
        window.authState.user.displayName = username;
      }
    }
    if (typeof window.updateUserMenuInfo === "function") {
      try {
        await window.updateUserMenuInfo(window.authState);
      } catch (updateErr) {
        console.warn("updateUserMenuInfo failed after onboarding save:", updateErr);
      }
    }
  } catch (error) {
    console.error("Error saving onboarding selections to Firestore:", error);
    // Optionally, re-throw the error to be handled by the caller in app.js
    throw error;
  }
}

// Function to record which choice was selected for peer statistics
async function recordChoiceSelection(questionId, selectedChoice) {
  if (!auth.currentUser || !db) return;
  
  try {
    const choiceStatsRef = doc(db, 'choiceStats', questionId);
    const choiceField = `choice${selectedChoice}`;
    
    await runTransaction(db, async (transaction) => {
      const statsDoc = await transaction.get(choiceStatsRef);
      
      if (statsDoc.exists()) {
        const currentCount = statsDoc.data()[choiceField] || 0;
        const currentTotal = statsDoc.data().totalResponses || 0;
        transaction.update(choiceStatsRef, {
          [choiceField]: currentCount + 1,
          totalResponses: currentTotal + 1
        });
      } else {
        transaction.set(choiceStatsRef, {
          choiceA: selectedChoice === 'A' ? 1 : 0,
          choiceB: selectedChoice === 'B' ? 1 : 0,
          choiceC: selectedChoice === 'C' ? 1 : 0,
          choiceD: selectedChoice === 'D' ? 1 : 0,
          choiceE: selectedChoice === 'E' ? 1 : 0,
          totalResponses: 1
        });
      }
    });
  } catch (error) {
    console.error("Error recording choice selection:", error);
  }
}

// NEW FUNCTION to save profile changes
async function saveProfileChanges() {
  // Get elements from the modal
  const usernameInput = document.getElementById('editUsername');
  const experienceSelect = document.getElementById('editExperienceLevel');
  const saveButton = document.getElementById('saveProfileChangesBtn');
  const messageEl = document.getElementById('editProfileMessage');
  const hapticsToggle = document.getElementById('editHapticsToggle');

  // Get the new values
  const newUsername = usernameInput.value.trim();
  const newExperienceLevel = experienceSelect.value;

  // Get and parse interval values
  const hardInterval = parseInt(document.getElementById('editHardInterval').value, 10);
  const mediumInterval = parseInt(document.getElementById('editMediumInterval').value, 10);
  const easyInterval = parseInt(document.getElementById('editEasyInterval').value, 10);
  const hapticsEnabled = hapticsToggle ? hapticsToggle.checked : true;

  // --- 1. Client-Side Validation ---
  if (newUsername.length < 3) {
    messageEl.className = 'auth-error';
    messageEl.classList.remove('success');
    messageEl.textContent = 'Username must be at least 3 characters long.';
    return;
  }
  if (!newExperienceLevel) {
    messageEl.className = 'auth-error';
    messageEl.classList.remove('success');
    messageEl.textContent = 'Please select your experience level.';
    return;
  }

  // Validate intervals
  if (isNaN(hardInterval) || isNaN(mediumInterval) || isNaN(easyInterval) || hardInterval < 1 || mediumInterval < 1 || easyInterval < 1) {
    messageEl.className = 'auth-error';
    messageEl.classList.remove('success');
    messageEl.textContent = 'Intervals must be a number greater than 0.';
    return;
  }
  if (!(hardInterval < mediumInterval && mediumInterval < easyInterval)) {
    messageEl.className = 'auth-error';
    messageEl.classList.remove('success');
    messageEl.textContent = 'Intervals must be in increasing order (Hard < Medium < Easy).';
    return;
  }

  // --- 2. Set UI to Loading State ---
  saveButton.disabled = true;
  saveButton.textContent = 'Saving...';
  messageEl.textContent = '';
  messageEl.classList.remove('success');

  try {
    // --- 3. Call the Secure Cloud Function ---
    if (!updateUserProfileFunction) {
      throw new Error("Profile update service is not available.");
    }
    
    const profilePayload = {
      username: newUsername,
      experienceLevel: newExperienceLevel,
      spacedRepetitionSettings: {
        hardInterval: hardInterval,
        mediumInterval: mediumInterval,
        easyInterval: easyInterval
      },
      hapticsEnabled
    };
    
    await updateUserProfileFunction(profilePayload);

    // --- 4. Handle Success ---
    // Update the "View Mode" fields with the new data
    document.getElementById('viewUsername').textContent = newUsername;
    document.getElementById('viewExperienceLevel').textContent = newExperienceLevel;
    // Update the interval displays in View Mode
    document.getElementById('viewHardInterval').textContent = hardInterval;
    document.getElementById('viewMediumInterval').textContent = mediumInterval;
    document.getElementById('viewEasyInterval').textContent = easyInterval;
    const viewHapticsStatusEl = document.getElementById('viewHapticsStatus');
    if (viewHapticsStatusEl) {
      viewHapticsStatusEl.textContent = hapticsEnabled ? 'On' : 'Off';
    }
    setHapticsEnabled(hapticsEnabled);
    if (window.authState) {
      window.authState.hapticsEnabled = hapticsEnabled;
    }

    // Manually trigger the username update in the user menu.
    // We need to get the latest auth state to pass to the function.
    if (window.authState && typeof updateUserMenuInfo === 'function') {
      // We need to manually update the displayName in the authState object
      // so that updateUserMenuInfo has the latest info to display.
      window.authState.user.displayName = newUsername;
      updateUserMenuInfo(window.authState);
    }

    // Show success message and switch back to view mode
    messageEl.textContent = 'Settings updated successfully!';
    messageEl.classList.add('success');
    
    // Switch back to view mode after a short delay
    setTimeout(() => {
      document.getElementById('profileViewMode').style.display = 'block';
      document.getElementById('profileEditMode').style.display = 'none';
      document.getElementById('editProfileTitle').textContent = 'Account Settings';
      // Clear the success message after another delay
      setTimeout(() => {
        messageEl.textContent = '';
        messageEl.classList.remove('success');
      }, 2000);
    }, 1000);

  } catch (error) {
    // --- 5. Handle Errors ---
    console.error("Error saving profile changes:", error);
    messageEl.className = 'auth-error';
    messageEl.textContent = error.message || "An unknown error occurred.";
    messageEl.classList.remove('success');
  } finally {
    // --- 6. Reset Button State ---
    saveButton.disabled = false;
    saveButton.textContent = 'Save Changes';
  }
}

async function maybeShowIosReviewPrompt() {
  if (!isIosNativeApp()) {
    return;
  }

  const appReviewPlugin = getAppReviewPlugin();
  if (!appReviewPlugin || typeof appReviewPlugin.requestReview !== 'function') {
    console.warn("App Review plugin is unavailable; cannot request review.");
    return;
  }

  try {
    await appReviewPlugin.requestReview();
  } catch (error) {
    console.error("Unable to present the iOS review prompt:", error);
  }
}

export {
  fetchPersistentAnsweredIds,
  recordAnswer,
  calculateLevel,
  calculateLevelProgress,
  getLevelInfo,
  updateQuestionStats, // Although maybe only called internally or from quiz.js? Include if needed elsewhere.
  updateUserXP,
  showBonusMessages,
  updateUserMenu,
  getOrGenerateUsername,
  generateRandomName, // Usually internal, but export if needed elsewhere
  getBookmarks,
  toggleBookmark,
  showLevelUpAnimation,
  hideLevelUpModal,
  createConfetti,
  updateSpacedRepetitionData,
  fetchSpacedRepetitionData,
  recordCmeAnswer, // <<<--- Make sure to include the CME function we added!
  saveOnboardingSelections,
  recordChoiceSelection,
  saveProfileChanges
};

window.saveProfileChanges = saveProfileChanges;

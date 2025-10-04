// Define csvUrl globally so all functions can access it
//const csvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ85bci-l8eImMlvV2Vw8LqnTpmSVoTqbZFscvQ5w6ptGZzb5q1DLyeFS7uIqoLtEw4lXLQohCfofXd/pub?output=csv";

// Global filter mode
window.filterMode = "all";

// Shuffle array (randomize item order)
function shuffleArray(array) {
  if (!array || !Array.isArray(array)) {
    return [];
  }
  return array.sort(() => Math.random() - 0.5);
}

// Get current question id from the active slide
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

// Helper function to get the start of the week (for weekly leaderboards)
function getStartOfWeek() {
  let now = new Date();
  let day = now.getDay();
  let diff = now.getDate() - day + (day === 0 ? -6 : 1);
  let weekStart = new Date(now.setDate(diff));
  weekStart.setHours(0,0,0,0);
  return weekStart.getTime();
}

// Generate HTML for leaderboard tabs
function leaderboardTabsHTML(activeTab) {
  return `
    <div id="leaderboardTabs">
      <button class="leaderboard-tab ${activeTab === 'overall' ? 'active' : ''}" id="overallTab">XP Rankings</button>
      <button class="leaderboard-tab ${activeTab === 'streaks' ? 'active' : ''}" id="streaksTab">Longest Streaks</button>
      <button class="leaderboard-tab ${activeTab === 'answered' ? 'active' : ''}" id="answeredTab">Total Answered</button>
    </div>
  `;
}

// Close the side menu (left)
function closeSideMenu() {
  const sideMenu = document.getElementById("sideMenu");
  const menuOverlay = document.getElementById("menuOverlay");
  
  if (sideMenu) sideMenu.classList.remove("open");
  if (menuOverlay) menuOverlay.classList.remove("show");
}

// Close the user menu (right)
function closeUserMenu() {
  const userMenu = document.getElementById("userMenu");
  const menuOverlay = document.getElementById("menuOverlay");
  
  if (userMenu) userMenu.classList.remove("open");
  if (menuOverlay) menuOverlay.classList.remove("show");
}

// Reset favorite icon for new questions
async function updateFavoriteIcon() {
  let favoriteButton = document.getElementById("favoriteButton");
  if (favoriteButton) {
    favoriteButton.innerText = "☆";
    favoriteButton.style.color = "";
  }
}
// utils.js - BOTTOM OF FILE
export {
  shuffleArray, // Export other utils if needed
  getCurrentQuestionId, // Export other utils if needed
  getStartOfWeek, // Export other utils if needed
  leaderboardTabsHTML, // Export other utils if needed
  closeSideMenu, // Export other utils if needed
  closeUserMenu, // Export other utils if needed
  updateFavoriteIcon // Export other utils if needed
  // Add any other functions/variables from utils.js needed elsewhere
};

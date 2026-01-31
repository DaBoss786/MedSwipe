// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';

vi.mock('./firebase-config.js', () => ({
  app: {},
  auth: { currentUser: null },
  db: {},
  doc: vi.fn(),
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  collection: vi.fn(),
  getDocs: vi.fn(),
  getIdToken: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  functions: {},
  httpsCallable: vi.fn(() => vi.fn()),
  updateDoc: vi.fn(),
  addDoc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onAuthStateChanged: vi.fn(() => () => {}),
  setDoc: vi.fn()
}));

vi.mock('./analytics.js', () => ({
  logAnalyticsEvent: vi.fn(),
  setAnalyticsUserProperties: vi.fn()
}));

vi.mock('./auth.js', () => ({
  generateGuestUsername: vi.fn(() => 'guest-user')
}));

vi.mock('./user.v2.js', () => ({
  updateUserXP: vi.fn(),
  updateUserMenu: vi.fn(),
  calculateLevelProgress: vi.fn(),
  getLevelInfo: vi.fn(),
  toggleBookmark: vi.fn(),
  saveOnboardingSelections: vi.fn(),
  fetchPersistentAnsweredIds: vi.fn()
}));

vi.mock('./quiz.js', () => ({
  loadQuestions: vi.fn(),
  initializeQuiz: vi.fn(),
  fetchQuestionBank: vi.fn()
}));

vi.mock('./ui.js', () => ({
  showLeaderboard: vi.fn(),
  showAbout: vi.fn(),
  showFAQ: vi.fn(),
  showContactModal: vi.fn()
}));

vi.mock('./utils.js', () => ({
  closeSideMenu: vi.fn(),
  closeUserMenu: vi.fn(),
  shuffleArray: vi.fn((items) => items),
  getCurrentQuestionId: vi.fn()
}));

vi.mock('./stats.js', () => ({
  displayPerformance: vi.fn()
}));

vi.mock('./billing-service.js', () => ({
  initialize: vi.fn(),
  startBoardReviewCheckout: vi.fn(),
  startCmeCheckout: vi.fn(),
  restorePurchases: vi.fn()
}));

vi.mock('./haptics.js', () => ({
  playTap: vi.fn(),
  playLight: vi.fn()
}));

vi.mock('./platform.js', () => ({
  detectNativeApp: vi.fn(() => false)
}));

const baseDom = `
  <div id="welcomeScreen" style="display:none; opacity:0;"></div>
  <div id="mainOptions" style="display:none;"></div>
  <div id="loginScreen" style="display:none;"></div>
  <div id="splashScreen" style="display:none;"></div>
  <div id="postRegistrationLoadingScreen" style="display:none;"></div>
  <div id="xpDisplay">999 XP</div>
  <div id="dashboardXP">999 XP</div>
  <div id="userXpDisplay">999 XP</div>
  <div id="scoreCircle">99</div>
  <div id="dashboardLevel">99</div>
  <div id="userScoreCircle">99</div>
  <div id="levelCircleProgress" style="--progress: 50%;"></div>
  <div id="dashboardLevelProgress" style="--progress: 50%;"></div>
  <div id="userLevelProgress" style="--progress: 50%;"></div>
  <div id="levelProgressBar" style="width: 50%;"></div>
  <div id="dashboardAnswered">12</div>
  <div id="dashboardAccuracy">85%</div>
  <div id="currentStreak">7</div>
`;

const resetUiState = () => {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (welcomeScreen) {
    welcomeScreen.style.display = 'none';
    welcomeScreen.style.opacity = '0';
  }

  const mainOptions = document.getElementById('mainOptions');
  if (mainOptions) {
    mainOptions.style.display = 'none';
  }

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  setText('xpDisplay', '999 XP');
  setText('dashboardXP', '999 XP');
  setText('userXpDisplay', '999 XP');
  setText('scoreCircle', '99');
  setText('dashboardLevel', '99');
  setText('userScoreCircle', '99');
  setText('dashboardAnswered', '12');
  setText('dashboardAccuracy', '85%');
  setText('currentStreak', '7');

  const setProgress = (id) => {
    const el = document.getElementById(id);
    if (el?.style?.setProperty) {
      el.style.setProperty('--progress', '50%');
    }
  };

  setProgress('levelCircleProgress');
  setProgress('dashboardLevelProgress');
  setProgress('userLevelProgress');
  setProgress('levelProgressBar');
};

const dispatchAuthStateChanged = (detail) => {
  window.dispatchEvent(new CustomEvent('authStateChanged', { detail }));
};

beforeAll(async () => {
  document.body.innerHTML = baseDom;

  globalThis.userHasAnyPremiumAccess = () => false;
  globalThis.hidePaywallScreen = vi.fn();
  globalThis.showDashboard = vi.fn(() => {
    const mainOptions = document.getElementById('mainOptions');
    if (mainOptions) {
      mainOptions.style.display = 'flex';
    }
  });

  await import('./app.js');
  document.dispatchEvent(new Event('DOMContentLoaded'));
});

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  localStorage.clear();
  resetUiState();
  delete window.authState;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

afterAll(() => {
  document.body.innerHTML = '';
  delete globalThis.userHasAnyPremiumAccess;
  delete globalThis.hidePaywallScreen;
  delete globalThis.showDashboard;
});

describe('authStateChanged handler', () => {
  it('updates window.authState', () => {
    const detail = {
      isLoading: true,
      isRegistered: false,
      accessTier: 'free_guest',
      user: null
    };

    dispatchAuthStateChanged(detail);

    expect(window.authState).toEqual(detail);
  });

  it('triggers routing when loading completes', () => {
    const detail = {
      isLoading: false,
      isRegistered: true,
      accessTier: 'free_guest',
      hasProgress: false,
      user: { isAnonymous: false }
    };

    dispatchAuthStateChanged(detail);

    const welcomeScreen = document.getElementById('welcomeScreen');
    const mainOptions = document.getElementById('mainOptions');

    expect(welcomeScreen?.style.display).toBe('flex');
    expect(mainOptions?.style.display).toBe('none');
  });

  it('runs cleanup for anonymous, unregistered users', () => {
    localStorage.setItem('quizProgress', 'cached-data');

    const detail = {
      isLoading: true,
      isRegistered: false,
      user: { isAnonymous: true }
    };

    dispatchAuthStateChanged(detail);

    const xpDisplay = document.getElementById('xpDisplay');

    expect(localStorage.getItem('quizProgress')).toBeNull();
    expect(xpDisplay?.textContent).toBe('0 XP');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

let handleUserRouting;

const setupDom = () => {
  document.body.innerHTML = `
    <div id="mainOptions" style="display:none"></div>
    <div id="welcomeScreen" style="display:none"></div>
    <div id="loginScreen" style="display:none"></div>
    <div id="splashScreen" style="display:none"></div>
  `;
};

const route = (authState) => {
  window.authState = { ...authState };
  handleUserRouting(authState);
};

beforeEach(async () => {
  vi.useFakeTimers();
  window.alert = vi.fn();
  sessionStorage.clear();
  setupDom();
  globalThis.userHasAnyPremiumAccess = () => {
    const state = window.authState || {};
    if (state.boardReviewActive) return true;
    if (state.cmeSubscriptionActive) return true;
    if (state.accessTier === 'board_review' || state.accessTier === 'cme_annual') return true;
    if (state.boardReviewTier === 'Granted by CME Annual') return true;
    if (Number(state.cmeCreditsAvailable || 0) > 0) return true;
    return false;
  };
  globalThis.hidePaywallScreen = vi.fn();
  globalThis.showDashboard = () => {
    const mainOptions = document.getElementById('mainOptions');
    if (mainOptions) {
      mainOptions.style.display = 'flex';
    }
  };
  const module = await import('./app.js');
  handleUserRouting = module.handleUserRouting;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
  delete window.authState;
  delete globalThis.userHasAnyPremiumAccess;
  delete globalThis.hidePaywallScreen;
  delete globalThis.showDashboard;
});

describe('handleUserRouting routing decisions', () => {
  it('registered + premium access → dashboard shown', () => {
    route({ isRegistered: true, accessTier: 'board_review', hasProgress: false });

    expect(document.getElementById('mainOptions').style.display).toBe('flex');
    expect(document.getElementById('welcomeScreen').style.display).toBe('none');
  });

  it('registered + no premium + has progress → dashboard shown', () => {
    route({ isRegistered: true, accessTier: 'free_guest', hasProgress: true });

    expect(document.getElementById('mainOptions').style.display).toBe('flex');
    expect(document.getElementById('welcomeScreen').style.display).toBe('none');
  });

  it('registered + no premium + no progress → welcome screen shown', () => {
    route({ isRegistered: true, accessTier: 'free_guest', hasProgress: false });

    expect(document.getElementById('welcomeScreen').style.display).toBe('flex');
    expect(document.getElementById('welcomeScreen').style.opacity).toBe('1');
    expect(document.getElementById('mainOptions').style.display).toBe('none');
  });

  it('anonymous + has progress → dashboard shown', () => {
    route({ isRegistered: false, accessTier: 'free_guest', hasProgress: true });

    expect(document.getElementById('mainOptions').style.display).toBe('flex');
    expect(document.getElementById('welcomeScreen').style.display).toBe('none');
  });

  it('anonymous + no progress → welcome screen shown', () => {
    route({ isRegistered: false, accessTier: 'free_guest', hasProgress: false });

    expect(document.getElementById('welcomeScreen').style.display).toBe('flex');
    expect(document.getElementById('welcomeScreen').style.opacity).toBe('1');
    expect(document.getElementById('mainOptions').style.display).toBe('none');
  });
});

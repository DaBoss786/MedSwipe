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

const setupDom = () => {
  document.body.innerHTML = `
    <div id="mainOptions" style="display:none"></div>
    <div id="welcomeScreen" style="display:none"></div>
    <div id="loginScreen" style="display:none"></div>
    <div id="splashScreen" style="display:none"></div>
    <div id="boardReviewPricingScreen" style="display:none"></div>
    <div id="cmePricingScreen" style="display:none"></div>
  `;
};

let setPendingDeepLink;
let clearPendingDeepLink;
let setDeepLinkRoutingHandlers;
let resetDeepLinkRoutingHandlers;

beforeEach(async () => {
  vi.useFakeTimers();
  window.alert = vi.fn();
  sessionStorage.clear();
  setupDom();
  globalThis.userHasAnyPremiumAccess = vi.fn(() => false);
  globalThis.hidePaywallScreen = vi.fn();
  globalThis.showDashboard = vi.fn();
  globalThis.forceReinitializeDashboard = vi.fn();
  globalThis.initializeDashboard = vi.fn();
  globalThis.updateUserMenu = vi.fn();
  globalThis.updateUserXP = vi.fn();
  window.hideSubscriptionActivationOverlay = vi.fn();

  const module = await import('./app.js');
  setDeepLinkRoutingHandlers = module.__setDeepLinkRoutingHandlers;
  resetDeepLinkRoutingHandlers = module.__resetDeepLinkRoutingHandlers;
  setPendingDeepLink = window.setPendingDeepLink;
  clearPendingDeepLink = window.clearPendingDeepLink;
});

afterEach(() => {
  if (typeof resetDeepLinkRoutingHandlers === 'function') {
    resetDeepLinkRoutingHandlers();
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
  delete window.authState;
  delete window.pendingDeepLinkQuestionId;
  delete window.isDeepLinkQuizActive;
  delete globalThis.userHasAnyPremiumAccess;
  delete globalThis.hidePaywallScreen;
  delete globalThis.showDashboard;
  delete globalThis.forceReinitializeDashboard;
  delete globalThis.initializeDashboard;
  delete globalThis.updateUserMenu;
  delete globalThis.updateUserXP;
  delete window.hideSubscriptionActivationOverlay;
});

describe('deep-link state handling', () => {
  it('setPendingDeepLink(questionId) sets pending id and active flag', () => {
    setPendingDeepLink('question-123');

    expect(window.pendingDeepLinkQuestionId).toBe('question-123');
    expect(window.isDeepLinkQuizActive).toBe(true);
  });

  it.each([null, undefined])('setPendingDeepLink(%s) clears pending id and active flag', (value) => {
    setPendingDeepLink('question-abc');
    setPendingDeepLink(value);

    expect(window.pendingDeepLinkQuestionId).toBeNull();
    expect(window.isDeepLinkQuizActive).toBe(false);
  });

  it('clearPendingDeepLink({ reroute: false }) clears flags without routing', () => {
    const handleUserRouting = vi.fn();
    const queueDashboardRefresh = vi.fn();
    setDeepLinkRoutingHandlers({ handleUserRouting, queueDashboardRefresh });

    window.authState = { isRegistered: true };
    setPendingDeepLink('question-456');

    clearPendingDeepLink({ reroute: false });

    expect(window.pendingDeepLinkQuestionId).toBeNull();
    expect(window.isDeepLinkQuizActive).toBe(false);
    expect(handleUserRouting).not.toHaveBeenCalled();
    expect(queueDashboardRefresh).not.toHaveBeenCalled();
  });

  it('clearPendingDeepLink() reroutes when authenticated', () => {
    const handleUserRouting = vi.fn();
    const queueDashboardRefresh = vi.fn();
    setDeepLinkRoutingHandlers({ handleUserRouting, queueDashboardRefresh });

    window.authState = { isRegistered: true, accessTier: 'board_review' };
    setPendingDeepLink('question-789');

    clearPendingDeepLink();

    expect(window.pendingDeepLinkQuestionId).toBeNull();
    expect(window.isDeepLinkQuizActive).toBe(false);
    expect(handleUserRouting).toHaveBeenCalledTimes(1);
    expect(handleUserRouting).toHaveBeenCalledWith(window.authState);
    expect(queueDashboardRefresh).toHaveBeenCalledTimes(1);
  });
});

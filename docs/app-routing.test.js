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
    <div id="newPaywallScreen" style="display:flex"></div>
    <div id="boardReviewPricingScreen" style="display:flex"></div>
    <div id="cmePricingScreen" style="display:flex"></div>
  `;
};

const paywallScreenIds = [
  'newPaywallScreen',
  'boardReviewPricingScreen',
  'cmePricingScreen'
];

const setPaywallScreensVisible = () => {
  paywallScreenIds.forEach((id) => {
    const screen = document.getElementById(id);
    if (screen) {
      screen.style.display = 'flex';
    }
  });
};

const expectPaywallScreensHidden = () => {
  paywallScreenIds.forEach((id) => {
    const screen = document.getElementById(id);
    expect(screen?.style.display).toBe('none');
  });
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
  globalThis.hidePaywallScreen = vi.fn(() => {
    const screen = document.getElementById('newPaywallScreen');
    if (screen) {
      screen.style.display = 'none';
    }
  });
  globalThis.showDashboard = () => {
    const mainOptions = document.getElementById('mainOptions');
    if (mainOptions) {
      mainOptions.style.display = 'flex';
    }
  };
  const module = await import('./app.js');
  handleUserRouting = module.handleUserRouting;
  const userModule = await import('./user.v2.js');
  window.updateUserMenu = userModule.updateUserMenu;
  window.updateUserXP = userModule.updateUserXP;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
  delete window.authState;
  delete window.hideSubscriptionActivationOverlay;
  delete globalThis.userHasAnyPremiumAccess;
  delete globalThis.hidePaywallScreen;
  delete globalThis.showDashboard;
  delete window.updateUserMenu;
  delete window.updateUserXP;
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

describe('handleUserRouting post-routing updates', () => {
  it.each([
    [
      'registered + premium',
      { isRegistered: true, accessTier: 'board_review', hasProgress: false }
    ],
    [
      'registered + no premium + progress',
      { isRegistered: true, accessTier: 'free_guest', hasProgress: true }
    ],
    [
      'registered + no premium + no progress',
      { isRegistered: true, accessTier: 'free_guest', hasProgress: false }
    ],
    [
      'anonymous + no progress',
      { isRegistered: false, accessTier: 'free_guest', hasProgress: false }
    ]
  ])('%s → updates user menu + XP', (_label, authState) => {
    route(authState);

    expect(window.updateUserMenu).toHaveBeenCalledTimes(1);
    expect(window.updateUserXP).toHaveBeenCalledTimes(1);
  });
});

describe('handleUserRouting premium routing effects', () => {
  it('registered + premium hides paywall screens + subscription overlay', () => {
    setPaywallScreensVisible();
    window.hideSubscriptionActivationOverlay = vi.fn();

    route({ isRegistered: true, accessTier: 'board_review', hasProgress: false });

    expectPaywallScreensHidden();
    expect(window.hideSubscriptionActivationOverlay).toHaveBeenCalledTimes(1);
  });

  it('anonymous + premium access → dashboard shown + paywalls hidden', () => {
    setPaywallScreensVisible();

    route({ isRegistered: false, accessTier: 'board_review', hasProgress: false });

    expect(document.getElementById('mainOptions').style.display).toBe('flex');
    expect(document.getElementById('welcomeScreen').style.display).toBe('none');
    expectPaywallScreensHidden();
  });
});

describe('handleUserRouting dashboard initialization paths', () => {
  it('registered + premium schedules force reinitialize dashboard', () => {
    route({ isRegistered: true, accessTier: 'board_review', hasProgress: false });

    expect(window.updateUserMenu).toHaveBeenCalledTimes(1);
    expect(window.updateUserXP).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);

    expect(window.updateUserMenu).toHaveBeenCalledTimes(2);
    expect(window.updateUserXP).toHaveBeenCalledTimes(2);
  });

  it('anonymous + progress schedules force reinitialize dashboard', () => {
    route({ isRegistered: false, accessTier: 'free_guest', hasProgress: true });

    expect(window.updateUserMenu).not.toHaveBeenCalled();
    expect(window.updateUserXP).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(window.updateUserMenu).toHaveBeenCalledTimes(1);
    expect(window.updateUserXP).toHaveBeenCalledTimes(1);
  });
});

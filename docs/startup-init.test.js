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

vi.mock('./revenuecat-native.js', () => ({
  initialize: vi.fn()
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
    <div id="splashScreen"></div>
    <div id="postRegistrationLoadingScreen" style="display:none"></div>
    <div id="welcomeScreen"></div>
    <div id="mainOptions"></div>
    <div id="onboardingLoadingScreen"></div>
  `;
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

let originalGetElementById;
let originalDocumentAddEventListener;
let originalDocumentRemoveEventListener;
let originalWindowAddEventListener;
let originalWindowRemoveEventListener;
let domContentLoadedHandlers = [];
let authStateHandlers = [];
let appModule;

beforeEach(() => {
  setupDom();
  domContentLoadedHandlers = [];
  authStateHandlers = [];
  originalGetElementById = document.getElementById.bind(document);
  document.getElementById = (id) => {
    const existing = originalGetElementById(id);
    if (existing) {
      return existing;
    }
    const fallback = document.createElement('div');
    fallback.id = id;
    document.body.appendChild(fallback);
    return fallback;
  };
  originalDocumentAddEventListener = document.addEventListener.bind(document);
  originalDocumentRemoveEventListener = document.removeEventListener.bind(document);
  document.addEventListener = (type, handler, options) => {
    if (type === 'DOMContentLoaded') {
      domContentLoadedHandlers.push(handler);
    }
    return originalDocumentAddEventListener(type, handler, options);
  };
  originalWindowAddEventListener = window.addEventListener.bind(window);
  originalWindowRemoveEventListener = window.removeEventListener.bind(window);
  window.addEventListener = (type, handler, options) => {
    if (type === 'authStateChanged') {
      authStateHandlers.push(handler);
    }
    return originalWindowAddEventListener(type, handler, options);
  };
  window.requestAnimationFrame = (cb) => {
    cb();
    return 0;
  };
  window.requestIdleCallback = (cb) => {
    cb();
    return 0;
  };
  globalThis.onboardingLoadingScreen = document.getElementById('onboardingLoadingScreen');
});

afterEach(() => {
  if (appModule?.__resetStartupInitDependencies) {
    appModule.__resetStartupInitDependencies();
  }
  if (appModule?.__setPendingOneSignalDeepLinkState) {
    appModule.__setPendingOneSignalDeepLinkState({ pending: [], processing: false });
  }
  appModule = null;
  if (originalGetElementById) {
    document.getElementById = originalGetElementById;
  }
  if (originalDocumentRemoveEventListener) {
    domContentLoadedHandlers.forEach((handler) => {
      originalDocumentRemoveEventListener('DOMContentLoaded', handler);
    });
  }
  if (originalWindowRemoveEventListener) {
    authStateHandlers.forEach((handler) => {
      originalWindowRemoveEventListener('authStateChanged', handler);
    });
  }
  if (originalDocumentAddEventListener) {
    document.addEventListener = originalDocumentAddEventListener;
  }
  if (originalWindowAddEventListener) {
    window.addEventListener = originalWindowAddEventListener;
  }
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
  delete window.authState;
  delete window.requestAnimationFrame;
  delete window.requestIdleCallback;
  delete window.isDeepLinkQuizActive;
  delete window.coldStartDeepLinkPending;
  delete globalThis.onboardingLoadingScreen;
});

const loadAppModule = async ({ isNative = false } = {}) => {
  const platform = await import('./platform.js');
  platform.detectNativeApp.mockReturnValue(isNative);
  appModule = await import('./app.js');
  return appModule;
};

describe('startup initialization orchestration', () => {
  it('schedules startup init tasks on DOMContentLoaded (web billing)', async () => {
    appModule = await loadAppModule({ isNative: false });

    const initializeOneSignalPush = vi.fn();
    const initializeOneSignalIdentityObservers = vi.fn();
    const handleQuestionDeepLink = vi.fn();

    appModule.__setStartupInitDependencies({
      initializeOneSignalPush,
      initializeOneSignalIdentityObservers,
      handleQuestionDeepLink
    });

    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushMicrotasks();

    const billing = await import('./billing-service.js');

    expect(initializeOneSignalPush).toHaveBeenCalledTimes(1);
    expect(initializeOneSignalIdentityObservers).toHaveBeenCalledTimes(1);
    expect(handleQuestionDeepLink).toHaveBeenCalledTimes(1);
    expect(billing.initialize).toHaveBeenCalledTimes(1);
  });

  it('selects RevenueCat native billing when running natively', async () => {
    appModule = await loadAppModule({ isNative: true });

    const initializeOneSignalPush = vi.fn();
    const initializeOneSignalIdentityObservers = vi.fn();
    const handleQuestionDeepLink = vi.fn();

    appModule.__setStartupInitDependencies({
      initializeOneSignalPush,
      initializeOneSignalIdentityObservers,
      handleQuestionDeepLink
    });

    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushMicrotasks();

    const billing = await import('./billing-service.js');
    const revenuecat = await import('./revenuecat-native.js');

    expect(revenuecat.initialize).toHaveBeenCalledTimes(1);
    expect(billing.initialize).not.toHaveBeenCalled();
  });

  it('fades splash screen only after auth loading completes and registration is done', async () => {
    vi.useFakeTimers();
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);

    appModule = await loadAppModule({ isNative: false });

    const handleUserRouting = vi.fn();
    const queueDashboardRefresh = vi.fn();

    appModule.__setStartupInitDependencies({
      initializeOneSignalPush: vi.fn(),
      initializeOneSignalIdentityObservers: vi.fn(),
      handleQuestionDeepLink: vi.fn(),
      handleUserRouting,
      queueDashboardRefresh
    });

    const splashScreen = document.getElementById('splashScreen');
    const registrationScreen = document.getElementById('postRegistrationLoadingScreen');

    document.dispatchEvent(new Event('DOMContentLoaded'));

    window.dispatchEvent(
      new CustomEvent('authStateChanged', { detail: { isLoading: true } })
    );
    vi.advanceTimersByTime(1500);
    expect(splashScreen.classList.contains('fade-out')).toBe(false);

    registrationScreen.style.display = 'flex';
    window.dispatchEvent(
      new CustomEvent('authStateChanged', { detail: { isLoading: false } })
    );
    vi.advanceTimersByTime(1500);
    expect(splashScreen.classList.contains('fade-out')).toBe(false);

    registrationScreen.style.display = 'none';
    window.dispatchEvent(
      new CustomEvent('authStateChanged', { detail: { isLoading: false } })
    );
    vi.advanceTimersByTime(1000);
    expect(splashScreen.classList.contains('fade-out')).toBe(true);

    nowSpy.mockRestore();
  });

  it('defers routing when a OneSignal deep link is pending', async () => {
    appModule = await loadAppModule({ isNative: false });

    const handleUserRouting = vi.fn();
    const queueDashboardRefresh = vi.fn();
    const processPendingOneSignalDeepLinks = vi.fn();

    appModule.__setStartupInitDependencies({
      initializeOneSignalPush: vi.fn(),
      initializeOneSignalIdentityObservers: vi.fn(),
      handleQuestionDeepLink: vi.fn(),
      handleUserRouting,
      queueDashboardRefresh,
      processPendingOneSignalDeepLinks
    });

    appModule.__setPendingOneSignalDeepLinkState({
      pending: ['/question/abc'],
      processing: false
    });

    document.dispatchEvent(new Event('DOMContentLoaded'));

    window.dispatchEvent(
      new CustomEvent('authStateChanged', { detail: { isLoading: false } })
    );

    expect(handleUserRouting).not.toHaveBeenCalled();
    expect(queueDashboardRefresh).not.toHaveBeenCalled();
    expect(processPendingOneSignalDeepLinks).toHaveBeenCalledTimes(1);
  });

  it('defers routing when a deep-link quiz is active', async () => {
    appModule = await loadAppModule({ isNative: false });

    const handleUserRouting = vi.fn();
    const queueDashboardRefresh = vi.fn();

    appModule.__setStartupInitDependencies({
      initializeOneSignalPush: vi.fn(),
      initializeOneSignalIdentityObservers: vi.fn(),
      handleQuestionDeepLink: vi.fn(),
      handleUserRouting,
      queueDashboardRefresh
    });

    appModule.__setPendingOneSignalDeepLinkState({
      pending: [],
      processing: false
    });

    document.dispatchEvent(new Event('DOMContentLoaded'));
    window.isDeepLinkQuizActive = true;

    window.dispatchEvent(
      new CustomEvent('authStateChanged', { detail: { isLoading: false } })
    );

    expect(handleUserRouting).not.toHaveBeenCalled();
    expect(queueDashboardRefresh).not.toHaveBeenCalled();
  });
});

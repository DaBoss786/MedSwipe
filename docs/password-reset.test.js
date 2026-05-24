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
  sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
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
    <div id="splashScreen"></div>
    <div id="welcomeScreen"></div>
    <div id="mainOptions"></div>
    <div id="postRegistrationLoadingScreen" style="display:none"></div>
    <div id="onboardingLoadingScreen"></div>
    <div id="loginScreen" style="display:flex">
      <form id="loginScreenForm">
        <input type="email" id="loginScreenEmail">
        <div id="emailError"></div>
        <div class="form-group">
          <input type="password" id="loginScreenPassword">
          <div id="passwordError"></div>
        </div>
        <button type="submit" id="loginScreenSubmit"></button>
        <a href="#" id="forgotPasswordLink">Forgot Password?</a>
      </form>
      <button type="button" id="passwordToggle"></button>
      <button type="button" id="loginBackButton"></button>
      <div id="loginLoader"></div>
      <div id="loginScreenError"></div>
    </div>
    <div id="forgotPasswordModal" class="modal" style="display:none">
      <form id="forgotPasswordForm">
        <input type="email" id="resetEmail">
        <div id="resetEmailError"></div>
        <div id="resetLoader"></div>
        <div id="resetMessage" class="reset-message"></div>
        <button type="submit" id="sendResetLinkBtn">Send Reset Link</button>
        <button type="button" id="cancelResetBtn">Cancel</button>
      </form>
    </div>
  `;
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

let originalGetElementById;
let originalConsoleError;

beforeEach(() => {
  setupDom();
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

  originalConsoleError = console.error;
  console.error = vi.fn();
  window.alert = vi.fn();
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
  document.getElementById = originalGetElementById;
  console.error = originalConsoleError;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.resetModules();
  document.body.innerHTML = '';
  delete window.alert;
  delete window.authState;
  delete window.requestAnimationFrame;
  delete window.requestIdleCallback;
  delete window.showForgotPasswordModal;
  delete window.hideForgotPasswordModal;
  delete globalThis.onboardingLoadingScreen;
});

describe('password reset flow', () => {
  it('opens the reset modal from the login screen without fallback alert noise', async () => {
    await import('./app.js');
    await import('./login-screen.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushMicrotasks();

    console.error.mockClear();

    document.getElementById('forgotPasswordLink').click();

    expect(window.alert).not.toHaveBeenCalled();
    expect(document.getElementById('forgotPasswordModal').style.display).toBe('flex');
    expect(console.error).not.toHaveBeenCalledWith('showForgotPasswordModal function not found');
  });

  it('submits Firebase password reset requests and shows success feedback', async () => {
    const firebase = await import('./firebase-config.js');
    await import('./app.js');
    await import('./login-screen.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await flushMicrotasks();

    document.getElementById('forgotPasswordLink').click();
    document.getElementById('resetEmail').value = 'resident@example.com';
    document.getElementById('forgotPasswordForm').dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    await flushMicrotasks();

    expect(firebase.sendPasswordResetEmail).toHaveBeenCalledWith(
      firebase.auth,
      'resident@example.com'
    );
    expect(document.getElementById('resetMessage').textContent).toContain(
      'Password reset email sent'
    );
    expect(document.getElementById('resetMessage').className).toBe('reset-message success');
  });
});

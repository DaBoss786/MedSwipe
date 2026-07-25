// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

function makeFirebaseMock({ redirectResult = null } = {}) {
  const auth = {
    currentUser: { uid: 'anon-urology-123', isAnonymous: true }
  };
  const finalizeRegistration = vi.fn().mockResolvedValue({ data: { success: true } });
  const recomputeAccessTier = vi.fn().mockResolvedValue({ data: {} });

  class GoogleAuthProvider {
    static credential = vi.fn((idToken, accessToken) => ({
      providerId: 'google.com',
      idToken,
      accessToken
    }));

    static credentialFromError = vi.fn((error) => error?.credential || null);

    setCustomParameters() {}
    addScope() {}
  }

  class OAuthProvider {
    static credentialFromError = vi.fn((error) => error?.credential || null);

    constructor(providerId) {
      this.providerId = providerId;
    }

    addScope() {}
    setCustomParameters() {}
    credential(payload) {
      return { providerId: this.providerId, ...payload };
    }
  }

  return {
    auth,
    db: {},
    functions: {},
    doc: vi.fn(() => ({})),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    serverTimestamp: vi.fn(() => 'server-timestamp'),
    onAuthStateChanged: vi.fn(() => () => {}),
    createUserWithEmailAndPassword: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    signInAnonymously: vi.fn(),
    signOut: vi.fn(),
    updateProfile: vi.fn().mockResolvedValue(undefined),
    EmailAuthProvider: {
      credential: vi.fn((email, password) => ({ providerId: 'password', email, password }))
    },
    linkWithCredential: vi.fn(),
    linkWithPopup: vi.fn(),
    linkWithRedirect: vi.fn().mockResolvedValue(undefined),
    GoogleAuthProvider,
    OAuthProvider,
    signInWithCredential: vi.fn(),
    signInWithPopup: vi.fn(),
    signInWithRedirect: vi.fn().mockResolvedValue(undefined),
    getRedirectResult: vi.fn().mockResolvedValue(redirectResult),
    getAdditionalUserInfo: vi.fn(() => ({ isNewUser: false })),
    httpsCallable: vi.fn((_, name) => {
      if (name === 'finalizeRegistration') return finalizeRegistration;
      if (name === 'recomputeAccessTier') return recomputeAccessTier;
      return vi.fn();
    }),
    finalizeRegistration,
    recomputeAccessTier
  };
}

async function loadAuth({ native = false, redirectResult = null, redirectContext = null } = {}) {
  vi.resetModules();
  sessionStorage.clear();
  localStorage.clear();
  document.body.innerHTML = '<input id="marketingOptIn" type="checkbox">';
  window.selectedUsername = 'UrologyLearner';
  delete window.__medswipeOAuthRedirectOutcome;
  delete window.Capacitor;
  delete window.capacitorExports;

  if (redirectContext) {
    sessionStorage.setItem('medswipeOAuthContext', JSON.stringify(redirectContext));
  }

  const firebase = makeFirebaseMock({ redirectResult });
  const nativePlugin = {
    signInWithGoogle: vi.fn().mockResolvedValue({
      credential: { idToken: 'google-id-token', accessToken: 'google-access-token' }
    }),
    signInWithApple: vi.fn().mockResolvedValue({
      credential: { idToken: 'apple-id-token', nonce: 'apple-nonce' }
    })
  };

  if (native) {
    window.Capacitor = { Plugins: { FirebaseAuthentication: nativePlugin } };
  }

  vi.doMock('./firebase-config.js', () => firebase);
  vi.doMock('./platform.js', () => ({ isNativeApp: native, isIosNativeApp: native }));
  vi.doMock('./specialty-policy.js', () => ({
    getSpecialtyPolicy: vi.fn(async (specialty) => ({ specialtyKey: specialty.toLowerCase() }))
  }));

  await import('./auth.js');
  window.authState.specialty = 'Urology';
  window.authState.username = 'UrologyLearner';
  window.authState.user = firebase.auth.currentUser;

  return { firebase, nativePlugin, authFunctions: window.authFunctions };
}

function linkedUser(providerId) {
  return {
    user: {
      uid: 'anon-urology-123',
      isAnonymous: false,
      displayName: 'UrologyLearner',
      email: `learner@${providerId}.test`
    },
    providerId
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('anonymous OAuth registration linking', () => {
  it.each([
    ['google', 'google.com'],
    ['apple', 'apple.com']
  ])('links the native %s credential to the Urology guest UID', async (providerKey, providerId) => {
    const { firebase, authFunctions } = await loadAuth({ native: true });
    firebase.linkWithCredential.mockResolvedValue(linkedUser(providerId));

    const result = await authFunctions.oauthSignIn(providerKey, {
      flow: 'register',
      marketingOptIn: true
    });

    expect(firebase.linkWithCredential).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'anon-urology-123', isAnonymous: true }),
      expect.objectContaining({ providerId })
    );
    expect(firebase.signInWithCredential).not.toHaveBeenCalled();
    expect(firebase.finalizeRegistration).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      isNewUser: true,
      firebaseIsNewUser: false,
      anonymousUpgrade: true,
      user: { uid: 'anon-urology-123' }
    });
    expect(window.authState.specialty).toBe('Urology');
  });

  it('links web popup registration instead of replacing the anonymous user', async () => {
    const { firebase, authFunctions } = await loadAuth();
    firebase.linkWithPopup.mockResolvedValue(linkedUser('google.com'));

    const result = await authFunctions.oauthSignIn('google', { flow: 'register' });

    expect(firebase.linkWithPopup).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'anon-urology-123', isAnonymous: true }),
      expect.any(firebase.GoogleAuthProvider)
    );
    expect(firebase.signInWithPopup).not.toHaveBeenCalled();
    expect(firebase.finalizeRegistration).toHaveBeenCalledTimes(1);
    expect(result.anonymousUpgrade).toBe(true);
  });

  it('starts web redirect registration as a link operation', async () => {
    const { firebase, authFunctions } = await loadAuth();
    firebase.linkWithPopup.mockRejectedValue({ code: 'auth/popup-blocked' });

    const result = await authFunctions.oauthSignIn('google', { flow: 'register' });
    const storedContext = JSON.parse(sessionStorage.getItem('medswipeOAuthContext'));

    expect(result.status).toBe('redirect');
    expect(firebase.linkWithRedirect).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'anon-urology-123', isAnonymous: true }),
      expect.any(firebase.GoogleAuthProvider)
    );
    expect(storedContext).toMatchObject({
      providerKey: 'google',
      flow: 'register',
      authOperation: 'link'
    });
  });

  it('finalizes a completed anonymous redirect link even when Firebase reports isNewUser false', async () => {
    const redirectResult = linkedUser('google.com');
    const { firebase, authFunctions } = await loadAuth({
      redirectResult,
      redirectContext: {
        providerKey: 'google',
        flow: 'register',
        marketingOptIn: false,
        referrerId: null,
        authOperation: 'link'
      }
    });

    const result = await authFunctions.oauthRedirectPromise;

    expect(firebase.finalizeRegistration).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      isNewUser: true,
      anonymousUpgrade: true,
      user: { uid: 'anon-urology-123' }
    });
    expect(sessionStorage.getItem('medswipeOAuthContext')).toBeNull();
  });

  it('signs into an existing provider account without finalizing or overwriting its profile', async () => {
    const { firebase, authFunctions } = await loadAuth({ native: true });
    const conflict = { code: 'auth/credential-already-in-use' };
    const existingUser = {
      user: { uid: 'existing-registered-456', isAnonymous: false, displayName: 'ExistingUser' }
    };
    firebase.linkWithCredential.mockRejectedValue(conflict);
    firebase.signInWithCredential.mockResolvedValue(existingUser);

    const result = await authFunctions.oauthSignIn('google', { flow: 'register' });

    expect(firebase.signInWithCredential).toHaveBeenCalledTimes(1);
    expect(firebase.finalizeRegistration).not.toHaveBeenCalled();
    expect(firebase.setDoc).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      isNewUser: false,
      anonymousUpgrade: false,
      user: { uid: 'existing-registered-456' }
    });
  });
});

describe('unchanged authentication paths', () => {
  it('keeps email/password anonymous upgrades linked to the same UID', async () => {
    const { firebase, authFunctions } = await loadAuth();
    firebase.linkWithCredential.mockResolvedValue(linkedUser('password'));

    await authFunctions.upgradeAnonymousUser(
      'urology@example.com',
      'password123',
      'UrologyLearner'
    );

    expect(firebase.linkWithCredential).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'anon-urology-123' }),
      expect.objectContaining({ providerId: 'password' })
    );
    expect(firebase.finalizeRegistration).toHaveBeenCalledTimes(1);
  });

  it('uses normal popup sign-in for a registered user login', async () => {
    const { firebase, authFunctions } = await loadAuth();
    firebase.auth.currentUser = { uid: 'registered-789', isAnonymous: false };
    firebase.signInWithPopup.mockResolvedValue({
      user: { uid: 'registered-789', isAnonymous: false, displayName: 'RegisteredUser' }
    });

    const result = await authFunctions.oauthSignIn('google', { flow: 'login' });

    expect(firebase.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(firebase.linkWithPopup).not.toHaveBeenCalled();
    expect(firebase.finalizeRegistration).not.toHaveBeenCalled();
    expect(result.isNewUser).toBe(false);
  });
});

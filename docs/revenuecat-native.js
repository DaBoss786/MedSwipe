// revenuecat-native.js
// Runtime-only module used when the app is running inside a native Capacitor
// shell. It adapts the shared billing-service facade to RevenueCat.

import { detectNativeApp } from './platform.js';

const globalWindow = typeof window !== 'undefined' ? window : undefined;

const PRODUCT_IDENTIFIERS = {
  boardReview: {
    monthly: 'medswipe.board.review.monthly',
    '3-month': 'medswipe.board.review.quarterly',
    annual: 'medswipe.board.review.annual'
  },
  cme: {
    annual: 'medswipe.cme.annual',
    credits: 'medswipe.cme.credits'
  }
};

let initialized = false;
let cachedPlugin = null;
let authListenerAttached = false;
let lastSyncedAppUserId = undefined;
let userSyncPromise = Promise.resolve();
let offeringsCache = null;
let offeringsPromise = null;
const productCache = new Map();
const PURCHASE_REFRESH_ATTEMPTS = 6;
const PURCHASE_REFRESH_DELAY_MS = 850;
const ACTIVATION_OVERLAY_ID = 'subscriptionActivationOverlay';
const ACTIVATION_OVERLAY_MESSAGE_CLASS = 'subscription-activation-message';
const ACTIVATION_OVERLAY_SPINNER_CLASS = 'subscription-activation-spinner';
const ACTIVATION_OVERLAY_ACTIONS_CLASS = 'subscription-activation-actions';
const ACTIVATION_OVERLAY_CONTINUE_CLASS = 'subscription-activation-continue';
const ACTIVATION_SUCCESS_MESSAGE = 'Subscription activated!';
const ACTIVATION_FALLBACK_MESSAGE = 'Almost done - tap Continue to finish.';
const ACTIVATION_SUCCESS_HIDE_DELAY_MS = 350;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRefreshAuthStateFn() {
  const direct = globalWindow?.refreshAuthStateFromFirestore;
  if (typeof direct === 'function') {
    return direct;
  }
  const nested = globalWindow?.authFunctions?.refreshAuthStateFromFirestore;
  return typeof nested === 'function' ? nested : null;
}

function captureAccessSnapshot() {
  const state = globalWindow?.authState || {};
  return {
    accessTier: state.accessTier || 'free_guest',
    boardReviewActive: !!state.boardReviewActive,
    cmeSubscriptionActive: !!state.cmeSubscriptionActive,
    cmeCreditsAvailable: Number(state.cmeCreditsAvailable || 0),
  };
}

function hasUpgradeOccurred(initial, current, expectation) {
  switch (expectation) {
    case 'board_review':
      return current.boardReviewActive || current.accessTier === 'board_review' || current.accessTier === 'cme_annual';
    case 'cme_annual':
      return current.cmeSubscriptionActive || current.accessTier === 'cme_annual';
    case 'cme_credits':
      return current.cmeCreditsAvailable > initial.cmeCreditsAvailable;
    default:
      return current.accessTier !== initial.accessTier ||
        current.boardReviewActive !== initial.boardReviewActive ||
        current.cmeSubscriptionActive !== initial.cmeSubscriptionActive ||
        current.cmeCreditsAvailable !== initial.cmeCreditsAvailable;
  }
}

function getActivationOverlayElements(createIfMissing = true) {
  const doc = globalWindow?.document;
  if (!doc || !doc.body) {
    return null;
  }

  let overlay = doc.getElementById(ACTIVATION_OVERLAY_ID);
  if (!overlay && createIfMissing) {
    overlay = doc.createElement('div');
    overlay.id = ACTIVATION_OVERLAY_ID;
    overlay.className = 'subscription-activation-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="subscription-activation-card">
        <div class="${ACTIVATION_OVERLAY_SPINNER_CLASS}" role="status" aria-live="polite"></div>
        <p class="${ACTIVATION_OVERLAY_MESSAGE_CLASS}">Activating your subscription...</p>
        <div class="${ACTIVATION_OVERLAY_ACTIONS_CLASS}" style="display: none;">
          <button type="button" class="${ACTIVATION_OVERLAY_CONTINUE_CLASS}">Continue</button>
        </div>
      </div>
    `;
    doc.body.appendChild(overlay);
  }

  if (!overlay) {
    return null;
  }

  const messageEl = overlay.querySelector(`.${ACTIVATION_OVERLAY_MESSAGE_CLASS}`);
  const spinnerEl = overlay.querySelector(`.${ACTIVATION_OVERLAY_SPINNER_CLASS}`);
  const actionsEl = overlay.querySelector(`.${ACTIVATION_OVERLAY_ACTIONS_CLASS}`);
  const continueBtn = overlay.querySelector(`.${ACTIVATION_OVERLAY_CONTINUE_CLASS}`);

  return { overlay, messageEl, spinnerEl, actionsEl, continueBtn };
}

function hideActivationOverlay() {
  const elements = getActivationOverlayElements(false);
  if (!elements) {
    return;
  }

  const { overlay, spinnerEl, actionsEl, continueBtn } = elements;
  if (overlay) {
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
  }
  if (spinnerEl) {
    spinnerEl.style.display = 'block';
  }
  if (actionsEl) {
    actionsEl.style.display = 'none';
  }
  if (continueBtn && continueBtn.__subscriptionActivationHandler) {
    continueBtn.removeEventListener('click', continueBtn.__subscriptionActivationHandler);
    delete continueBtn.__subscriptionActivationHandler;
  }
}

if (globalWindow) {
  globalWindow.hideSubscriptionActivationOverlay = hideActivationOverlay;
}

function showActivationOverlay() {
  const elements = getActivationOverlayElements(true);
  if (!elements) {
    return null;
  }

  const { overlay, messageEl, spinnerEl, actionsEl, continueBtn } = elements;
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
  }
  if (messageEl) {
    messageEl.textContent = 'Activating your subscription...';
  }
  if (spinnerEl) {
    spinnerEl.style.display = 'block';
  }
  if (actionsEl) {
    actionsEl.style.display = 'none';
  }
  if (continueBtn && continueBtn.__subscriptionActivationHandler) {
    continueBtn.removeEventListener('click', continueBtn.__subscriptionActivationHandler);
    delete continueBtn.__subscriptionActivationHandler;
  }

  return {
    markSuccess() {
      const successElements = getActivationOverlayElements(false);
      if (!successElements) {
        return;
      }
      const { messageEl: m, spinnerEl: s, actionsEl: a } = successElements;
      if (m) {
        m.textContent = ACTIVATION_SUCCESS_MESSAGE;
      }
      if (s) {
        s.style.display = 'none';
      }
      if (a) {
        a.style.display = 'none';
      }
      setTimeout(() => {
        hideActivationOverlay();
      }, ACTIVATION_SUCCESS_HIDE_DELAY_MS);
    },
    showFallback(onContinue) {
      const fallbackElements = getActivationOverlayElements(false);
      if (!fallbackElements) {
        return;
      }
      const { messageEl: m, spinnerEl: s, actionsEl: a, continueBtn: c } = fallbackElements;
      if (m) {
        m.textContent = ACTIVATION_FALLBACK_MESSAGE;
      }
      if (s) {
        s.style.display = 'none';
      }
      if (a) {
        a.style.display = 'flex';
      }
      if (c) {
        if (c.__subscriptionActivationHandler) {
          c.removeEventListener('click', c.__subscriptionActivationHandler);
        }
        const handler = () => {
          if (typeof onContinue === 'function') {
            try {
              onContinue();
            } catch (error) {
              console.warn('Subscription activation continue handler failed.', error);
            }
          }
          hideActivationOverlay();
        };
        c.__subscriptionActivationHandler = handler;
        c.addEventListener('click', handler, { once: true });
      }
    },
    hide: hideActivationOverlay
  };
}

function hidePaywallScreens() {
  const doc = globalWindow?.document;
  if (!doc) {
    return;
  }

  ['newPaywallScreen', 'boardReviewPricingScreen', 'cmePricingScreen'].forEach((id) => {
    const node = doc.getElementById(id);
    if (node) {
      node.style.display = 'none';
    }
  });
}

function beginButtonProcessing(button) {
  if (!button || typeof button !== 'object') {
    return () => {};
  }

  if (button.dataset.processing === 'true') {
    return () => {};
  }

  const originalContent = button.innerHTML;
  const wasDisabled = button.disabled ? 'true' : 'false';
  const originalMinWidth = button.style.minWidth;
  const measuredWidth = button.getBoundingClientRect()?.width || 0;

  button.dataset.processing = 'true';
  button.dataset.originalContent = originalContent;
  button.dataset.wasDisabled = wasDisabled;
  button.dataset.originalMinWidth = originalMinWidth || '';

  if (measuredWidth > 0) {
    button.style.minWidth = `${measuredWidth}px`;
  }

  button.innerHTML = 'Processing...';
  button.disabled = true;
  button.classList.add('is-processing');
  button.setAttribute('aria-busy', 'true');

  return () => {
    if (!button || button.dataset.processing !== 'true') {
      return;
    }

    button.innerHTML = button.dataset.originalContent || button.innerHTML;
    if (button.dataset.wasDisabled !== 'true') {
      button.disabled = false;
    } else {
      button.disabled = true;
    }
    button.classList.remove('is-processing');
    button.removeAttribute('aria-busy');
    button.style.minWidth = button.dataset.originalMinWidth || '';

    delete button.dataset.processing;
    delete button.dataset.originalContent;
    delete button.dataset.wasDisabled;
    delete button.dataset.originalMinWidth;
  };
}

async function refreshAccessTierAfterPurchase(expectation) {
  const refreshFn = getRefreshAuthStateFn();
  if (!refreshFn) {
    return { refreshed: false, upgraded: false, reason: 'missing-refresh-function' };
  }

  const initialSnapshot = captureAccessSnapshot();
  let currentSnapshot = initialSnapshot;

  for (let attempt = 0; attempt < PURCHASE_REFRESH_ATTEMPTS; attempt++) {
    try {
      await refreshFn({ forceDispatch: attempt === 0 });
    } catch (error) {
      console.warn('refreshAuthStateFromFirestore failed during post-purchase sync.', error);
      return { refreshed: false, upgraded: false, reason: 'refresh-error', error };
    }

    currentSnapshot = captureAccessSnapshot();
    if (hasUpgradeOccurred(initialSnapshot, currentSnapshot, expectation)) {
      return { refreshed: true, upgraded: true, snapshot: currentSnapshot };
    }

    if (attempt < PURCHASE_REFRESH_ATTEMPTS - 1) {
      await sleep(PURCHASE_REFRESH_DELAY_MS);
    }
  }

  console.warn('Post-purchase refresh did not detect an access change.', {
    expectation,
    state: currentSnapshot,
  });

  return { refreshed: true, upgraded: false, snapshot: currentSnapshot, reason: 'timeout' };
}

async function triggerRevenueCatSync() {
  const plugin = getPurchasesPlugin();
  if (typeof plugin.syncPurchases === 'function') {
    await plugin.syncPurchases();
    return;
  }
  if (typeof plugin.getCustomerInfo === 'function') {
    await plugin.getCustomerInfo();
  }
}

async function handlePostPurchase(expectation) {
  const overlay = showActivationOverlay();
  try {
    await triggerRevenueCatSync();
  } catch (error) {
    console.warn('RevenueCat sync after purchase failed.', error);
  }

  try {
    const { upgraded } = await refreshAccessTierAfterPurchase(expectation);
    if (upgraded) {
      hidePaywallScreens();
      overlay?.markSuccess();
      return;
    }
    overlay?.showFallback(() => {
      hideActivationOverlay();
    });
  } catch (error) {
    console.warn('Failed to refresh access tier after purchase.', error);
    overlay?.showFallback(() => {
      hideActivationOverlay();
    });
  }
}

function ensureNativeRuntime() {
  if (!detectNativeApp()) {
    throw new Error('RevenueCat native module loaded outside of a native runtime.');
  }
}

function getPurchasesPlugin() {
  if (cachedPlugin) {
    return cachedPlugin;
  }

  const capacitor = globalWindow?.Capacitor;
  const candidates = [
    globalWindow?.Purchases,
    globalWindow?.RevenueCatPurchases,
    capacitor?.Plugins?.RevenueCatPurchases,
    capacitor?.Plugins?.RevenueCat,
    capacitor?.Plugins?.Purchases
  ];

  const plugin = candidates.find(Boolean);

  if (!plugin) {
    throw new Error('RevenueCat Purchases plugin is not available on window.Capacitor.');
  }

  cachedPlugin = plugin;
  return plugin;
}

function extractFirebaseUid(authState = globalWindow?.authState) {
  const user = authState?.user;
  if (!user || typeof user.uid !== 'string') {
    return null;
  }

  if (user.isAnonymous) {
    return null;
  }

  const trimmed = user.uid.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function invokeLogin(plugin, appUserId) {
  if (!appUserId) {
    return false;
  }

  if (typeof plugin.logIn === 'function') {
    try {
      await plugin.logIn(appUserId);
      return true;
    } catch (error) {
      // Some plugin versions expect an object parameter. Retry below.
      try {
        await plugin.logIn({ appUserID: appUserId });
        return true;
      } catch (secondaryError) {
        throw secondaryError;
      }
    }
  }

  if (typeof plugin.identify === 'function') {
    await plugin.identify(appUserId);
    return true;
  }

  if (typeof plugin.setAppUserID === 'function') {
    await plugin.setAppUserID(appUserId);
    return true;
  }

  console.warn('RevenueCat plugin is missing a method to assign the app user ID.');
  return false;
}

async function invokeLogout(plugin) {
  if (typeof plugin.logOut === 'function') {
    await plugin.logOut();
    return true;
  }

  if (typeof plugin.reset === 'function') {
    await plugin.reset();
    return true;
  }

  console.warn('RevenueCat plugin is missing a method to clear the app user ID.');
  return false;
}

async function syncAppUserIdWithAuth(plugin, authState) {
  const targetAppUserId = extractFirebaseUid(authState);

  if (targetAppUserId === lastSyncedAppUserId) {
    return;
  }

  if (targetAppUserId) {
    const didSync = await invokeLogin(plugin, targetAppUserId);
    if (didSync) {
      lastSyncedAppUserId = targetAppUserId;
    }
    return;
  }

  const didReset = await invokeLogout(plugin);
  if (didReset || typeof lastSyncedAppUserId !== 'undefined') {
    lastSyncedAppUserId = null;
  }
}

function queueAppUserSync(plugin, authState) {
  userSyncPromise = userSyncPromise
    .catch(() => undefined)
    .then(() => syncAppUserIdWithAuth(plugin, authState))
    .catch((error) => {
      console.error('RevenueCat app user sync failed.', error);
    });

  return userSyncPromise;
}

async function ensureAppUserSyncedBeforePurchase(plugin) {
  const authState = globalWindow?.authState;
  const targetUid = extractFirebaseUid(authState);

  if (!targetUid) {
    console.warn('RevenueCat purchase attempted without a registered Firebase UID.');
    return false;
  }

  try {
    await queueAppUserSync(plugin, authState);
  } catch (error) {
    console.warn('RevenueCat queueAppUserSync failed before purchase.', error);
  }

  if (lastSyncedAppUserId === targetUid) {
    return true;
  }

  try {
    const didLogin = await invokeLogin(plugin, targetUid);
    if (didLogin) {
      lastSyncedAppUserId = targetUid;
    }
    return didLogin;
  } catch (error) {
    console.error('RevenueCat logIn before purchase failed.', error);
    return false;
  }
}

function attachAuthListener(plugin) {
  if (authListenerAttached || typeof globalWindow?.addEventListener !== 'function') {
    return;
  }

  authListenerAttached = true;

  globalWindow.addEventListener('authStateChanged', (event) => {
    queueAppUserSync(plugin, event?.detail || globalWindow?.authState);
  });
}


async function configurePlugin(plugin) {
  const apiKey = globalWindow?.REVENUECAT_API_KEY || globalWindow?.__REVENUECAT_API_KEY__;
  if (!apiKey) {
    console.warn('RevenueCat API key missing. Set window.REVENUECAT_API_KEY before initializing.');
    return;
  }

  const initialAppUserId = extractFirebaseUid();

  if (typeof plugin.configure === 'function') {
    await plugin.configure({ apiKey, appUserID: initialAppUserId });
  } else if (typeof plugin.setup === 'function') {
    await plugin.setup({ apiKey, appUserId: initialAppUserId });
  } else {
    console.warn('RevenueCat plugin does not expose a configure/setup method.');
  }

  lastSyncedAppUserId = initialAppUserId ?? null;
  attachAuthListener(plugin);
  await queueAppUserSync(plugin, globalWindow?.authState);
}

async function loadOfferings(plugin) {
  if (offeringsCache) {
    return offeringsCache;
  }

  if (!offeringsPromise) {
    offeringsPromise = plugin
      .getOfferings()
      .then((result) => {
        offeringsCache = result;
        return result;
      })
      .catch((error) => {
        offeringsPromise = null;
        throw error;
      });
  }

  return offeringsPromise;
}

async function fetchStoreProduct(plugin, productIdentifier) {
  if (productCache.has(productIdentifier)) {
    return productCache.get(productIdentifier);
  }

  if (typeof plugin.getProducts !== 'function') {
    return null;
  }

  try {
    const result = await plugin.getProducts({ productIdentifiers: [productIdentifier] });
    const productsArray = Array.isArray(result)
      ? result
      : Array.isArray(result?.products)
      ? result.products
      : [];
    const match = productsArray.find(
      (item) => item?.identifier === productIdentifier || item?.productIdentifier === productIdentifier
    );

    if (match) {
      productCache.set(productIdentifier, match);
      return match;
    }
  } catch (error) {
    console.warn(`RevenueCat getProducts failed for "${productIdentifier}".`, error);
  }

  return null;
}

export async function initialize() {
  if (initialized) {
    return;
  }

  ensureNativeRuntime();
  const plugin = getPurchasesPlugin();

  try {
    await configurePlugin(plugin);
    await loadOfferings(plugin).catch((error) => {
      console.warn('RevenueCat offerings could not be prefetched during initialization.', error);
    });
    initialized = true;
  } catch (error) {
    console.error('Failed to configure RevenueCat.', error);
    throw error;
  }
}

function resolveBoardReviewProduct(planType) {
  const productId = PRODUCT_IDENTIFIERS.boardReview[planType];
  if (!productId) {
    throw new Error(`Unknown RevenueCat Board Review product for plan "${planType}".`);
  }
  return productId;
}

function resolveCmeProduct(planType) {
  const productId = PRODUCT_IDENTIFIERS.cme[planType];
  if (!productId) {
    throw new Error(`Unknown RevenueCat CME product for plan "${planType}".`);
  }
  return productId;
}

function findPackageForProduct(offerings, productIdentifier) {
  if (!offerings) {
    return null;
  }

  const scanPackages = (packages = []) =>
    packages.find((pkg) => pkg?.storeProduct?.identifier === productIdentifier) || null;

  const currentPackage = scanPackages(offerings.current?.availablePackages);
  if (currentPackage) {
    return currentPackage;
  }

  const allOfferings = offerings.all ?? {};
  for (const key of Object.keys(allOfferings)) {
    const found = scanPackages(allOfferings[key]?.availablePackages);
    if (found) {
      return found;
    }
  }

  return null;
}

async function purchaseProductByPackage(productIdentifier) {
  const plugin = getPurchasesPlugin();
  let offerings = null;
  try {
    offerings = await loadOfferings(plugin);
  } catch (error) {
    console.warn('RevenueCat offerings unavailable, falling back to direct product purchase.', error);
  }

  if (offerings) {
    const targetPackage = findPackageForProduct(offerings, productIdentifier);
    if (targetPackage && typeof plugin.purchasePackage === 'function') {
      return plugin.purchasePackage({ aPackage: targetPackage });
    }

    console.warn(`RevenueCat package not found for product "${productIdentifier}". Falling back to direct purchase.`);
  }

  const storeProduct = await fetchStoreProduct(plugin, productIdentifier);
  if (storeProduct && typeof plugin.purchaseStoreProduct === 'function') {
    return plugin.purchaseStoreProduct({ product: storeProduct });
  }

  throw new Error('RevenueCat plugin is missing purchase APIs.');
}

// Invoked when a premium Board Review plan is selected inside the native shell.
// Unlike the Stripe-backed web flow, this hands control to RevenueCat so the
// user sees Apple's native purchase sheet (where the free-trial messaging and
// confirmation live).
export async function startBoardReviewCheckout(planType, buttonElement) {
  ensureNativeRuntime();
  const productIdentifier = resolveBoardReviewProduct(planType);
  const releaseButton = beginButtonProcessing(buttonElement);

  try {
    const plugin = getPurchasesPlugin();
    const synced = await ensureAppUserSyncedBeforePurchase(plugin);
    if (!synced) {
      console.warn('Proceeding with RevenueCat purchase without confirmed app user sync.');
    }

    const purchaseResult = await purchaseProductByPackage(productIdentifier);
    await handlePostPurchase('board_review');
    return purchaseResult;
  } catch (error) {
    console.error(`RevenueCat purchase failed for Board Review plan "${planType}".`, error);
    throw error;
  } finally {
    releaseButton();
  }
}

// Mirrors startBoardReviewCheckout for CME products. All checkout UX is handled
// by RevenueCat/StoreKit once this promise resolves.
export async function startCmeCheckout(planType, buttonElement, quantity = 1) {
  ensureNativeRuntime();
  if (planType === 'credits') {
    console.warn('CME credit purchases are disabled in the native app. Redirect users to the web checkout for credits.');
    if (globalWindow?.alert) {
      globalWindow.alert('Buying CME credits is only available on the MedSwipe website.');
    }
    return;
  }
  const productIdentifier = resolveCmeProduct(planType);
  const expectation =
    planType === 'annual' ? 'cme_annual' : planType === 'credits' ? 'cme_credits' : null;
  const releaseButton = beginButtonProcessing(buttonElement);

  try {
    const plugin = getPurchasesPlugin();
    const synced = await ensureAppUserSyncedBeforePurchase(plugin);
    if (!synced) {
      console.warn('Proceeding with RevenueCat purchase without confirmed app user sync.');
    }

    const purchaseResult = await purchaseProductByPackage(productIdentifier);
    await handlePostPurchase(expectation);
    return purchaseResult;
  } catch (error) {
    console.error(`RevenueCat purchase failed for CME plan "${planType}".`, error);
    throw error;
  } finally {
    releaseButton();
  }
}

export async function restorePurchases() {
  ensureNativeRuntime();
  const plugin = getPurchasesPlugin();

  try {
    if (typeof plugin.restorePurchases === 'function') {
      await plugin.restorePurchases();
      return;
    }

    if (typeof plugin.syncPurchases === 'function') {
      await plugin.syncPurchases();
      return;
    }

    throw new Error('RevenueCat plugin does not expose a restore purchases method.');
  } catch (error) {
    console.error('RevenueCat restore purchases failed.', error);
    throw error;
  }
}

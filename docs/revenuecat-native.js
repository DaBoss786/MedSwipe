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

async function refreshAccessTierAfterPurchase(expectation) {
  const refreshFn = getRefreshAuthStateFn();
  if (!refreshFn) {
    return;
  }

  const initialSnapshot = captureAccessSnapshot();

  for (let attempt = 0; attempt < PURCHASE_REFRESH_ATTEMPTS; attempt++) {
    try {
      await refreshFn({ forceDispatch: attempt === 0 });
    } catch (error) {
      console.warn('refreshAuthStateFromFirestore failed during post-purchase sync.', error);
      break;
    }

    const currentSnapshot = captureAccessSnapshot();
    if (hasUpgradeOccurred(initialSnapshot, currentSnapshot, expectation)) {
      return;
    }

    if (attempt < PURCHASE_REFRESH_ATTEMPTS - 1) {
      await sleep(PURCHASE_REFRESH_DELAY_MS);
    }
  }

  console.warn('Post-purchase refresh did not detect an access change.', {
    expectation,
    state: captureAccessSnapshot(),
  });
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
  try {
    await triggerRevenueCatSync();
  } catch (error) {
    console.warn('RevenueCat sync after purchase failed.', error);
  }

  try {
    await refreshAccessTierAfterPurchase(expectation);
  } catch (error) {
    console.warn('Failed to refresh access tier after purchase.', error);
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
export async function startBoardReviewCheckout(planType, _buttonElement) {
  ensureNativeRuntime();
  const productIdentifier = resolveBoardReviewProduct(planType);

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
  }
}

// Mirrors startBoardReviewCheckout for CME products. All checkout UX is handled
// by RevenueCat/StoreKit once this promise resolves.
export async function startCmeCheckout(planType, _buttonElement, quantity = 1) {
  ensureNativeRuntime();
  const productIdentifier = resolveCmeProduct(planType);
  const expectation =
    planType === 'annual' ? 'cme_annual' : planType === 'credits' ? 'cme_credits' : null;

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

// revenuecat-native.js
// Runtime-only module used when the app is running inside a native Capacitor
// shell. It adapts the shared billing-service facade to RevenueCat.

import { detectNativeApp } from './platform.js';

const globalWindow = typeof window !== 'undefined' ? window : undefined;

const PRODUCT_IDENTIFIERS = {
  boardReview: {
    monthly: 'medswipe.board_review.monthly',
    '3-month': 'medswipe.board_review.quarterly',
    annual: 'medswipe.board_review.annual'
  },
  cme: {
    annual: 'medswipe.cme.annual',
    credits: 'medswipe.cme.credits'
  }
};

let initialized = false;
let cachedPlugin = null;

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

async function configurePlugin(plugin) {
  const apiKey = globalWindow?.REVENUECAT_API_KEY || globalWindow?.__REVENUECAT_API_KEY__;
  if (!apiKey) {
    console.warn('RevenueCat API key missing. Set window.REVENUECAT_API_KEY before initializing.');
    return;
  }

  if (typeof plugin.configure === 'function') {
    await plugin.configure({ apiKey, appUserID: globalWindow?.authState?.uid || null });
    return;
  }

  if (typeof plugin.setup === 'function') {
    await plugin.setup({ apiKey, appUserId: globalWindow?.authState?.uid || null });
    return;
  }

  console.warn('RevenueCat plugin does not expose a configure/setup method.');
}

export async function initialize() {
  if (initialized) {
    return;
  }

  ensureNativeRuntime();
  const plugin = getPurchasesPlugin();

  try {
    await configurePlugin(plugin);
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

async function purchaseProduct(productIdentifier, options = {}) {
  const plugin = getPurchasesPlugin();

  if (typeof plugin.purchasePackage === 'function') {
    return plugin.purchasePackage({ identifier: productIdentifier, options });
  }

  if (typeof plugin.purchaseProduct === 'function') {
    return plugin.purchaseProduct({ productIdentifier, ...options });
  }

  throw new Error('RevenueCat plugin is missing purchase APIs.');
}

export async function startBoardReviewCheckout(planType, _buttonElement) {
  ensureNativeRuntime();
  const productIdentifier = resolveBoardReviewProduct(planType);

  try {
    await purchaseProduct(productIdentifier);
  } catch (error) {
    console.error(`RevenueCat purchase failed for Board Review plan "${planType}".`, error);
    throw error;
  }
}

export async function startCmeCheckout(planType, _buttonElement, quantity = 1) {
  ensureNativeRuntime();
  const productIdentifier = resolveCmeProduct(planType);

  const purchaseOptions = quantity && quantity > 1 ? { quantity } : {};

  try {
    await purchaseProduct(productIdentifier, purchaseOptions);
  } catch (error) {
    console.error(`RevenueCat purchase failed for CME plan "${planType}".`, error);
    throw error;
  }
}
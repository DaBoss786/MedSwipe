// billing-service.js
// Central billing facade that allows the application to remain agnostic to the
// underlying payment provider. The web build wires this facade to Stripe, while
// native builds (e.g., Capacitor + RevenueCat) provide their own implementation
// transparently through this module.

import * as stripeProvider from './stripe-web.js';
import { detectNativeApp } from './platform.js';

const isNativeApp = detectNativeApp();

let providerPromise = null;
let resolvedProvider = null;

function getProvider() {
  if (resolvedProvider) {
    return Promise.resolve(resolvedProvider);
  }

  if (!providerPromise) {
    providerPromise = (async () => {
      const providerModule = isNativeApp
        ? await import('./revenuecat-native.js')
        : stripeProvider;

      resolvedProvider = providerModule;
      return providerModule;
    })().catch(error => {
      providerPromise = null;
      throw error;
    });
  }

  return providerPromise;
}

export async function initialize(...args) {
  const provider = await getProvider();
  if (typeof provider.initialize !== 'function') {
    throw new Error('Selected billing provider does not implement initialize().');
  }
  return provider.initialize(...args);
}

export function startBoardReviewCheckout(...args) {
  return getProvider()
    .then(provider => {
      if (typeof provider.startBoardReviewCheckout !== 'function') {
        throw new Error('Selected billing provider is missing startBoardReviewCheckout().');
      }
      return provider.startBoardReviewCheckout(...args);
    })
    .catch(error => {
      console.error('Failed to start Board Review checkout.', error);
      throw error;
    });
}

export function startCmeCheckout(...args) {
  return getProvider()
    .then(provider => {
      if (typeof provider.startCmeCheckout !== 'function') {
        throw new Error('Selected billing provider is missing startCmeCheckout().');
      }
      return provider.startCmeCheckout(...args);
    })
    .catch(error => {
      console.error('Failed to start CME checkout.', error);
      throw error;
    });
}
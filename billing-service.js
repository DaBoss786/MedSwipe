// billing-service.js
// Central billing facade that allows the application to remain agnostic to the
// underlying payment provider. The web build wires this facade to Stripe, while
// future native builds (e.g., Capacitor + RevenueCat) can provide their own
// implementation by exporting the same shape from a different module.

// In a more advanced setup we could dynamically choose the provider based on
// runtime feature detection. For now we statically use the web Stripe module so
// the rest of the app only talks to this thin interface.
import {
    initialize as initializeStripe,
    startBoardReviewCheckout as startBoardReviewCheckoutWeb,
    startCmeCheckout as startCmeCheckoutWeb
  } from './stripe-web.js';
  
  export async function initialize() {
    // Returning the provider promise allows callers to await readiness, which is
    // especially helpful when a UI event fires before Stripe.js finishes loading.
    return initializeStripe();
  }
  
  export function startBoardReviewCheckout(planType, buttonElement) {
    return startBoardReviewCheckoutWeb(planType, buttonElement);
  }
  
  export function startCmeCheckout(planType, buttonElement, quantity = 1) {
    return startCmeCheckoutWeb(planType, buttonElement, quantity);
  }
  
  // Native builds can later replace these exports with a RevenueCat-backed
  // implementation by creating a platform-specific file (e.g.,
  // `billing-service.native.js`) and adjusting the bundler or Capacitor config to
  // resolve that version instead.
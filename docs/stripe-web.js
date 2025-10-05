// stripe-web.js
// This module encapsulates all Stripe-related logic for the web platform.
// Native builds (iOS/Android) will use a different payment module (e.g., revenuecat-native.js)
// and this file will not be included in those builds.

// --- Import Firebase dependencies ---
import { getAuth, getIdToken } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-functions.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-analytics.js";

console.log("Stripe Web Module Loaded.");

// --- Stripe Price IDs (Moved to the top) ---
const STRIPE_ANNUAL_PRICE_ID = 'price_1RXcMOJDkW3cIYXuu4xEKrm4';
const STRIPE_CREDIT_PRICE_ID = 'price_1RXcdsJDkW3cIYXuKTLAM472';
const STRIPE_BR_MONTHLY_PRICE_ID = 'price_1RXcRSJDkW3cIYXuS6n0pM0t';
const STRIPE_BR_3MONTH_PRICE_ID = 'price_1RXcPbJDkW3cIYXusuhRQzqx';
const STRIPE_BR_ANNUAL_PRICE_ID = 'price_1RXcOnJDkW3cIYXusyl4eKpH';

// --- Module-level variables ---
let stripe = null;
let createCheckoutSessionFunction = null;
let stripeInitPromise = null;


/**
 * Dynamically loads the Stripe.js script and initializes the Stripe object.
 * This is the single entry point for setting up Stripe on the web.
 * @returns {Promise<object>} A promise that resolves with the Stripe instance when ready, or rejects on failure.
 */
export function initialize() {
    if (!stripeInitPromise) {
      stripeInitPromise = (async () => {
        if (!createCheckoutSessionFunction) {
          try {
            const functions = getFunctions();
            createCheckoutSessionFunction = httpsCallable(functions, 'createStripeCheckoutSession');
          } catch (error) {
            console.error("Could not initialize Firebase Cloud Function 'createStripeCheckoutSession':", error);
            throw error;
          }
        }

        if (stripe) {
            return stripe;
          }
    
          if (window.Stripe) {
        const stripePublishableKey = 'pk_live_51RFk9GJDkW3cIYXuIgsJ907sJeHhQ11J2NbaNVYSjwVpjFDhIRzCnE5ju8jFFddSkcls1Mb3DFH8M1LhueDpRiY700lPtYxU8A';
        stripe = window.Stripe(stripePublishableKey);
        window.stripe = stripe;
        console.log("Stripe.js initialized successfully.");
        return stripe;
    }

    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js.stripe.com/v3/';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        reject(new Error('Failed to load the Stripe.js script.'));
      };
      document.head.appendChild(script);
    });

    if (!window.Stripe) {
      throw new Error('Stripe.js failed to load correctly.');
      }


      const stripePublishableKey = 'pk_live_51RFk9GJDkW3cIYXuIgsJ907sJeHhQ11J2NbaNVYSjwVpjFDhIRzCnE5ju8jFFddSkcls1Mb3DFH8M1LhueDpRiY700lPtYxU8A';
      try {
        stripe = window.Stripe(stripePublishableKey);
      } catch (error) {
        console.error("Error initializing Stripe.js after load:", error);
        throw error;
      }
      window.stripe = stripe;
      console.log("Stripe.js initialized successfully after load.");
      return stripe;
    })().catch((error) => {
      stripeInitPromise = null;
      throw error;
    });
  }

  return stripeInitPromise;
}

/**
 * A generic helper function to handle the checkout process for any plan.
 * @param {string} priceId - The ID of the Stripe Price to check out.
 * @param {string} planName - A descriptive name for metadata (e.g., "Board Review Monthly").
 * @param {string} tierName - The internal tier name (e.g., "board_review").
 * @param {number} [quantity=1] - The quantity, used for credit purchases.
 * @param {HTMLElement} [buttonElement=null] - The button that was clicked, to manage its state.
 */
async function handleRedirectToCheckout(priceId, planName, tierName, quantity = 1, buttonElement = null) {
    const auth = getAuth();
    const user = auth.currentUser;

    let analytics = null;
    try {
        analytics = getAnalytics();
    } catch (error) {
        console.warn('Analytics is unavailable; proceeding without logging checkout events.', error);
    }
    if (analytics) {
        let price = 0;
        if (tierName === 'board_review') {
            if (priceId === STRIPE_BR_MONTHLY_PRICE_ID) price = 15.00;
            if (priceId === STRIPE_BR_3MONTH_PRICE_ID) price = 40.00;
            if (priceId === STRIPE_BR_ANNUAL_PRICE_ID) price = 149.00;
        } else if (tierName === 'cme_annual') {
            price = 179.00;
        } else if (tierName === 'cme_credits') {
            price = 8.00 * quantity;
        }
        logEvent(analytics, 'begin_checkout', {
            currency: 'USD', value: price, quantity: quantity,
            item_id: priceId, item_name: planName, tier: tierName
        });
        console.log(`GA Event: begin_checkout (item: ${planName})`);
    }

    if (!user || user.isAnonymous) {
        alert("Please register or log in before making a purchase.");
        return;
    }
    if (buttonElement) {
        buttonElement.disabled = true;
        buttonElement.textContent = 'Preparing...';
    }

    try {
        if (!stripe || !createCheckoutSessionFunction) {
            await initialize();
        }

        if (!stripe || !createCheckoutSessionFunction) {
            throw new Error('Payment system is not ready.');
        }
        await getIdToken(user, true);
        const result = await createCheckoutSessionFunction({
            priceId: priceId, planName: planName,
            tier: tierName, quantity: quantity
        });

        const sessionId = result.data.sessionId;
        if (!sessionId) throw new Error("Cloud function did not return a Session ID.");

        if (buttonElement) buttonElement.textContent = 'Redirecting...';
        const { error } = await stripe.redirectToCheckout({ sessionId });

        if (error) throw new Error(error.message);

    } catch (error) {
        console.error(`Error during checkout for ${planName}:`, error);
        alert(`Could not prepare checkout. Please try again. Error: ${error.message}`);
        if (buttonElement) {
            buttonElement.disabled = false;
            buttonElement.textContent = buttonElement.dataset.originalText || 'Try Again';
        }
    }
}

/**
 * EXPORTED FUNCTIONS
 * These are the public functions that app.js will call.
 */

export function startBoardReviewCheckout(planType, buttonElement) {
    let priceId, planName;
    switch (planType) {
        case 'monthly':
            priceId = STRIPE_BR_MONTHLY_PRICE_ID;
            planName = 'Board Review Monthly';
            break;
        case '3-month':
            priceId = STRIPE_BR_3MONTH_PRICE_ID;
            planName = 'Board Review 3-Month';
            break;
        case 'annual':
            priceId = STRIPE_BR_ANNUAL_PRICE_ID;
            planName = 'Board Review Annual';
            break;
        default:
            console.error(`Unknown board review plan type: ${planType}`);
            return;
    }
    if (buttonElement) buttonElement.dataset.originalText = buttonElement.textContent;
    handleRedirectToCheckout(priceId, planName, 'board_review', 1, buttonElement);
}

export function startCmeCheckout(planType, buttonElement, quantity = 1) {
    let priceId, planName, tierName;
    switch (planType) {
        case 'annual':
            priceId = STRIPE_ANNUAL_PRICE_ID;
            planName = 'CME Annual Subscription';
            tierName = 'cme_annual';
            break;
        case 'credits':
            priceId = STRIPE_CREDIT_PRICE_ID;
            planName = `CME Credits Purchase (${quantity})`;
            tierName = 'cme_credits';
            break;
        default:
            console.error(`Unknown CME plan type: ${planType}`);
            return;
    }
    if (buttonElement) buttonElement.dataset.originalText = buttonElement.textContent;
    handleRedirectToCheckout(priceId, planName, tierName, quantity, buttonElement);
}

export function restorePurchases() {
  return Promise.resolve();
}
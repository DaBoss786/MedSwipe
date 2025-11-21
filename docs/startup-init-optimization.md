# MedSwipe Startup Optimization Guide

This note captures how to overlap heavy initialization with the splash screen so that welcome/dashboard UI appears as early as possible while still leaving OneSignal and deep links untouched.

## Goals

- Keep push (OneSignal) bootstrap and deep-link handling running at launch.
- Let the splash fade-out happen as soon as auth resolves, while slow tasks continue in the background.
- Defer paywall/onboarding DOM work until those screens are about to be shown.

> These steps now live in both `docs/app.js` (web demo) and `ios/App/App/public/app.js` (Capacitor build). Only the docs version was updated in this pass, but the flow is identical.

## Implementation Outline

1. **Start listening for auth immediately**
   - In `ios/App/App/public/app.js`, attach the `window.addEventListener('authStateChanged', …)` listener **before** any awaited initialization inside the `DOMContentLoaded` handler. That ensures the first dispatch coming from `auth.js` (see `ios/App/App/public/auth.js:754`) is always caught.

2. **Kick off heavy initialization without blocking**
   - Replace the sequential `await` calls inside the `DOMContentLoaded` callback with fire-and-forget promises:
     ```js
     const oneSignalReady = initializeOneSignalPush();
     const identityReady = initializeOneSignalIdentityObservers();
     const deepLinkPromise = handleQuestionDeepLink(window.location?.href);
     const billingPromise = isNativeApp
       ? import('./revenuecat-native.js').then((mod) => mod.initialize())
       : initializeBilling();
     ```
   - Store those promises if you still want to log failures, but do not `await` them before showing UI. The existing lazy-loading in `billing-service.js` will still ensure the provider is ready when a checkout button is tapped.

3. **Fade the splash as soon as auth is ready**
   - Inside the `authStateChanged` listener (currently around `ios/App/App/public/app.js:1466`), trigger the splash fade-out immediately after `event.detail.isLoading === false` and registration isn’t running. Use the existing animation classes, but remove the fixed `2100` ms delay or overlap it with `setTimeout` that simply ensures the animation can finish:
     ```js
     const fadeSplash = () => {
       splashScreenEl.classList.add('fade-out');
       setTimeout(() => splashScreenEl.style.display = 'none', 500);
     };
     requestAnimationFrame(fadeSplash);
     ```
   - Once the fade is scheduled, call `handleUserRouting(event.detail)` right away so new/returning users land on welcome or dashboard while initialization promises continue in the background.

4. **Wait for slow promises in the background**
   - After starting the splash fade you can observe the outstanding tasks without blocking the UI:
     ```js
     Promise.allSettled([oneSignalReady, identityReady, deepLinkPromise, billingPromise])
       .then((results) => results.forEach(reportInitOutcome));
     ```
   - If you prefer, wrap this in `requestIdleCallback` to avoid extra work while the first frame renders.

5. **Lazy-initialize paywall/onboarding helpers**
   - Move `initializeIosPaywallUI`, `initializePaywallFreeAccessButton`, `setupRegistrationFollowupModals`, and `initializeOnboardingProgressIndicators` out of the `DOMContentLoaded` hot path. Call them from the first code path that actually reveals those screens (e.g., inside `showPaywallScreen`, the “Start Learning” handler, or when a registration modal opens). The functions only manipulate hidden DOM, so deferring them doesn’t change behavior but saves several hundred ms at startup.

6. **Documented verification**
   - After applying the code changes, reload the app and confirm:
     - The splash now disappears as soon as auth finishes (no fixed 2.1 s wait).
     - Welcome/dashboard renders while the console still shows pending logs from billing/OneSignal promises.
     - Deep links and push flows behave the same, since their initialization still starts immediately.

Keeping the work overlapping like this lets the initial paint happen faster without sacrificing the initialization that needs to occur before the user interacts with push, billing, or deep links.

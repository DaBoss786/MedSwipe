// analytics.js
// Provides a unified interface that routes Firebase Analytics calls
// to the native Capacitor plugin on iOS/Android and falls back to the
// Web SDK when running in a browser-only context.

import { analytics } from './firebase-config.js';
import { detectNativeApp } from './platform.js';
import {
  logEvent as firebaseLogEvent,
  setUserProperties as firebaseSetUserProperties,
  setUserId as firebaseSetUserId
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-analytics.js';

function getNativeAnalyticsPlugin() {
  if (typeof window === 'undefined') {
    return null;
  }
  const capacitor = window.Capacitor || null;
  return (
    capacitor?.Plugins?.FirebaseAnalytics ||
    window.capacitorExports?.FirebaseAnalytics ||
    null
  );
}

function normalizeLogEventArgs(args) {
  if (typeof args[0] === 'string') {
    return {
      analyticsInstance: analytics,
      name: args[0],
      params: args[1]
    };
  }
  return {
    analyticsInstance: args[0] || analytics,
    name: args[1],
    params: args[2]
  };
}

const normalizeUserPropertyValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    console.warn('Failed to stringify analytics user property value:', error);
    return String(value);
  }
};

export function logAnalyticsEvent(...args) {
  const { analyticsInstance, name, params } = normalizeLogEventArgs(args);
  if (!name || typeof name !== 'string') {
    console.warn('logAnalyticsEvent called without a valid event name.');
    return;
  }

  const analyticsToUse = analyticsInstance || analytics;
  const plugin = detectNativeApp() ? getNativeAnalyticsPlugin() : null;
  if (plugin?.logEvent) {
    plugin
      .logEvent({ name, params })
      .catch((error) => {
        console.warn('Native analytics logEvent failed:', error);
        if (!analyticsToUse) {
          return;
        }
        try {
          firebaseLogEvent(analyticsToUse, name, params);
        } catch (fallbackError) {
          console.warn('Web analytics fallback logEvent failed:', fallbackError);
        }
      });
    return;
  }

  if (!analyticsToUse) {
    console.debug(`Skipping analytics event "${name}" because no analytics instance is available.`);
    return;
  }

  try {
    firebaseLogEvent(analyticsToUse, name, params);
  } catch (error) {
    console.warn('Web analytics logEvent failed:', error);
  }
}

export function setAnalyticsUserProperties(...args) {
  let analyticsInstance = null;
  let properties = null;

  if (args.length === 1) {
    properties = args[0];
  } else {
    analyticsInstance = args[0];
    properties = args[1];
  }

  if (!properties || typeof properties !== 'object') {
    console.warn('setAnalyticsUserProperties called without a properties object.');
    return;
  }

  const analyticsToUse = analyticsInstance || analytics;
  const plugin = detectNativeApp() ? getNativeAnalyticsPlugin() : null;
  if (plugin?.setUserProperty) {
    const nativePromises = Object.entries(properties).map(([key, value]) => {
      const normalizedValue = normalizeUserPropertyValue(value);
      return plugin
        .setUserProperty({ key, value: normalizedValue })
        .catch((error) => {
          console.warn(`Native analytics setUserProperty failed for ${key}:`, error);
          throw error;
        });
    });

    Promise.all(nativePromises).catch(() => {
      if (!analyticsToUse) {
        return;
      }
      try {
        firebaseSetUserProperties(analyticsToUse, properties);
      } catch (fallbackError) {
        console.warn('Web analytics fallback setUserProperties failed:', fallbackError);
      }
    });
    return;
  }

  if (!analyticsToUse) {
    console.debug('Skipping web analytics setUserProperties because no analytics instance is available.');
    return;
  }

  try {
    firebaseSetUserProperties(analyticsToUse, properties);
  } catch (error) {
    console.warn('Web analytics setUserProperties failed:', error);
  }
}

export function setAnalyticsUserId(userId) {
  const normalizedId = userId === undefined || userId === null ? null : String(userId);
  const plugin = detectNativeApp() ? getNativeAnalyticsPlugin() : null;
  if (plugin?.setUserId) {
    plugin
      .setUserId({ userId: normalizedId })
      .catch((error) => {
        console.warn('Native analytics setUserId failed:', error);
        if (!analytics) {
          return;
        }
        try {
          firebaseSetUserId(analytics, normalizedId);
        } catch (fallbackError) {
          console.warn('Web analytics fallback setUserId failed:', fallbackError);
        }
      });
    return;
  }

  if (!analytics) {
    console.debug('Skipping web analytics setUserId because no analytics instance is available.');
    return;
  }

  try {
    firebaseSetUserId(analytics, normalizedId);
  } catch (error) {
    console.warn('Web analytics setUserId failed:', error);
  }
}

if (typeof window !== 'undefined') {
  window.analytics = analytics || null;
  window.logEvent = (...args) => logAnalyticsEvent(...args);
  window.setUserProperties = (...args) => setAnalyticsUserProperties(...args);
}

export default {
  logEvent: logAnalyticsEvent,
  setUserProperties: setAnalyticsUserProperties,
  setUserId: setAnalyticsUserId
};

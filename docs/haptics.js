const ImpactStyle = {
  Light: 'LIGHT',
  Medium: 'MEDIUM',
  Heavy: 'HEAVY',
};

const NotificationType = {
  Success: 'SUCCESS',
  Warning: 'WARNING',
  Error: 'ERROR',
};

let hapticsEnabled = true;

if (typeof window !== 'undefined') {
  try {
    const storedPreference = window.localStorage?.getItem('hapticsEnabled');
    if (storedPreference !== null) {
      hapticsEnabled = storedPreference !== 'false';
    }
  } catch (error) {
    console.warn('Failed to read stored haptics preference', error);
  }
}

function getHapticsPlugin() {
  if (typeof window === 'undefined') {
    return null;
  }

  return (
    window.Capacitor?.Plugins?.Haptics ||
    window.Capacitor?.Haptics ||
    null
  );
}

async function safeInvoke(invoke) {
  if (!hapticsEnabled) {
    return;
  }

  const plugin = getHapticsPlugin();
  if (!plugin) {
    return;
  }

  try {
    await invoke(plugin);
  } catch (error) {
    console.warn('Haptics invocation failed', error);
  }
}

export async function playSuccess() {
  await safeInvoke((plugin) =>
    plugin.notification?.({ type: NotificationType.Success })
  );
}

export async function playMedium() {
  await safeInvoke((plugin) =>
    plugin.impact?.({ style: ImpactStyle.Medium })
  );
}

export async function playLight() {
  await safeInvoke((plugin) =>
    plugin.impact?.({ style: ImpactStyle.Light })
  );
}

export async function playTap() {
  await safeInvoke((plugin) =>
    plugin.impact?.({ style: ImpactStyle.Light })
  );
}

export function setHapticsEnabled(enabled) {
  hapticsEnabled = enabled !== false;
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage?.setItem('hapticsEnabled', hapticsEnabled ? 'true' : 'false');
  } catch (error) {
    console.warn('Failed to persist haptics preference', error);
  }
}

export function isHapticsEnabled() {
  return hapticsEnabled;
}

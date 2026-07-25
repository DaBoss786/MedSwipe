// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  playMedium,
  playTap,
  setHapticsEnabled
} from './haptics.js';

describe('quiz haptic preference', () => {
  const impact = vi.fn().mockResolvedValue();

  beforeEach(() => {
    impact.mockClear();
    window.Capacitor = {
      Plugins: {
        Haptics: { impact }
      }
    };
    setHapticsEnabled(true);
  });

  afterEach(() => {
    setHapticsEnabled(true);
    delete window.Capacitor;
  });

  it('keeps light tap and medium correctness impacts available when enabled', async () => {
    await playTap();
    await playMedium();
    expect(impact).toHaveBeenNthCalledWith(1, { style: 'LIGHT' });
    expect(impact).toHaveBeenNthCalledWith(2, { style: 'MEDIUM' });
  });

  it('suppresses both answer haptics when the user disables haptics', async () => {
    setHapticsEnabled(false);
    await playTap();
    await playMedium();
    expect(impact).not.toHaveBeenCalled();
  });
});

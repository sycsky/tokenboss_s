import { describe, it, expect } from 'vitest';
import { captureOAuthFragment, takeOAuthFragment } from '../oauthFragment';

describe('captureOAuthFragment', () => {
  it('moves the token out of the URL into the stash (one-shot read)', () => {
    window.history.replaceState(null, '', '/oauth/callback#token=jwt-abc&isNew=1');
    captureOAuthFragment();

    // The bearer token must be gone from the URL immediately — this runs
    // before Sentry.init, so nothing can capture location.href with it.
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/oauth/callback');

    expect(takeOAuthFragment()).toEqual({ token: 'jwt-abc', isNew: true });
    // One-shot: a second read is empty.
    expect(takeOAuthFragment()).toBeNull();
  });

  it('is a no-op on other pages even with a token-shaped hash', () => {
    window.history.replaceState(null, '', '/console#token=not-ours');
    captureOAuthFragment();
    expect(window.location.hash).toBe('#token=not-ours');
    expect(takeOAuthFragment()).toBeNull();
  });

  it('is a no-op on the callback page without a token', () => {
    window.history.replaceState(null, '', '/oauth/callback');
    captureOAuthFragment();
    expect(takeOAuthFragment()).toBeNull();
  });
});

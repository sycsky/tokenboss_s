/**
 * Frontend mirror of the backend credit config
 * (backend/src/lib/creditConfig.ts, served live at GET /v1/billing/config).
 *
 * These are the FALLBACK values used before that endpoint loads AND the
 * source for static pricing copy (the /pricing page renders synchronously,
 * so it can't await the config). The authoritative values are the backend's;
 * keep these in sync with its defaults so marketing copy, checkout preview,
 * and settlement never disagree.
 */

export const DEFAULT_CREDIT_RATE = 6.8;
export const MIN_TOPUP_USD = 10;
export const MAX_TOPUP_USD = 99999;

/** USD paid → call-quota credited. ×rate can leave a float tail
 *  (11×6.8 = 74.8000…1), so round to cents. */
export function creditFor(usd: number, rate: number = DEFAULT_CREDIT_RATE): number {
  return Math.round(usd * rate * 100) / 100;
}

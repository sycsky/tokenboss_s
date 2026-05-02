/**
 * Helpers for the API key expiry display + filtering. Backend returns
 * `expiresAt` as an ISO timestamp or null (= never expires).
 */

export interface ExpirableKey {
  expiresAt: string | null;
}

export function isExpired(k: ExpirableKey): boolean {
  if (k.expiresAt == null) return false;
  return new Date(k.expiresAt).getTime() <= Date.now();
}

export function expiryLabel(k: ExpirableKey): string {
  if (k.expiresAt == null) return '永久';
  const expiresMs = new Date(k.expiresAt).getTime();
  const diffMs = expiresMs - Date.now();
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMs <= 0) {
    const expiredDays = Math.max(1, Math.floor(-diffMs / 86_400_000));
    return `已过期 ${expiredDays} 天`;
  }
  if (diffDays < 1) return '今天到期';
  return `${diffDays} 天后过期`;
}

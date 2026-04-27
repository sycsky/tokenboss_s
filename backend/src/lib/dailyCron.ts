import { getActiveSubscriptionBuckets, expireBucketDaily, resetBucketDaily, logUsage } from './store.js';

export function runDailyExpireAndReset(): { expired: number; reset: number } {
  const buckets = getActiveSubscriptionBuckets();
  let expiredCount = 0;
  let resetCount = 0;

  for (const b of buckets) {
    if (!b.dailyCapUsd) continue;

    const leftover = b.dailyRemainingUsd ?? 0;
    if (leftover > 0) {
      expireBucketDaily(b.id);
      logUsage({
        userId: b.userId,
        bucketId: b.id,
        eventType: 'expire',
        amountUsd: -leftover,
        model: null, source: null, keyHint: null, tokensIn: null, tokensOut: null,
      });
      expiredCount++;
    }

    resetBucketDaily(b.id, b.dailyCapUsd);
    logUsage({
      userId: b.userId,
      bucketId: b.id,
      eventType: 'reset',
      amountUsd: b.dailyCapUsd,
      model: null, source: null, keyHint: null, tokensIn: null, tokensOut: null,
    });
    resetCount++;
  }

  return { expired: expiredCount, reset: resetCount };
}

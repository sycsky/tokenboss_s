// Verify the epusdt callback signing/verification logic against a fixture
// that mirrors the OrderNotifyResponse the epusdt fork actually sends.
//
// Why this matters: if our verifyCallback doesn't sign exactly the same
// way epusdt does, real webhooks will 403 and orders will never settle.
// This test seeds a payload, signs it as epusdt would (same util as Go),
// then runs our client.verifyCallback to make sure round-trip works.
//
// Run:  node scripts/probe-callback-sign.mjs

import crypto from 'node:crypto';

const SECRET = 'd8cd50d73531c57594a30d461edf061ec8ae52e81bf7eba87b1e32b46b0bc5af';

function sortedSign(params, secret) {
  const str = Object.keys(params)
    .filter(k => k !== 'signature' && params[k] !== '' && params[k] != null)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('md5').update(str + secret).digest('hex');
}

const payload = {
  pid: '1000',
  trade_id: 'T2026042701234567',
  order_id: 'tb_ord_abc123def456abc789ef0123',
  amount: 39,
  actual_amount: 5.4167,
  receive_address: 'TXyz1234567890abcdefghijklmn',
  token: 'usdt',
  block_transaction_id: '0xabcdefdeadbeef',
  status: 2,
};
payload.signature = sortedSign(payload, SECRET);

console.log('[fixture] payload:', JSON.stringify(payload, null, 2));

const { createEpusdtClient } = await import('../dist/lib/payment/epusdt.js')
  .catch(async () => {
    // dev path: tsx is the dev runner, dist may not exist
    return await import('../src/lib/payment/epusdt.ts');
  });

const client = createEpusdtClient({
  baseUrl: 'https://example.invalid',
  pid: '1000',
  secret: SECRET,
});

const ok = client.verifyCallback(payload);
console.log('[verify] result:', ok);

if (!ok) {
  console.error('[verify] FAILED — verifyCallback returned null');
  process.exit(1);
}

if (ok.status !== 'paid') {
  console.error(`[verify] FAILED — expected status=paid, got ${ok.status}`);
  process.exit(1);
}

if (ok.orderId !== payload.order_id) {
  console.error(`[verify] FAILED — orderId mismatch`);
  process.exit(1);
}

// Tampered signature must reject.
const bad = { ...payload, signature: '0'.repeat(32) };
const rejected = client.verifyCallback(bad);
if (rejected !== null) {
  console.error('[verify] FAILED — bad signature was accepted');
  process.exit(1);
}

// Tampered payload (recompute would fail) must reject.
const tampered = { ...payload, amount: 999999 };
const rejected2 = client.verifyCallback(tampered);
if (rejected2 !== null) {
  console.error('[verify] FAILED — tampered amount was accepted');
  process.exit(1);
}

console.log('[verify] PASS — sign + verify roundtrip + tamper detection all OK');

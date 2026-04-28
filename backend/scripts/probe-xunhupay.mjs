// Probe the xunhupay (虎皮椒) gateway: sign + create order, then verify
// our verifyCallback round-trips a synthetic webhook payload.
//
// Run: node scripts/probe-xunhupay.mjs
//
// Reads from env (with hard-coded test fallbacks):
//   XUNHUPAY_APPID
//   XUNHUPAY_APPSECRET
//   XUNHUPAY_GATEWAY_URL  (default: https://api.xunhupay.com/payment/do.html)
//   XUNHUPAY_NOTIFY_URL   (default: https://son-cho.com/v1/billing/webhook/xunhupay)
//   XUNHUPAY_RETURN_URL   (default: https://son-cho.com/billing/success)
//
// Skip the network call entirely with: SKIP_NETWORK=1

import crypto from 'node:crypto';

const APPID = process.env.XUNHUPAY_APPID;
const APPSECRET = process.env.XUNHUPAY_APPSECRET;
const GATEWAY = process.env.XUNHUPAY_GATEWAY_URL ?? 'https://api.xunhupay.com/payment/do.html';
const NOTIFY = process.env.XUNHUPAY_NOTIFY_URL ?? 'https://son-cho.com/v1/billing/webhook/xunhupay';
const RETURN = process.env.XUNHUPAY_RETURN_URL ?? 'https://son-cho.com/billing/success';

function sign(params, secret) {
  const str = Object.keys(params)
    .filter(k => k !== 'hash' && params[k] !== '' && params[k] != null)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('md5').update(str + secret).digest('hex');
}

// ---------- 1. Local sign/verify roundtrip (no network) ----------

{
  const payload = {
    appid: '201906179422',
    trade_order_id: 'tb_ord_probe1',
    total_fee: '39.00',
    transaction_id: '2026042700000001',
    open_order_id: 'XHP00000001',
    order_title: 'Probe',
    status: 'OD',
    plugins: '',
    attach: '',
    time: '1745800000',
    nonce_str: '0123456789abcdef0123456789abcdef',
  };
  payload.hash = sign(payload, 'test-secret');

  const { createXunhupayClient } = await import('../dist/lib/payment/xunhupay.js')
    .catch(async () => import('../src/lib/payment/xunhupay.ts'));

  const client = createXunhupayClient({
    appid: '201906179422',
    appsecret: 'test-secret',
  });

  const ok = client.verifyCallback(payload);
  if (!ok) throw new Error('local verify failed — verifyCallback returned null');
  if (ok.status !== 'paid') throw new Error(`status mismatch: ${ok.status}`);
  if (ok.orderId !== payload.trade_order_id) throw new Error('orderId mismatch');

  // Tamper detection.
  const bad = { ...payload, hash: '0'.repeat(32) };
  if (client.verifyCallback(bad) !== null) throw new Error('bad hash accepted');

  const tampered = { ...payload, total_fee: '99999.00' };
  if (client.verifyCallback(tampered) !== null) throw new Error('tampered amount accepted');

  console.log('[verify] PASS — local sign/verify roundtrip + tamper detection OK');
}

// ---------- 2. Real createOrder (hits xunhupay gateway) ----------

if (process.env.SKIP_NETWORK === '1') {
  console.log('[probe] SKIP_NETWORK=1, skipping real gateway call');
  process.exit(0);
}

if (!APPID || !APPSECRET) {
  console.log('[probe] XUNHUPAY_APPID / XUNHUPAY_APPSECRET not set — skipping gateway call');
  console.log('[probe] (set them to hit the real gateway, or SKIP_NETWORK=1 to silence)');
  process.exit(0);
}

const body = {
  appid: APPID,
  version: '1.1',
  trade_order_id: `probe_${Date.now()}`,
  total_fee: '0.01',
  title: 'TokenBoss probe',
  time: Math.floor(Date.now() / 1000),
  nonce_str: crypto.randomBytes(16).toString('hex'),
  notify_url: NOTIFY,
  return_url: RETURN,
  type: 'WAP',
  wap_url: RETURN,
  wap_name: 'TokenBoss',
};
body.hash = sign(body, APPSECRET);

console.log('[probe] sending to', GATEWAY);
console.log('[probe] body', body);

const form = new URLSearchParams();
for (const [k, v] of Object.entries(body)) {
  if (v === '' || v == null) continue;
  form.append(k, String(v));
}

const res = await fetch(GATEWAY, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: form.toString(),
});
console.log('[probe] status', res.status);
const text = await res.text();
console.log('[probe] response', text);

try {
  const json = JSON.parse(text);
  if (json.errcode === 0 && json.url) {
    console.log('[probe] PASS — gateway returned a checkout URL:');
    console.log('  ', json.url);
    if (json.url_qrcode) console.log('   QR:', json.url_qrcode);
  } else {
    console.error(`[probe] FAIL — errcode=${json.errcode} errmsg=${json.errmsg}`);
    process.exit(1);
  }
} catch {
  console.error('[probe] FAIL — non-json response');
  process.exit(1);
}

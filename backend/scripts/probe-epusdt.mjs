// Probe the deployed epusdt instance: sign + create transaction.
// Usage: node scripts/probe-epusdt.mjs
//
// Reads from env (or hard-coded fallback for local probe):
//   EPUSDT_BASE_URL, EPUSDT_PID, EPUSDT_SECRET
import crypto from 'node:crypto';

const BASE = process.env.EPUSDT_BASE_URL || 'https://esudt.zeabur.app';
const PID = process.env.EPUSDT_PID || '1000';
const SECRET = process.env.EPUSDT_SECRET || 'd8cd50d73531c57594a30d461edf061ec8ae52e81bf7eba87b1e32b46b0bc5af';

function sign(params, secret) {
  const str = Object.keys(params)
    .filter(k => k !== 'signature' && params[k] !== '' && params[k] != null)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('md5').update(str + secret).digest('hex');
}

const body = {
  pid: PID,
  order_id: `probe_${Date.now()}`,
  currency: 'cny',
  token: 'usdt',
  network: 'tron',
  amount: 1.00,
  notify_url: 'https://example.com/notify',
  redirect_url: 'https://example.com/return',
};
body.signature = sign(body, SECRET);

console.log('[probe] sending', JSON.stringify(body, null, 2));

const res = await fetch(`${BASE}/payments/gmpay/v1/order/create-transaction`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
console.log('[probe] status', res.status);
console.log('[probe] body', await res.text());

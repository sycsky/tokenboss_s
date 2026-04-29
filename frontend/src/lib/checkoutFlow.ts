import type { NavigateFunction } from 'react-router-dom';
import type { BillingChannel, CreateOrderResponse } from './api';

/**
 * Distinguish "phone" from "PC". `pointer: coarse` matches touch-primary
 * devices, which on real Android/iOS phones is the most reliable signal —
 * UA sniffing alone misses tablets-with-keyboard and Chinese in-app
 * webviews. Width fallback covers DevTools "device toolbar" testing.
 */
export function isMobileLike(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const narrow = window.innerWidth < 768;
  const ua = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return coarse || narrow || ua;
}

/**
 * Drive the post-create-order navigation. Branches on channel + form factor:
 *   xunhupay + mobile : same-window deeplink to Alipay H5
 *   xunhupay + PC     : navigate to OrderStatus with QR in nav state
 *   epusdt   + mobile : same-window to gateway hosted page
 *   epusdt   + PC     : open gateway in new tab + navigate to OrderStatus
 *
 * The same routine works for both plan and topup orders — the only
 * difference upstream is order shape, not navigation behaviour.
 *
 * Fire-and-forget: returns void, never throws. Caller need not reset
 * submitting state — the navigation that follows will unmount the form.
 */
export function dispatchCheckout(
  res: CreateOrderResponse,
  channel: BillingChannel,
  navigate: NavigateFunction,
  detectMobile: () => boolean = isMobileLike,
) {
  const mobile = detectMobile();

  if (channel === 'xunhupay' && mobile) {
    // Mobile + 支付宝: same-window navigation, popups blocked / deeplinks
    // must run in the user's primary browser context. The gateway redirects
    // back to /billing/success?orderId=... after payment.
    window.location.href = res.paymentUrl;
    return;
  }

  if (channel === 'xunhupay' && !mobile && res.qrCodeUrl) {
    // PC + 支付宝: render QR inline on OrderStatus so the user never
    // leaves our app. qrCodeUrl is not stored server-side; pass via nav
    // state. Hard refresh on OrderStatus falls back to a "重新打开支付页"
    // link built from order.paymentUrl.
    navigate(`/billing/orders/${encodeURIComponent(res.orderId)}`, {
      state: { qrCodeUrl: res.qrCodeUrl, paymentUrl: res.paymentUrl },
    });
    return;
  }

  // epusdt: gateway-hosted checkout. Open in new tab on PC, same-window
  // on mobile. Mobile + xunhupay without qrCodeUrl falls through here too.
  if (res.paymentUrl) {
    if (mobile) window.location.href = res.paymentUrl;
    else window.open(res.paymentUrl, '_blank', 'noopener,noreferrer');
  }
  navigate(`/billing/orders/${encodeURIComponent(res.orderId)}`);
}

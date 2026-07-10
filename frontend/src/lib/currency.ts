import { createContext, useContext, useEffect, useState, type ReactNode, createElement } from 'react';

/**
 * Display currency for pricing surfaces (套餐 cards, 按量充值 row).
 *
 *  - 'rmb' : ¥288 / 4 周 · ¥1 = $1 调用额度 · 充值面额 ¥10/¥50
 *  - 'usd' : $49 USD / 4 周 · $1 USD = $7 调用额度 · $1 起
 *
 * Display-only — actual checkout: RMB topup goes through in-agent Alipay
 * A2M (402, /billing/topup shows the copyable prompt); USD goes through
 * the USDT/USDC web gateway where the user picks the chain. We label the price as plain "USD" because the user pays USD
 * value, regardless of which stablecoin they ultimately settle in.
 *
 * Storage is plain localStorage; first visit defaults via browser locale
 * (zh-CN → 'rmb', else 'usd'). Old `'usdc'` values written by earlier
 * versions are accepted and mapped to `'usd'` for forward compat.
 */
export type Currency = 'rmb' | 'usd';

const STORAGE_KEY = 'tb_currency';

function detectDefault(): Currency {
  if (typeof navigator === 'undefined') return 'rmb';
  const lang = (navigator.language || '').toLowerCase();
  return lang.startsWith('zh') ? 'rmb' : 'usd';
}

function readStored(): Currency | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'rmb') return 'rmb';
    if (v === 'usd' || v === 'usdc') return 'usd';
    return null;
  } catch {
    return null;
  }
}

function writeStored(c: Currency) {
  try {
    localStorage.setItem(STORAGE_KEY, c);
  } catch {
    /* private mode — selection won't persist */
  }
}

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (c: Currency) => void;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(() => readStored() ?? detectDefault());

  // If another tab updates the choice, mirror it here. Accept legacy
  // 'usdc' values from older versions and normalize to 'usd'.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      if (e.newValue === 'rmb') setCurrencyState('rmb');
      else if (e.newValue === 'usd' || e.newValue === 'usdc') setCurrencyState('usd');
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  function setCurrency(c: Currency) {
    setCurrencyState(c);
    writeStored(c);
  }

  return createElement(CurrencyContext.Provider, { value: { currency, setCurrency } }, children);
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    // Safe fallback for stories / tests that forget to wrap.
    return {
      currency: 'rmb',
      setCurrency: () => {
        /* no-op outside provider */
      },
    };
  }
  return ctx;
}

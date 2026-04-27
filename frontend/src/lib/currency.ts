import { createContext, useContext, useEffect, useState, type ReactNode, createElement } from 'react';

/**
 * Display currency for pricing surfaces (套餐 cards, 按量充值 row).
 *
 *  - 'rmb'  : ¥288 / 4 周 · ¥1 = $1 调用额度 · ¥50 起
 *  - 'usdc' : $49 USDC / 4 周 · $1 USDC = $6.5 调用额度 · $10 USDC 起
 *
 * Display-only — actual checkout method is selected in /billing/pay.
 * Storage is plain localStorage; first visit defaults via browser locale
 * (zh-CN → 'rmb', else 'usdc').
 */
export type Currency = 'rmb' | 'usdc';

const STORAGE_KEY = 'tb_currency';

function detectDefault(): Currency {
  if (typeof navigator === 'undefined') return 'rmb';
  const lang = (navigator.language || '').toLowerCase();
  return lang.startsWith('zh') ? 'rmb' : 'usdc';
}

function readStored(): Currency | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'rmb' || v === 'usdc' ? v : null;
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

  // If another tab updates the choice, mirror it here.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY && (e.newValue === 'rmb' || e.newValue === 'usdc')) {
        setCurrencyState(e.newValue);
      }
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

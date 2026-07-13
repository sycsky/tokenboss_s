import { describe, it, expect, afterEach } from "vitest";

import {
  creditRateFor,
  getCreditRates,
  DEFAULT_CREDIT_RATES,
} from "../creditConfig.js";

const RATE_ENVS = [
  "CREDIT_RATE",
  "CREDIT_RATE_EPUSDT",
  "CREDIT_RATE_DODO",
] as const;

afterEach(() => {
  for (const k of RATE_ENVS) delete process.env[k];
});

describe("creditConfig rates", () => {
  it("defaults to per-channel rates: stablecoin 7, card/WeChat 6.88", () => {
    expect(DEFAULT_CREDIT_RATES).toEqual({ epusdt: 7, dodo: 6.88 });
    expect(creditRateFor("epusdt")).toBe(7);
    expect(creditRateFor("dodo")).toBe(6.88);
    expect(getCreditRates()).toEqual({ epusdt: 7, dodo: 6.88 });
  });

  it("non-USD channels bypass the rate table (¥1=$1 → rate 1)", () => {
    expect(creditRateFor("xunhupay")).toBe(1);
    expect(creditRateFor("alipay_a2m")).toBe(1);
  });

  it("per-channel env overrides win over the shared CREDIT_RATE", () => {
    process.env.CREDIT_RATE = "5";
    process.env.CREDIT_RATE_DODO = "6.5";
    expect(creditRateFor("dodo")).toBe(6.5); // per-channel wins
    expect(creditRateFor("epusdt")).toBe(5); // falls back to shared
  });

  it("ignores non-positive / non-numeric env and keeps the default", () => {
    process.env.CREDIT_RATE_EPUSDT = "0";
    process.env.CREDIT_RATE_DODO = "abc";
    expect(creditRateFor("epusdt")).toBe(7);
    expect(creditRateFor("dodo")).toBe(6.88);
  });
});

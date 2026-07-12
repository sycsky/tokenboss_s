/**
 * GET /v1/billing/config — 公开的充值配置（无需鉴权）。前端充值页拉
 * 取它来展示「付 $X → 到账 $Y」的预览，保证与后端结算用的同一份倍率，
 * 不再前后端各写一个 6.8。权威值始终在后端 creditConfig，这里只读。
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

import {
  getCreditRates,
  MIN_TOPUP_AMOUNT,
  MAX_TOPUP_AMOUNT,
} from "../lib/creditConfig.js";

export const billingConfigHandler = async (
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
      // 小额缓存：倍率很少变，避免每次进充值页都打一发。
      "cache-control": "public, max-age=300",
    },
    body: JSON.stringify({
      creditRates: getCreditRates(),
      minTopup: MIN_TOPUP_AMOUNT,
      maxTopup: MAX_TOPUP_AMOUNT,
    }),
  };
};

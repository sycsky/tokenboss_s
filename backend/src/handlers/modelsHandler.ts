/**
 * GET /v1/models — transparent passthrough to newapi's `/v1/models`.
 *
 * ClawRouter's doctor and model-listing commands call this endpoint. We do
 * no filtering or renaming — whatever newapi returns (shape: OpenAI-style
 * `{object:"list", data:[...]}`) is forwarded verbatim.
 *
 * Auth mirrors the chat proxy: the caller's `Authorization: Bearer sk-xxx`
 * is passed through, newapi validates it.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

function getNewapiBase(): string | null {
  const raw = process.env.NEWAPI_BASE_URL?.trim().replace(/\/+$/, "");
  return raw && raw.length > 0 ? raw : null;
}

export const modelsHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const base = getNewapiBase();
  if (!base) {
    return {
      statusCode: 503,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: {
          type: "service_unavailable",
          message: "Models endpoint unavailable — NEWAPI_BASE_URL is not configured.",
          code: "newapi_not_configured",
        },
      }),
    };
  }

  const authHeader =
    event.headers?.authorization ?? event.headers?.Authorization;

  try {
    const upstream = await fetch(`${base}/v1/models`, {
      method: "GET",
      headers: authHeader ? { authorization: authHeader } : {},
    });
    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
      body: text,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: {
          type: "upstream_error",
          message: `Failed to reach upstream: ${(err as Error).message}`,
        },
      }),
    };
  }
};

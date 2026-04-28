/**
 * GET /v1/router/tiers — public ClawRouter tier-config endpoint.
 *
 * ClawRouter (installed as an openclaw plugin on end-user machines) pulls
 * this on startup and periodically, so the operator can update the tier
 * routing (primary/fallback per SIMPLE|MEDIUM|COMPLEX|REASONING) without
 * shipping a new client release.
 *
 * Storage is a plain JSON file at `backend/config/router-tiers.json`. Edit the
 * file on the server; clients pick up changes on their next refresh tick.
 *
 * No auth — the tier mapping is not confidential and making this public
 * keeps plugin install friction low.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from "aws-lambda";

const CONFIG_PATH = join(process.cwd(), "config", "router-tiers.json");

export const routerTiersHandler = async (
  _event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    // Validate it parses as JSON before returning — a malformed file should
    // surface as a 500 here rather than corrupt every downstream router.
    JSON.parse(raw);
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=60",
      },
      body: raw,
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        error: {
          type: "server_error",
          message: `Failed to load router tiers: ${(err as Error).message}`,
        },
      }),
    };
  }
};

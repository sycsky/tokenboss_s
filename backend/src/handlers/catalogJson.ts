/**
 * GET /api/catalog.json
 *
 * Returns a static catalog of all model IDs referenced in the routing config,
 * derived from DEFAULT_ROUTING_CONFIG.tiers (and eco/premium/agentic variants).
 * No auth required — this endpoint is public.
 *
 * Price fields are intentionally null: the backend does not store per-model
 * pricing and fabricating values would be misleading. Operators can overlay
 * prices via their own configuration layer.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DEFAULT_ROUTING_CONFIG } from "../router/config.js";

interface CatalogModel {
  id: string;
  tierGroups: string[];
  pricePerMTokenIn: null;
  pricePerMTokenOut: null;
}

function collectModels(): CatalogModel[] {
  const groups: Array<{ name: string; tiers: typeof DEFAULT_ROUTING_CONFIG.tiers }> = [
    { name: "standard", tiers: DEFAULT_ROUTING_CONFIG.tiers },
    { name: "eco", tiers: DEFAULT_ROUTING_CONFIG.ecoTiers },
    { name: "premium", tiers: DEFAULT_ROUTING_CONFIG.premiumTiers },
    { name: "agentic", tiers: DEFAULT_ROUTING_CONFIG.agenticTiers },
  ];

  // Map from modelId -> set of group names where it appears
  const seen = new Map<string, Set<string>>();

  for (const group of groups) {
    for (const tierConfig of Object.values(group.tiers)) {
      const ids: string[] = [tierConfig.primary, ...tierConfig.fallback];
      for (const id of ids) {
        if (!seen.has(id)) seen.set(id, new Set());
        seen.get(id)!.add(group.name);
      }
    }
  }

  // Sort deterministically: primary standard-tier model first, then alphabetical
  const entries = Array.from(seen.entries());
  entries.sort(([a], [b]) => a.localeCompare(b));

  return entries.map(([id, groupSet]) => ({
    id,
    tierGroups: Array.from(groupSet).sort(),
    pricePerMTokenIn: null,
    pricePerMTokenOut: null,
  }));
}

export async function catalogJsonHandler(
  _evt: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const models = collectModels();

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({ models, generatedAt: new Date().toISOString() }),
  };
}

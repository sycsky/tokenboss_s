#!/usr/bin/env node
/**
 * ClawRouter CLI
 *
 * Standalone proxy for deployed setups where the proxy needs to survive gateway restarts.
 *
 * Usage:
 *   npx @blockrun/clawrouter              # Start standalone proxy
 *   npx @blockrun/clawrouter --version    # Show version
 *   npx @blockrun/clawrouter --port 8402  # Custom port
 *
 * For production deployments, use with PM2:
 *   pm2 start "npx @blockrun/clawrouter" --name clawrouter
 */

import { startProxy, getProxyPort } from "./proxy.js";
import { startRemoteTiersRefresh } from "./router/remote-tiers.js";
import { VERSION } from "./version.js";
import { generateReport } from "./report.js";
import { formatRecentLogs } from "./stats.js";

function printHelp(): void {
  console.log(`
TokenBoss Router v${VERSION} - Smart LLM Router

Usage:
  tokenboss-router [options]
  tokenboss-router status              # Live proxy status
  tokenboss-router models              # List available models
  tokenboss-router stats [--days <n>]  # Usage stats (default: 7 days)
  tokenboss-router report [daily|weekly|monthly] [--json]
  tokenboss-router logs [--days <n>]

Options:
  --version, -v     Show version number
  --help, -h        Show this help message
  --port <number>   Port to listen on (default: ${getProxyPort()})

Query Commands (talk to running proxy on localhost:${getProxyPort()}):
  status            Proxy status
  models            List all available models with pricing
  stats             Usage breakdown: requests, cost, top models
  stats --days 14   Custom time range (max 30 days)
  cache             Response cache stats (hit rate, size)

Management Commands:
  logs              Per-request breakdown: model, cost, latency, status
  logs --days 7     Show last 7 days of requests (default: 1 day)
  report            Usage report

Environment Variables:
  TOKENBOSS_API_URL       TokenBoss API URL
  TOKENBOSS_API_KEY       TokenBoss API key (tb_live_xxx)
  TOKENBOSS_PROXY_PORT    Default proxy port (default: 8402)

For more info: https://github.com/sycsky/tokenboss_s
`);
}

/** Query the running proxy HTTP API */
async function queryProxy(path: string, port: number): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function cmdStatus(port: number): Promise<void> {
  try {
    const data = (await queryProxy("/health?full=true", port)) as Record<string, unknown>;
    console.log(`
TokenBoss Router Status (port ${port})
`);
    console.log(`  Status:        ${data.status}`);
    if (data.upstreamProxy) console.log(`  Upstream Proxy: ${data.upstreamProxy}`);
    console.log();
  } catch {
    console.error(`✗ Cannot connect to TokenBoss Router on port ${port}`);
    console.error(`  Is the proxy running? Start with: npx tokenboss-router`);
    process.exit(1);
  }
}


async function cmdModels(port: number): Promise<void> {
  try {
    const data = (await queryProxy("/v1/models", port)) as {
      data: Array<{ id: string; owned_by?: string }>;
    };
    console.log(`\nAvailable Models (${data.data.length})\n`);

    // Group by provider
    const groups = new Map<string, string[]>();
    for (const m of data.data) {
      const provider = m.id.includes("/") ? m.id.split("/")[0] : "blockrun";
      if (!groups.has(provider)) groups.set(provider, []);
      groups.get(provider)!.push(m.id);
    }

    for (const [provider, models] of groups) {
      console.log(`  ${provider} (${models.length}):`);
      for (const id of models) {
        console.log(`    ${id}`);
      }
      console.log();
    }
  } catch {
    console.error(`✗ Cannot connect to ClawRouter on port ${port}`);
    process.exit(1);
  }
}

async function cmdStats(port: number, days: number): Promise<void> {
  try {
    const data = (await queryProxy(`/stats?days=${days}`, port)) as Record<string, unknown>;
    const stats = data as {
      totalRequests?: number;
      totalCostUsd?: number;
      savedUsd?: number;
      savingsPercent?: number;
      topModels?: Array<{ model: string; requests: number; costUsd: number }>;
    };

    console.log(`\nUsage Stats (last ${days} days)\n`);
    console.log(`  Requests: ${stats.totalRequests ?? 0}`);
    console.log(`  Cost:     $${(stats.totalCostUsd ?? 0).toFixed(4)}`);
    if (stats.savedUsd) {
      console.log(
        `  Saved:    $${stats.savedUsd.toFixed(4)} (${stats.savingsPercent?.toFixed(0) ?? 0}% vs Opus)`,
      );
    }

    if (stats.topModels && stats.topModels.length > 0) {
      console.log();
      console.log(`  Top Models:`);
      for (const m of stats.topModels.slice(0, 10)) {
        console.log(
          `    ${m.model.padEnd(40)} ${String(m.requests).padStart(5)} reqs  $${m.costUsd.toFixed(4)}`,
        );
      }
    }
    console.log();
  } catch {
    console.error(`✗ Cannot connect to ClawRouter on port ${port}`);
    process.exit(1);
  }
}

async function cmdCache(port: number): Promise<void> {
  try {
    const data = (await queryProxy("/cache", port)) as Record<string, unknown>;
    console.log(`\nCache Stats\n`);
    for (const [key, value] of Object.entries(data)) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
    console.log();
  } catch {
    console.error(`✗ Cannot connect to ClawRouter on port ${port}`);
    process.exit(1);
  }
}

function parseArgs(args: string[]): {
  version: boolean;
  help: boolean;
  logs: boolean;
  logsDays: number;
  report: boolean;
  reportPeriod: "daily" | "weekly" | "monthly";
  reportJson: boolean;
  port?: number;
  // Query commands
  queryStatus: boolean;
  queryModels: boolean;
  queryStats: boolean;
  queryStatsDays: number;
  queryCache: boolean;
} {
  const result = {
    version: false,
    help: false,
    logs: false,
    logsDays: 1,
    report: false,
    reportPeriod: "daily" as "daily" | "weekly" | "monthly",
    reportJson: false,
    port: undefined as number | undefined,
    queryStatus: false,
    queryModels: false,
    queryStats: false,
    queryStatsDays: 7,
    queryCache: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--version" || arg === "-v") {
      result.version = true;
    } else if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "status") {
      result.queryStatus = true;
    } else if (arg === "models") {
      result.queryModels = true;
    } else if (arg === "stats") {
      result.queryStats = true;
      if (args[i + 1] === "--days" && args[i + 2]) {
        result.queryStatsDays = Math.min(parseInt(args[i + 2], 10) || 7, 30);
        i += 2;
      }
    } else if (arg === "cache") {
      result.queryCache = true;
    } else if (arg === "logs") {
      result.logs = true;
      if (args[i + 1] === "--days" && args[i + 2]) {
        result.logsDays = parseInt(args[i + 2], 10) || 1;
        i += 2;
      }
    } else if (arg === "report") {
      result.report = true;
      const next = args[i + 1];
      if (next && ["daily", "weekly", "monthly"].includes(next)) {
        result.reportPeriod = next as "daily" | "weekly" | "monthly";
        i++;
        if (args[i + 1] === "--json") {
          result.reportJson = true;
          i++;
        }
      } else if (next === "--json") {
        result.reportJson = true;
        i++;
      }
    } else if (arg === "--port" && args[i + 1]) {
      result.port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(VERSION);
    process.exit(0);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Query commands — talk to running proxy
  const queryPort = args.port ?? getProxyPort();

  if (args.queryStatus) {
    await cmdStatus(queryPort);
    process.exit(0);
  }
  if (args.queryModels) {
    await cmdModels(queryPort);
    process.exit(0);
  }
  if (args.queryStats) {
    await cmdStats(queryPort, args.queryStatsDays);
    process.exit(0);
  }
  if (args.queryCache) {
    await cmdCache(queryPort);
    process.exit(0);
  }

  if (args.logs) {
    const output = await formatRecentLogs(args.logsDays);
    console.log(output);
    process.exit(0);
  }

  if (args.report) {
    const report = await generateReport(args.reportPeriod, args.reportJson);
    console.log(report);
    process.exit(0);
  }

  // Pull tier config from TokenBoss. Await the initial fetch so the first
  // incoming request already uses remote config.
  await startRemoteTiersRefresh();

  // Start the proxy
  const proxy = await startProxy({
    port: args.port,
    onReady: (port) => {
      console.log(`[TokenBoss] v${VERSION} | Proxy listening on http://127.0.0.1:${port}`);
      console.log(`[TokenBoss] Health check: http://127.0.0.1:${port}/health`);
    },
    onError: (error) => {
      console.error(`[TokenBoss] Error: ${error.message}`);
    },
    onRouted: (decision) => {
      const cost = decision.costEstimate.toFixed(4);
      const saved = (decision.savings * 100).toFixed(0);
      console.log(`[TokenBoss] [${decision.tier}] ${decision.model} $${cost} (saved ${saved}%)`);
    },
  });

  console.log(`[TokenBoss] Ready - Ctrl+C to stop`);

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`
[TokenBoss] Received ${signal}, shutting down...`);
    try {
      await proxy.close();
      console.log(`[TokenBoss] Proxy closed`);
      process.exit(0);
    } catch (err) {
      console.error(`[TokenBoss] Error during shutdown: ${err}`);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Keep process alive
  await new Promise(() => {});
}


main().catch((err) => {
  console.error(`[TokenBoss] Fatal error: ${err.message}`);
  process.exit(1);
});

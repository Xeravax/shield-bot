#!/usr/bin/env node
/**
 * Manual Grafana HTTP API requests using .grafana-token.
 *
 * Examples:
 *   node scripts/grafana-request.mjs GET /api/datasources
 *   node scripts/grafana-request.mjs GET /api/dashboards/uid/8ff0ffd0-832c-476e-bb20-5396b6eedf10
 *   node scripts/grafana-request.mjs POST /api/dashboards/db @grafana/payload.json
 */
import { readFileSync, existsSync } from "node:fs";
import { grafanaFetch } from "./grafana-api.mjs";

async function main() {
  const method = (process.argv[2] ?? "GET").toUpperCase();
  const pathArg = process.argv[3];
  const bodyArg = process.argv[4];

  if (!pathArg || !pathArg.startsWith("/")) {
    throw new Error("Usage: grafana-request.mjs <METHOD> </api/path> [@body.json]");
  }

  const options = { method };
  if (bodyArg) {
    const bodyPath = bodyArg.startsWith("@") ? bodyArg.slice(1) : bodyArg;
    if (!existsSync(bodyPath)) {
      throw new Error(`Body file not found: ${bodyPath}`);
    }
    options.body = readFileSync(bodyPath, "utf8");
  }

  const result = await grafanaFetch(pathArg, options);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

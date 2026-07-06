/**
 * Token-based Grafana HTTP API client (no MCP / Assistant CLI).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..");
export const GRAFANA_URL = (process.env.GRAFANA_URL ?? "https://metrics.vrcshield.com").replace(/\/$/, "");
export const TOKEN_FILE =
  process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE ?? join(ROOT, ".grafana-token");

export function readToken() {
  if (process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN) {
    return process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN.trim();
  }
  if (!existsSync(TOKEN_FILE)) {
    throw new Error(
      `Grafana token not found. Create ${TOKEN_FILE} with a service account token (see .grafana-token.example).`,
    );
  }
  const raw = readFileSync(TOKEN_FILE, "utf8");
  const tokenLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && line.startsWith("glsa_"));
  if (!tokenLine) {
    throw new Error(
      `No glsa_ token found in ${TOKEN_FILE}. Add a service account token on its own line.`,
    );
  }
  return tokenLine;
}

export async function grafanaFetch(path, options = {}) {
  const token = readToken();
  const res = await fetch(`${GRAFANA_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`Grafana API ${path} failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

export async function listDatasources() {
  return grafanaFetch("/api/datasources");
}

export async function searchDashboards(query) {
  const params = new URLSearchParams({ query, type: "dash-db" });
  return grafanaFetch(`/api/search?${params}`);
}

export async function getDashboardByUid(uid) {
  return grafanaFetch(`/api/dashboards/uid/${uid}`);
}

export function dashboardDeeplink(uid, from = "now-6M", to = "now") {
  return `${GRAFANA_URL}/d/${uid}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}

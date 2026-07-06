#!/usr/bin/env node
/**
 * Deploy or update Grafana dashboards via the HTTP API + .grafana-token.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  GRAFANA_URL,
  grafanaFetch,
  listDatasources,
  searchDashboards,
  getDashboardByUid,
  dashboardDeeplink,
} from "./grafana-api.mjs";

const DASHBOARD_FILE = join(ROOT, "grafana", "dashboard.json");

function bindMysqlDatasource(dashboard, mysqlUid) {
  const clone = structuredClone(dashboard);
  delete clone.__inputs;
  delete clone.__elements;
  delete clone.__requires;
  for (const panel of clone.panels ?? []) {
    if (panel.datasource?.type === "mysql") {
      panel.datasource.uid = mysqlUid;
    }
    for (const target of panel.targets ?? []) {
      if (target.datasource?.type === "mysql") {
        target.datasource.uid = mysqlUid;
      }
    }
  }
  return clone;
}

async function deployDashboard(mysqlUid, message) {
  const raw = JSON.parse(readFileSync(DASHBOARD_FILE, "utf8"));
  const dashboard = bindMysqlDatasource(raw, mysqlUid);
  const uid = dashboard.uid;

  let overwrite = false;
  let existingMeta = null;
  try {
    const existing = await getDashboardByUid(uid);
    overwrite = true;
    existingMeta = existing.meta;
    dashboard.id = existing.dashboard.id;
    dashboard.version = existing.dashboard.version;
    console.log(`Dashboard uid=${uid} exists (id=${dashboard.id}, version=${dashboard.version}); updating.`);
  } catch {
    console.log(`Dashboard uid=${uid} not found; creating.`);
  }

  return grafanaFetch("/api/dashboards/db", {
    method: "POST",
    body: JSON.stringify({
      dashboard,
      folderUid: existingMeta?.folderUid || process.env.GRAFANA_FOLDER_UID || undefined,
      folderId: existingMeta?.folderId || undefined,
      overwrite,
      message,
    }),
  });
}

async function main() {
  const command = process.argv[2] ?? "deploy";

  if (command === "discover") {
    const datasources = await listDatasources();
    const mysql = datasources.filter((d) => d.type === "mysql");
    const dashboards = await searchDashboards("shield patrol");
    console.log(JSON.stringify({ datasources: mysql, dashboards }, null, 2));
    return;
  }

  if (command === "verify") {
    const local = JSON.parse(readFileSync(DASHBOARD_FILE, "utf8"));
    const live = await getDashboardByUid(local.uid);
    const liveBugPanels = (live.dashboard.panels ?? [])
      .filter((p) => p.targets?.[0]?.rawSql?.includes("$__timeFilter(createdAt)"))
      .map((p) => p.title);
    console.log(
      JSON.stringify(
        {
          deeplink: dashboardDeeplink(local.uid, local.time?.from, local.time?.to),
          liveTimeRange: live.dashboard.time,
          localTimeRange: local.time,
          liveBugPanels,
          needsDeploy: liveBugPanels.length > 0,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "deploy") {
    const datasources = await listDatasources();
    const mysql =
      datasources.find((d) => d.type === "mysql" && /mysql/i.test(d.name)) ??
      datasources.find((d) => d.type === "mysql");
    if (!mysql) {
      throw new Error("No MySQL datasource found in Grafana");
    }
    console.log(`Using MySQL datasource: ${mysql.name} (uid=${mysql.uid})`);
    const message = process.argv[3] ?? "Shield Bot dashboard update";
    const result = await deployDashboard(mysql.uid, message);
    const url = result.url ? `${GRAFANA_URL}${result.url}` : `${GRAFANA_URL}/d/${result.uid}`;
    console.log(JSON.stringify({ ...result, deeplink: url }, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${command}. Use: discover | verify | deploy`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

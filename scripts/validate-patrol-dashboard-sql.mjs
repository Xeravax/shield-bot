#!/usr/bin/env node
/**
 * Validate patrol dashboard SQL against the bot database (no Grafana required).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboard = JSON.parse(
  readFileSync(join(__dirname, "..", "grafana", "dashboard.json"), "utf8"),
);

function stripGrafanaMacros(sql) {
  let out = sql;
  while (out.includes("$__timeFilter(")) {
    const start = out.indexOf("$__timeFilter(");
    let depth = 0;
    let end = start;
    for (let i = start; i < out.length; i++) {
      if (out[i] === "(") depth++;
      if (out[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    out = `${out.slice(0, start)}1=1${out.slice(end)}`;
  }
  out = out
    .replace(/\$__unixEpochFrom\(\)/g, "0")
    .replace(/\$__unixEpochTo\(\)/g, "9999999999");
  return out.replace(/\n/g, " ");
}

const queries = dashboard.panels.flatMap((panel) =>
  (panel.targets ?? [])
    .filter((t) => t.rawSql)
    .map((t) => ({
      title: panel.title,
      sql: stripGrafanaMacros(t.rawSql),
    })),
);

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  const conn = mysql.createConnection(url);
  const query = (sql) =>
    new Promise((resolve, reject) => {
      conn.query(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
    });

  console.log(`Validating ${queries.length} panel queries...\n`);

  for (const { title, sql } of queries) {
    try {
      const rows = await query(`SELECT * FROM (${sql}) AS q LIMIT 1`);
      console.log(`OK  ${title} (${Array.isArray(rows) ? rows.length : 0} sample row)`);
    } catch (err) {
      console.error(`FAIL ${title}: ${err.message}`);
      process.exitCode = 1;
    }
  }

  conn.end();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});

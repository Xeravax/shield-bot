/**
 * Ensures extra locale files do not introduce keys absent from en-US.json.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "../locales");
const DEFAULT = "en-US";

function flattenKeys(obj, prefix = "") {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const pathKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const nested = v;
      const pluralKeys = ["zero", "one", "two", "few", "many", "other"];
      const isPlural =
        Object.keys(nested).length > 0 &&
        Object.keys(nested).every((pk) => pluralKeys.includes(pk));
      if (isPlural) {
        keys.push(pathKey);
      } else {
        keys.push(...flattenKeys(nested, pathKey));
      }
    } else {
      keys.push(pathKey);
    }
  }
  return keys;
}

const enPath = path.join(localesDir, `${DEFAULT}.json`);
if (!fs.existsSync(enPath)) {
  console.error(`Missing ${enPath}`);
  process.exit(1);
}

const enKeys = new Set(flattenKeys(JSON.parse(fs.readFileSync(enPath, "utf8"))));
let failed = false;

for (const entry of fs.readdirSync(localesDir)) {
  if (!entry.endsWith(".json") || entry === `${DEFAULT}.json`) continue;
  const data = JSON.parse(fs.readFileSync(path.join(localesDir, entry), "utf8"));
  for (const key of flattenKeys(data)) {
    if (!enKeys.has(key)) {
      console.error(`[${entry}] unknown key (not in ${DEFAULT}.json): ${key}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log("✓ Locale key parity OK");

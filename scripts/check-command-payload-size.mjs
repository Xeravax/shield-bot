#!/usr/bin/env node
/**
 * Validates Discord slash command payload sizes per top-level command.
 * Discord limits each top-level command tree to 8000 characters total.
 */
import { dirname, importx } from "@discordx/importer";
import { MetadataStorage } from "discordx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const LIMIT = 8000;
process.env.SHIELD_COMMAND_PAYLOAD_CHECK = "1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildCommandsDir = path.join(__dirname, "../build/commands");
const srcCommandsDir = path.join(__dirname, "../src/commands");
const commandsDir = fs.existsSync(buildCommandsDir) ? buildCommandsDir : srcCommandsDir;

if (!fs.existsSync(commandsDir)) {
  console.error("No commands directory found. Run `yarn build` first.");
  process.exit(1);
}

function countPayloadChars(obj) {
  return JSON.stringify(obj).length;
}

function collectTextLengths(obj, lengths = []) {
  if (obj == null) return lengths;
  if (typeof obj === "string") {
    lengths.push(obj.length);
    return lengths;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) collectTextLengths(item, lengths);
    return lengths;
  }
  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj)) {
      if (key === "name" || key === "description" || key === "name_localizations" || key === "description_localizations") {
        collectTextLengths(value, lengths);
      } else if (key === "options" || key === "choices") {
        collectTextLengths(value, lengths);
      } else if (typeof value === "object") {
        collectTextLengths(value, lengths);
      }
    }
  }
  return lengths;
}

function buildCommandTrees(commands) {
  const trees = new Map();

  for (const cmd of commands) {
    const rootName = cmd.subgroup ?? cmd.group ?? cmd.name;
    if (!trees.has(rootName)) {
      trees.set(rootName, { name: rootName, description: cmd.description ?? "", options: [] });
    }
    const tree = trees.get(rootName);
    const json = cmd.toJSON();

    if (cmd.group && cmd.subgroup) {
      let groupOpt = tree.options.find((o) => o.name === cmd.group);
      if (!groupOpt) {
        groupOpt = { type: 2, name: cmd.group, description: "", options: [] };
        tree.options.push(groupOpt);
      }
      let subOpt = groupOpt.options.find((o) => o.name === cmd.subgroup);
      if (!subOpt) {
        subOpt = { type: 2, name: cmd.subgroup, description: "", options: [] };
        groupOpt.options.push(subOpt);
      }
      subOpt.options.push({ ...json, type: 1 });
    } else if (cmd.group) {
      let groupOpt = tree.options.find((o) => o.name === cmd.group);
      if (!groupOpt) {
        groupOpt = { type: 2, name: cmd.group, description: "", options: [] };
        tree.options.push(groupOpt);
      }
      groupOpt.options.push({ ...json, type: 1 });
    } else {
      tree.options.push({ ...json, type: 1 });
    }
  }

  return trees;
}

await importx(`${commandsDir}/**/*.js`);

const commands = MetadataStorage.instance.applicationCommands;
const trees = buildCommandTrees(commands);

const results = [];
for (const [name, tree] of trees) {
  const payloadChars = countPayloadChars(tree);
  const textChars = collectTextLengths(tree).reduce((a, b) => a + b, 0);
  results.push({ name, payloadChars, textChars, over: payloadChars > LIMIT });
}

results.sort((a, b) => b.payloadChars - a.payloadChars);

console.log(`Discord command payload sizes (limit: ${LIMIT} chars per top-level command)\n`);
for (const r of results) {
  const flag = r.over ? " OVER LIMIT" : "";
  console.log(`  /${r.name}: ${r.payloadChars} JSON chars (${r.textChars} name/desc text)${flag}`);
}

const over = results.filter((r) => r.over);
if (over.length > 0) {
  console.error(`\n${over.length} command(s) exceed the ${LIMIT} character limit.`);
  process.exit(1);
}

console.log(`\nAll ${results.length} top-level commands are within the limit.`);

import "dotenv/config";
import { dirname as importerDirname, importx } from "@discordx/importer";
import { fileURLToPath } from "url";
import { Client } from "discordx";
import { GatewayIntentBits } from "discord.js";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));

const bot = new Client({
  intents: [GatewayIntentBits.Guilds],
  silent: true,
  botGuilds: ["1241178553111019522"],
});

await importx(`${scriptDir}/../build/commands/**/*.js`);

await bot.build();

const sizes = bot.applicationCommands.map((cmd) => {
  const json = cmd.toJSON();
  const str = JSON.stringify(json);
  return {
    name: json.name,
    size: Buffer.byteLength(str, "utf8"),
    subcommands: countSubcommands(json),
  };
});

sizes.sort((a, b) => b.size - a.size);

console.log("Command sizes (bytes):");
for (const c of sizes) {
  const flag = c.size > 8000 ? " *** OVER LIMIT ***" : c.size > 7000 ? " (warning)" : "";
  console.log(`  ${c.name}: ${c.size} (${c.subcommands} leaf subcommands)${flag}`);
}

await bot.destroy();

function countSubcommands(json) {
  let n = 0;
  if (json.options) {
    for (const opt of json.options) {
      if (opt.type === 1) n += 1;
      else if (opt.type === 2 && opt.options) {
        for (const sub of opt.options) {
          if (sub.type === 1) n += 1;
        }
      }
    }
  }
  return n;
}

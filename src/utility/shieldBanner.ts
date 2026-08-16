/**
 * Shared SHIELD Bot ASCII banner for console and staff Bot Log welcome posts.
 */

const LEFT_INNER_WIDTH = 22; // 24 - 2 for bordering pipes around left cell
const RIGHT_INNER_WIDTH = 26; // 27 - 1 for trailing pipe on right cell

export function buildShieldBannerLines(options: {
  mode: string;
  logLevel: string;
}): string[] {
  const left = `Mode: ${options.mode}`.slice(0, LEFT_INNER_WIDTH);
  const right = `Log: ${options.logLevel}`.slice(0, RIGHT_INNER_WIDTH);
  const leftPad = Math.max(0, LEFT_INNER_WIDTH - left.length);
  const rightPad = Math.max(0, RIGHT_INNER_WIDTH - right.length);
  const modeLogLine =
    `|${" ".repeat(Math.floor(leftPad / 2))}${left}${" ".repeat(Math.ceil(leftPad / 2))}|` +
    `${" ".repeat(Math.floor(rightPad / 2))}${right}${" ".repeat(Math.ceil(rightPad / 2))}|`;

  return [
    "###################################################",
    modeLogLine,
    "|                      |     S.H.I.E.L.D. Bot     |",
    "|                      |                          |",
    "|                      | stefano@stefanocoding.me |",
    "|                      |         Xeravax          |",
    "|                      |                          |",
    "###################################################",
  ];
}

export function formatShieldBannerCodeBlock(options: {
  mode: string;
  logLevel: string;
}): string {
  const body = buildShieldBannerLines(options)
    .join("\n")
    .replace(/`+/g, "");
  return `\`\`\`\n${body}\n\`\`\``;
}

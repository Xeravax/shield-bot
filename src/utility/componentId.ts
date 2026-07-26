export function matchComponentId(
  customId: string,
  pattern: RegExp,
): RegExpMatchArray | null {
  return customId.match(pattern);
}

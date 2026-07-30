/** Discord scheduled event names are capped at 100 characters. */
export function buildDiscordScheduledEventName(
  hostDisplayName: string,
  title: string,
): string {
  const name = `${hostDisplayName} — ${title}`;
  return name.length > 100 ? `${name.slice(0, 97)}...` : name;
}

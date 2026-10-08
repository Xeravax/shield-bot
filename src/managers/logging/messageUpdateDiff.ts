/**
 * Decide whether a Discord MESSAGE_UPDATE is a real edit.
 *
 * The gateway also emits this event for link-preview refreshes, attachment CDN
 * metadata, and other non-edits. Uncached messages arrive with no previous
 * body, so a missing "before" must not be logged as empty content.
 */

const FRESH_EDIT_MS = 5 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;
const FIELD_LIMIT = 1024;

const VOLATILE_EMBED_KEYS = new Set([
  "proxy_url",
  "proxyURL",
  "proxyIconURL",
  "proxy_icon_url",
  "height",
  "width",
  "content_type",
  "contentType",
  "placeholder",
  "placeholder_version",
  "placeholderVersion",
  "duration",
  "duration_secs",
  "flags",
  "loading_state",
  "loadingState",
]);

export type AttachmentSnap = {
  id: string;
  name: string;
  size: number;
  contentType: string | null;
};

export type StickerSnap = {
  id: string;
  name: string;
};

export type PollSnap = {
  question: string;
  allowMultiselect: boolean | null;
  finalized: boolean;
  answers: { id: string; text: string; emoji: string | null }[];
};

/**
 * `undefined` on components, pinned, flags, or poll means that side has no
 * record of the field (archive rows do not store them). Those fields are not
 * compared. `null` poll means the message has no poll.
 */
export type MessageEditSnapshot = {
  content: string;
  attachments: AttachmentSnap[];
  embeds: unknown[];
  stickers: StickerSnap[];
  components?: unknown[];
  pinned?: boolean;
  flags?: string[];
  poll?: PollSnap | null;
};

export type MessageUpdateAnalysis =
  | { shouldLog: false }
  | {
      shouldLog: true;
      title: string;
      severity: "info" | "warn";
      fields: { name: string; value: string; inline?: boolean }[];
    };

type DiffEntry = {
  kind:
    | "content"
    | "attachment"
    | "embed"
    | "sticker"
    | "component"
    | "flag"
    | "pin"
    | "poll"
    | "unknown_prior";
  name: string;
  value: string;
  reason: string;
};

type AttachmentLike = {
  id: string;
  name?: string | null;
  size?: number | null;
  contentType?: string | null;
};

type StickerLike = {
  id: string;
  name?: string | null;
};

type PollAnswerLike = {
  id: string | number;
  text?: string | null;
  emoji?: { id?: string | null; name?: string | null } | null;
  /** Delivered with poll updates. Omitted from snapshots so votes are not edits. */
  voteCount?: number;
};

type ValueList<T> = Iterable<T> | { values(): Iterable<T> };

export type LiveMessageShape = {
  content?: string | null;
  attachments?: ValueList<AttachmentLike> | null;
  embeds?: readonly unknown[] | null;
  stickers?: ValueList<StickerLike> | null;
  components?: readonly unknown[] | null;
  pinned?: boolean | null;
  flags?: { toArray(): readonly string[] } | null;
  poll?: {
    question?: { text?: string | null } | null;
    allowMultiselect?: boolean | null;
    resultsFinalized?: boolean | null;
    answers?: ValueList<PollAnswerLike> | null;
  } | null;
};

export type ArchiveMessageShape = {
  content: string | null;
  attachments: AttachmentLike[];
  embeds: unknown[];
  stickers: StickerLike[];
};

function clip(text: string, max = FIELD_LIMIT): string {
  if (!text) {
    return "*empty*";
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function asArray<T>(value: ValueList<T> | readonly T[] | null | undefined): T[] {
  if (!value) {
    return [];
  }
  if (typeof (value as { values?: unknown }).values === "function") {
    return [...(value as { values(): Iterable<T> }).values()];
  }
  return [...(value as Iterable<T>)];
}

function jsonify(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "toJSON" in value &&
    typeof (value as { toJSON: unknown }).toJSON === "function"
  ) {
    return (value as { toJSON: () => unknown }).toJSON();
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripVolatile(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (VOLATILE_EMBED_KEYS.has(key) || child == null) {
      continue;
    }
    out[key] = stripVolatile(child);
  }
  return out;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined) {
      continue;
    }
    out[key] = sortValue(child);
  }
  return out;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function normalizeEmbed(embed: unknown): unknown {
  return stripVolatile(jsonify(embed));
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function embedIdentity(embed: unknown): string {
  const record = asRecord(normalizeEmbed(embed));
  const image = asRecord(record.image);
  const thumbnail = asRecord(record.thumbnail);
  const video = asRecord(record.video);
  return (
    firstString(record.url, image.url, thumbnail.url, video.url, record.title) ||
    firstString(record.description).slice(0, 80) ||
    stableStringify(record).slice(0, 120)
  );
}

function embedLabel(embed: unknown): string {
  const record = asRecord(normalizeEmbed(embed));
  const label = firstString(record.title, record.url, record.description);
  return label ? label.slice(0, 180) : "embed";
}

function changedEmbedKeys(before: unknown, after: unknown): string[] {
  const left = asRecord(normalizeEmbed(before));
  const right = asRecord(normalizeEmbed(after));
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys]
    .filter((key) => stableStringify(left[key]) !== stableStringify(right[key]))
    .sort();
}

function attachmentSnap(attachment: AttachmentLike): AttachmentSnap {
  return {
    id: attachment.id,
    name: attachment.name?.trim() || "file",
    size: attachment.size ?? 0,
    contentType: attachment.contentType ?? null,
  };
}

function attachmentLabel(attachment: AttachmentSnap): string {
  const type = attachment.contentType ? `, ${attachment.contentType}` : "";
  return `${attachment.name} (${attachment.size} bytes${type})`;
}

function stickerSnap(sticker: StickerLike): StickerSnap {
  return {
    id: sticker.id,
    name: sticker.name?.trim() || "sticker",
  };
}

function pollSnap(message: LiveMessageShape): PollSnap | null {
  if (!message.poll) {
    return null;
  }
  const answers = asArray(message.poll.answers).map((answer) => ({
    id: String(answer.id),
    text: answer.text?.trim() || "",
    emoji: answer.emoji?.name || answer.emoji?.id || null,
  }));
  answers.sort((a, b) => a.id.localeCompare(b.id));
  return {
    question: message.poll.question?.text?.trim() || "",
    allowMultiselect: message.poll.allowMultiselect ?? null,
    finalized: message.poll.resultsFinalized ?? false,
    answers,
  };
}

export function snapshotFromLiveMessage(message: LiveMessageShape): MessageEditSnapshot {
  const attachments = asArray(message.attachments).map(attachmentSnap);
  attachments.sort((a, b) => a.id.localeCompare(b.id));
  const stickers = asArray(message.stickers).map(stickerSnap);
  stickers.sort((a, b) => a.id.localeCompare(b.id));
  const flags = message.flags?.toArray();
  return {
    content: message.content ?? "",
    attachments,
    embeds: asArray(message.embeds).map((embed) => jsonify(embed)),
    stickers,
    components: asArray(message.components).map((component) => jsonify(component)),
    pinned: message.pinned ?? false,
    flags: flags ? [...flags].sort() : [],
    poll: pollSnap(message),
  };
}

export function snapshotFromArchive(row: ArchiveMessageShape): MessageEditSnapshot {
  const attachments = row.attachments.map(attachmentSnap);
  attachments.sort((a, b) => a.id.localeCompare(b.id));
  const stickers = row.stickers.map(stickerSnap);
  stickers.sort((a, b) => a.id.localeCompare(b.id));
  return {
    content: row.content ?? "",
    attachments,
    embeds: row.embeds.map((embed) => jsonify(embed)),
    stickers,
  };
}

function isFreshEdit(editedAt: Date | null, now: Date): boolean {
  if (!editedAt) {
    return false;
  }
  const age = now.getTime() - editedAt.getTime();
  return age >= -CLOCK_SKEW_MS && age <= FRESH_EDIT_MS;
}

function editedAtLabel(editedAt: Date): string {
  return `<t:${Math.floor(editedAt.getTime() / 1000)}:F>`;
}

function prettyFlag(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

function diffAttachments(before: AttachmentSnap[], after: AttachmentSnap[]): string[] {
  const nextById = new Map(after.map((attachment) => [attachment.id, attachment]));
  const prevIds = new Set(before.map((attachment) => attachment.id));
  const lines: string[] = [];
  for (const attachment of before) {
    const match = nextById.get(attachment.id);
    if (!match) {
      lines.push(`Removed: ${attachmentLabel(attachment)}`);
      continue;
    }
    if (
      attachment.name !== match.name ||
      attachment.size !== match.size ||
      attachment.contentType !== match.contentType
    ) {
      lines.push(`Changed: ${attachmentLabel(attachment)} → ${attachmentLabel(match)}`);
    }
  }
  for (const attachment of after) {
    if (!prevIds.has(attachment.id)) {
      lines.push(`Added: ${attachmentLabel(attachment)}`);
    }
  }
  return lines;
}

function diffStickers(before: StickerSnap[], after: StickerSnap[]): string[] {
  const nextById = new Map(after.map((sticker) => [sticker.id, sticker]));
  const prevIds = new Set(before.map((sticker) => sticker.id));
  const lines: string[] = [];
  for (const sticker of before) {
    const match = nextById.get(sticker.id);
    if (!match) {
      lines.push(`Removed: ${sticker.name}`);
    } else if (sticker.name !== match.name) {
      lines.push(`Renamed: ${sticker.name} → ${match.name}`);
    }
  }
  for (const sticker of after) {
    if (!prevIds.has(sticker.id)) {
      lines.push(`Added: ${sticker.name}`);
    }
  }
  return lines;
}

function shortValue(value: unknown): string {
  if (typeof value === "string") {
    return value.slice(0, 180);
  }
  const text = stableStringify(value);
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}

function diffEmbeds(before: unknown[], after: unknown[]): string[] {
  const pool = after.map((embed, index) => ({ embed, index, used: false }));
  const lines: string[] = [];

  for (const embed of before) {
    const identity = embedIdentity(embed);
    const normalized = stableStringify(normalizeEmbed(embed));
    let match = pool.find((item) => {
      if (item.used || embedIdentity(item.embed) !== identity) {
        return false;
      }
      return stableStringify(normalizeEmbed(item.embed)) === normalized;
    });
    match ??= pool.find((item) => !item.used && embedIdentity(item.embed) === identity);
    if (!match) {
      lines.push(`Removed: ${embedLabel(embed)}`);
      continue;
    }
    match.used = true;
    const keys = changedEmbedKeys(embed, match.embed);
    if (keys.length === 0) {
      continue;
    }
    const left = asRecord(normalizeEmbed(embed));
    const right = asRecord(normalizeEmbed(match.embed));
    const details = keys
      .slice(0, 6)
      .map((key) => `${key}: ${shortValue(left[key] ?? "*empty*")} → ${shortValue(right[key] ?? "*empty*")}`)
      .join("\n");
    lines.push(`Changed: ${embedLabel(embed)}\n${details}`);
  }

  for (const item of pool) {
    if (!item.used) {
      lines.push(`Added: ${embedLabel(item.embed)}`);
    }
  }
  return lines;
}

function componentLabels(components: unknown[]): string[] {
  const labels: string[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    const record = value as Record<string, unknown>;
    const label = firstString(record.label, record.placeholder, record.url, record.custom_id, record.customId);
    if (label) {
      labels.push(label);
    }
    visit(record.components);
    visit(record.options);
  };
  visit(components.map((component) => jsonify(component)));
  return labels;
}

function diffComponents(before: unknown[] | undefined, after: unknown[] | undefined): string | null {
  if (!before || !after) {
    return null;
  }
  const left = stripVolatile(before.map((component) => jsonify(component)));
  const right = stripVolatile(after.map((component) => jsonify(component)));
  if (stableStringify(left) === stableStringify(right)) {
    return null;
  }
  const beforeLabels = componentLabels(before);
  const afterLabels = componentLabels(after);
  if (beforeLabels.join("|") === afterLabels.join("|")) {
    return "Component state changed (disabled, options, or style) with the same labels.";
  }
  return [`Before: ${beforeLabels.join(", ") || "*empty*"}`, `After: ${afterLabels.join(", ") || "*empty*"}`].join("\n");
}

function diffFlags(before: string[] | undefined, after: string[] | undefined): string | null {
  if (!before || !after) {
    return null;
  }
  const prev = new Set(before);
  const next = new Set(after);
  const added = after.filter((flag) => !prev.has(flag)).map(prettyFlag);
  const removed = before.filter((flag) => !next.has(flag)).map(prettyFlag);
  if (added.length === 0 && removed.length === 0) {
    return null;
  }
  const lines: string[] = [];
  if (added.length > 0) {
    lines.push(`Added: ${added.join(", ")}`);
  }
  if (removed.length > 0) {
    lines.push(`Removed: ${removed.join(", ")}`);
  }
  return lines.join("\n");
}

function diffPoll(before: PollSnap | null | undefined, after: PollSnap | null | undefined): string | null {
  if (before === undefined || after === undefined) {
    return null;
  }
  if (stableStringify(before) === stableStringify(after)) {
    return null;
  }
  if (!before && after) {
    return `Poll added: ${after.question || "untitled"}`;
  }
  if (before && !after) {
    return `Poll removed: ${before.question || "untitled"}`;
  }
  if (!before || !after) {
    return null;
  }
  const lines: string[] = [];
  if (before.question !== after.question) {
    lines.push(`Question: ${before.question || "*empty*"} → ${after.question || "*empty*"}`);
  }
  if (before.allowMultiselect !== after.allowMultiselect) {
    lines.push(`Multiple answers: ${String(before.allowMultiselect)} → ${String(after.allowMultiselect)}`);
  }
  if (before.finalized !== after.finalized) {
    lines.push(after.finalized ? "Results were finalized." : "Results are no longer finalized.");
  }
  const beforeAnswers = before.answers.map((answer) => answer.text || answer.emoji || answer.id).join(", ");
  const afterAnswers = after.answers.map((answer) => answer.text || answer.emoji || answer.id).join(", ");
  if (beforeAnswers !== afterAnswers) {
    lines.push(`Answers: ${beforeAnswers || "*empty*"} → ${afterAnswers || "*empty*"}`);
  }
  return lines.join("\n") || "Poll details changed.";
}

function collectDiff(previous: MessageEditSnapshot, next: MessageEditSnapshot, editedAt: Date | null, now: Date): DiffEntry[] {
  const entries: DiffEntry[] = [];

  if (previous.content !== next.content) {
    const filledBlank = previous.content.length === 0 && next.content.length > 0;
    if (!filledBlank || isFreshEdit(editedAt, now)) {
      const reason =
        "The message text changed. Discord sends MESSAGE_UPDATE when someone edits the content.";
      entries.push(
        {
          kind: "content",
          name: "Content before",
          value: clip(previous.content),
          reason,
        },
        {
          kind: "content",
          name: "Content after",
          value: clip(next.content),
          reason,
        },
      );
    }
  }

  const attachmentLines = diffAttachments(previous.attachments, next.attachments);
  if (attachmentLines.length > 0) {
    entries.push({
      kind: "attachment",
      name: "Attachments",
      value: attachmentLines.join("\n"),
      reason:
        "Files on the message were added, removed, or replaced. Discord sends MESSAGE_UPDATE for attachment changes. CDN link refreshes are ignored.",
    });
  }

  const embedLines = diffEmbeds(previous.embeds, next.embeds);
  if (embedLines.length > 0) {
    entries.push({
      kind: "embed",
      name: "Embeds",
      value: embedLines.join("\n"),
      reason:
        "Embed content changed. Discord sends MESSAGE_UPDATE when a link preview is added or an embed's title, description, fields, or media URL changes. Proxy image reloads and width/height updates are ignored.",
    });
  }

  const stickerLines = diffStickers(previous.stickers, next.stickers);
  if (stickerLines.length > 0) {
    entries.push({
      kind: "sticker",
      name: "Stickers",
      value: stickerLines.join("\n"),
      reason: "Stickers on the message changed. Discord sends MESSAGE_UPDATE for sticker edits.",
    });
  }

  const components = diffComponents(previous.components, next.components);
  if (components) {
    entries.push({
      kind: "component",
      name: "Components",
      value: components,
      reason:
        "Buttons, select menus, or other components changed. Discord sends MESSAGE_UPDATE when component rows are edited.",
    });
  }

  const flags = diffFlags(previous.flags, next.flags);
  if (flags) {
    entries.push({
      kind: "flag",
      name: "Flags",
      value: flags,
      reason:
        "Message flags changed. Discord sends MESSAGE_UPDATE for flag updates such as suppressing embeds, marking a voice message, or starting a thread.",
    });
  }

  const poll = diffPoll(previous.poll, next.poll);
  if (poll) {
    entries.push({
      kind: "poll",
      name: "Poll",
      value: poll,
      reason:
        "The poll changed. Discord sends MESSAGE_UPDATE when a poll is added, edited, or finalized. Vote counts alone are ignored.",
    });
  }

  if (previous.pinned !== undefined && next.pinned !== undefined && previous.pinned !== next.pinned) {
    entries.push({
      kind: "pin",
      name: "Pin",
      value: next.pinned ? "The message was pinned." : "The message was unpinned.",
      reason: "The message pin state changed. Discord also emits MESSAGE_UPDATE when a message is pinned or unpinned.",
    });
  }

  return entries;
}

function titleFor(entries: DiffEntry[]): string {
  const kinds = new Set(entries.map((entry) => entry.kind));
  if (kinds.has("unknown_prior") || kinds.has("content")) {
    return "Message Edited";
  }
  if (kinds.size === 1 && kinds.has("embed")) {
    return "Message Embed Updated";
  }
  if (kinds.size === 1 && kinds.has("attachment")) {
    return "Message Attachments Updated";
  }
  if (kinds.size === 1 && kinds.has("sticker")) {
    return "Message Stickers Updated";
  }
  if (kinds.size === 1 && kinds.has("component")) {
    return "Message Components Updated";
  }
  if (kinds.size === 1 && kinds.has("flag")) {
    return "Message Flags Updated";
  }
  if (kinds.size === 1 && kinds.has("poll")) {
    return "Poll Updated";
  }
  return "Message Updated";
}

function severityFor(entries: DiffEntry[]): "info" | "warn" {
  const notable = entries.some((entry) =>
    entry.kind === "content" ||
    entry.kind === "attachment" ||
    entry.kind === "sticker" ||
    entry.kind === "unknown_prior",
  );
  return notable ? "warn" : "info";
}

function analysisFromEntries(entries: DiffEntry[]): MessageUpdateAnalysis {
  const meaningful = entries.filter((entry) => entry.kind !== "pin");
  if (meaningful.length === 0) {
    return { shouldLog: false };
  }
  const reasons = [...new Set(entries.map((entry) => entry.reason))];
  return {
    shouldLog: true,
    title: titleFor(meaningful),
    severity: severityFor(meaningful),
    fields: [
      { name: "Why", value: clip(reasons.join("\n\n")) },
      ...entries.map((entry) => ({
        name: entry.name,
        value: clip(entry.value),
      })),
    ],
  };
}

function priorUnknownAnalysis(next: MessageEditSnapshot, editedAt: Date): MessageUpdateAnalysis {
  const fields: { name: string; value: string }[] = [
    {
      name: "Why",
      value: clip(
        `Discord set this message's edit time to ${editedAtLabel(editedAt)}, so it was edited just now. The previous version was not in the bot cache or the message archive, so there is no before/after diff. An empty "before" is not assumed.`,
      ),
    },
    { name: "Edited at", value: editedAtLabel(editedAt) },
  ];
  if (next.content) {
    fields.push({ name: "Current content", value: clip(next.content) });
  }
  if (next.attachments.length > 0) {
    fields.push({
      name: "Current attachments",
      value: clip(next.attachments.map(attachmentLabel).join("\n")),
    });
  }
  if (next.embeds.length > 0) {
    fields.push({
      name: "Current embeds",
      value: clip(next.embeds.map(embedLabel).join("\n")),
    });
  }
  if (next.stickers.length > 0) {
    fields.push({
      name: "Current stickers",
      value: clip(next.stickers.map((sticker) => sticker.name).join("\n")),
    });
  }
  return {
    shouldLog: true,
    title: "Message Edited",
    severity: "warn",
    fields,
  };
}

export function analyzeMessageUpdate(input: {
  previous: MessageEditSnapshot | null;
  next: MessageEditSnapshot;
  editedAt: Date | null;
  now?: Date;
}): MessageUpdateAnalysis {
  const now = input.now ?? new Date();
  if (!input.previous) {
    if (!input.editedAt || !isFreshEdit(input.editedAt, now)) {
      return { shouldLog: false };
    }
    return priorUnknownAnalysis(input.next, input.editedAt);
  }

  return analysisFromEntries(collectDiff(input.previous, input.next, input.editedAt, now));
}

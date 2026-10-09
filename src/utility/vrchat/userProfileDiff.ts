export const VRCHAT_PROFILE_FIELDS = [
  { key: "displayName", label: "Display Name" },
  { key: "username", label: "Username" },
  { key: "pronouns", label: "Pronouns" },
  { key: "status", label: "Status" },
  { key: "statusDescription", label: "Status Description" },
] as const;

export type VrchatProfileField = (typeof VRCHAT_PROFILE_FIELDS)[number]["key"];

export type VrchatProfileSnapshot = Record<VrchatProfileField, string | null>;

export type VrchatProfileChange = {
  field: VrchatProfileField;
  label: string;
  from: string | null;
  to: string | null;
};

const FIELD_LABELS: Record<VrchatProfileField, string> = {
  displayName: "Display Name",
  username: "Username",
  pronouns: "Pronouns",
  status: "Status",
  statusDescription: "Status Description",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Online",
  "join me": "Join Me",
  "ask me": "Ask Me",
  busy: "Busy",
  offline: "Offline",
};

const EMPTY_SNAPSHOT: VrchatProfileSnapshot = {
  displayName: null,
  username: null,
  pronouns: null,
  status: null,
  statusDescription: null,
};

export function emptyVrchatProfile(): VrchatProfileSnapshot {
  return { ...EMPTY_SNAPSHOT };
}

/**
 * Read watched profile fields that are actually present as strings.
 * Missing keys are omitted so a partial friend-update does not clear them.
 */
export function readVrchatProfile(user: unknown): {
  values: Partial<Record<VrchatProfileField, string>>;
  present: ReadonlySet<VrchatProfileField>;
} {
  const values: Partial<Record<VrchatProfileField, string>> = {};
  const present = new Set<VrchatProfileField>();
  if (!user || typeof user !== "object") {
    return { values, present };
  }
  const record = user as Record<string, unknown>;
  for (const { key } of VRCHAT_PROFILE_FIELDS) {
    const raw = record[key];
    if (typeof raw !== "string") {
      continue;
    }
    values[key] = raw;
    present.add(key);
  }
  return { values, present };
}

/** Name stored on VRChatAccount: display name, then username. */
export function cachedVrchatName(
  values: Partial<Record<VrchatProfileField, string>>,
): string | null {
  if (typeof values.displayName === "string" && values.displayName.length > 0) {
    return values.displayName;
  }
  if (typeof values.username === "string" && values.username.length > 0) {
    return values.username;
  }
  return null;
}

export function diffVrchatProfile(
  previous: VrchatProfileSnapshot | null,
  incoming: Partial<Record<VrchatProfileField, string>>,
  present: ReadonlySet<VrchatProfileField>,
): {
  isNew: boolean;
  changes: VrchatProfileChange[];
  next: VrchatProfileSnapshot;
} {
  const next: VrchatProfileSnapshot = previous
    ? { ...previous }
    : emptyVrchatProfile();
  const changes: VrchatProfileChange[] = [];

  for (const { key, label } of VRCHAT_PROFILE_FIELDS) {
    if (!present.has(key)) {
      continue;
    }
    const to = incoming[key] ?? null;
    const from = previous ? previous[key] : null;
    next[key] = to;
    if (previous && from !== to) {
      changes.push({ field: key, label, from, to });
    }
  }

  return { isNew: previous == null, changes, next };
}

/**
 * Describe a cached-username change when we have no prior profile snapshot.
 * Uses the same display-name-then-username value that is stored on the account.
 */
export function nameChangeFromCache(
  previousName: string | null,
  incoming: Partial<Record<VrchatProfileField, string>>,
  present: ReadonlySet<VrchatProfileField>,
): VrchatProfileChange | null {
  const nextName = cachedVrchatName(incoming);
  if (nextName == null || nextName === previousName) {
    return null;
  }
  if (present.has("displayName") && incoming.displayName === nextName) {
    return {
      field: "displayName",
      label: FIELD_LABELS.displayName,
      from: previousName,
      to: nextName,
    };
  }
  return {
    field: "username",
    label: FIELD_LABELS.username,
    from: previousName,
    to: nextName,
  };
}

export function formatVrchatStatus(status: string): string {
  return STATUS_LABELS[status.toLowerCase()] ?? status;
}

export function formatProfileValue(
  field: VrchatProfileField,
  value: string | null,
): string {
  if (value == null || value.length === 0) {
    return "*empty*";
  }
  const shown = field === "status" ? formatVrchatStatus(value) : value;
  const clipped = shown.length > 300 ? `${shown.slice(0, 299)}…` : shown;
  return `\`${clipped.replace(/`/g, "ˋ")}\``;
}

export function formatProfileChange(change: VrchatProfileChange): string {
  return `${formatProfileValue(change.field, change.from)} → ${formatProfileValue(change.field, change.to)}`;
}

export function profileChangeTitle(changes: VrchatProfileChange[]): string {
  if (changes.length === 1) {
    return `${changes[0].label} Changed`;
  }
  return "VRChat Profile Updated";
}

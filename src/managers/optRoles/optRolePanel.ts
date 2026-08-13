import {
  PermissionFlagsBits,
  type APIMessageComponentEmoji,
  type PermissionsBitField,
} from "discord.js";

export const OPT_ROLE_BUTTON_PREFIX = "opt-role:";
export const OPT_ROLE_BUTTON_PATTERN = /^opt-role:(\d+)$/;

export const GOLDEN_COOKIE_DIVIDER =
  "▬▬▬▬▬▬▬▬▬▬▬    <a:GOLDENCOOKIE:868564750001381378>    ▬▬▬▬▬▬▬▬▬▬▬";

const CUSTOM_EMOJI_RE = /^<(a)?:([a-zA-Z0-9_]+):(\d+)>$/;
const SNOWFLAKE_RE = /^\d{17,20}$/;

export const SENSITIVE_OPT_ROLE_PERMISSIONS =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.MentionEveryone |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageWebhooks;

export type OptRoleEmoji = APIMessageComponentEmoji;

export type OptRoleButton = {
  roleId: string;
  label: string;
  emoji: OptRoleEmoji;
  /** Short line shown above the button row (full width). */
  hint: string;
  /** Member must hold all of these roles to *add* the opt-in role. */
  requiredRoleIds?: string[];
};

export type OptRoleSection = {
  body: string;
  buttons: OptRoleButton[];
};

export type OptRolePanel = {
  sections: OptRoleSection[];
  footer?: string;
};

export type OptRolePresetKey = "event-opt-in" | "opt-in";

export type OptRoleEligibilityInput = {
  id: string;
  managed: boolean;
  guild: { id: string };
  permissions: Pick<PermissionsBitField, "any">;
};

export type ToggleOptRoleResult =
  | { ok: true; added: boolean; roleName: string }
  | { ok: false; message: string };

export const OPT_ROLE_PRESET_CHOICES: { name: string; value: OptRolePresetKey }[] = [
  { name: "Event opt-in roles", value: "event-opt-in" },
  { name: "Opt-in roles", value: "opt-in" },
];

const EVENT_CHANNEL = "813938609366761492";
const FIND_A_GROUP_CHANNEL = "999880779112923136";
const DISPATCHER_CHANNEL_A = "947227906952802364";
const DISPATCHER_CHANNEL_B = "814238782453710921";
const BACKUP_CHANNEL = "999881847737679902";

const ROLE_OFF_DUTY_EVENTS = "999871775993233488";
const ROLE_OFF_DUTY_VR = "999871666563850251";
const ROLE_FIND_A_GROUP = "999860568431271968";
const ROLE_STANDBY_DEPUTIES = "999860674404569242";
const ROLE_EMT = "999860876062498827";
const ROLE_TRU = "999860757770543184";
const ROLE_STANDBY_ACTOR = "814562269039689778";

/** Membership roles required before opting into certain ping roles. */
export const ROLE_SHIELD_MEMBER = "813945539526787082";
export const ROLE_EMT_MEMBER = "814558891651366947";
export const ROLE_TRU_MEMBER = "814557238647324704";

const EMOJI_VRC_ALERT: OptRoleEmoji = { id: "999877368216825936", name: "vrcAlert" };
const EMOJI_VRC_INVITE: OptRoleEmoji = { id: "999877383605723196", name: "vrcInvite" };
const EMOJI_STAR: OptRoleEmoji = { id: "862435339670126592", name: "1468star" };
const EMOJI_SHIELD: OptRoleEmoji = { id: "826263186071879710", name: "SHIELD" };
const EMOJI_EMT: OptRoleEmoji = { id: "830948626015453224", name: "EMT" };
const EMOJI_TRU: OptRoleEmoji = { id: "830948641853800509", name: "TRU" };
const EMOJI_CAMERA: OptRoleEmoji = { name: "🎥" };

export function formatEmojiMarkdown(emoji: OptRoleEmoji): string {
  if (emoji.id) {
    return `<${emoji.animated ? "a" : ""}:${emoji.name ?? "emoji"}:${emoji.id}>`;
  }
  return emoji.name ?? "";
}

const ACTIVE_EVENT_CONTACT = [
  "Outside of Scheduled Events only.",
  `During Active Events, contact a Dispatcher in <#${DISPATCHER_CHANNEL_A}> or <#${DISPATCHER_CHANNEL_B}>.`,
].join(" ");

export const OPT_ROLE_PRESETS: Record<OptRolePresetKey, OptRolePanel> = {
  "event-opt-in": {
    sections: [
      {
        body: [
          `Opt in for <@&${ROLE_OFF_DUTY_EVENTS}> in <#${EVENT_CHANNEL}>.`,
          "These Events are for the whole community - not just SHIELD members.",
          "",
          "Run by The Event Hosts Team within the SHIELD Community.",
        ].join("\n"),
        buttons: [
          {
            roleId: ROLE_OFF_DUTY_EVENTS,
            label: "Off Duty Events",
            emoji: EMOJI_VRC_ALERT,
            hint: `${formatEmojiMarkdown(EMOJI_VRC_ALERT)} - Ping for Off Duty Events`,
          },
        ],
      },
      {
        body: [
          `Opt in for <@&${ROLE_OFF_DUTY_VR}> in <#${EVENT_CHANNEL}>.`,
          "VR-focused (VRChat, Pavlov, Elite Dangerous, Population: One, and more).",
          "Open to the whole community - not just SHIELD members.",
          "",
          "Run by The Event Hosts Team within the SHIELD Community.",
        ].join("\n"),
        buttons: [
          {
            roleId: ROLE_OFF_DUTY_VR,
            label: "Off Duty VR",
            emoji: EMOJI_VRC_INVITE,
            hint: `${formatEmojiMarkdown(EMOJI_VRC_INVITE)} - Ping for Off Duty VR Events`,
          },
        ],
      },
    ],
  },
  "opt-in": {
    sections: [
      {
        body: [
          "# __Find A Group__",
          `Get notified when someone is looking for a Patrol Partner in <#${FIND_A_GROUP_CHANNEL}> (ping <@&${ROLE_FIND_A_GROUP}>).`,
          "",
          ACTIVE_EVENT_CONTACT,
        ].join("\n"),
        buttons: [
          {
            roleId: ROLE_FIND_A_GROUP,
            label: "Find A Group",
            emoji: EMOJI_STAR,
            hint: `${formatEmojiMarkdown(EMOJI_STAR)} - Looking for a patrol partner`,
            requiredRoleIds: [ROLE_SHIELD_MEMBER],
          },
        ],
      },
      {
        body: [
          "# __Standby Deputies, TRU, EMT__",
          `Backup pings: <@&${ROLE_STANDBY_DEPUTIES}>, <@&${ROLE_EMT}>, or <@&${ROLE_TRU}> in <#${BACKUP_CHANNEL}>.`,
          "",
          ACTIVE_EVENT_CONTACT,
          "",
          "Tell the requester you are responding. Max 4 backup members per call, and max 8 in the VC total.",
        ].join("\n"),
        buttons: [
          {
            roleId: ROLE_STANDBY_DEPUTIES,
            label: "Deputies",
            emoji: EMOJI_SHIELD,
            hint: `${formatEmojiMarkdown(EMOJI_SHIELD)} - Additional Deputies`,
          },
          {
            roleId: ROLE_EMT,
            label: "EMT",
            emoji: EMOJI_EMT,
            hint: `${formatEmojiMarkdown(EMOJI_EMT)} - EMT Support`,
            requiredRoleIds: [ROLE_EMT_MEMBER],
          },
          {
            roleId: ROLE_TRU,
            label: "TRU",
            emoji: EMOJI_TRU,
            hint: `${formatEmojiMarkdown(EMOJI_TRU)} - TRU Backup`,
            requiredRoleIds: [ROLE_TRU_MEMBER],
          },
        ],
      },
      {
        body: [
          "# __Standby Actor__",
          `Assist the Media Team as <@&${ROLE_STANDBY_ACTOR}> (photoshoots, live filming, etc.).`,
        ].join("\n"),
        buttons: [
          {
            roleId: ROLE_STANDBY_ACTOR,
            label: "Standby Actor",
            emoji: EMOJI_CAMERA,
            hint: `${formatEmojiMarkdown(EMOJI_CAMERA)} - Media Team needs actors`,
          },
        ],
      },
    ],
    footer: "**__DO NOT ASSIGN YOURSELF TO A ROLE FOR A TEAM YOU ARE NOT TRAINED IN__**",
  },
};

export function optRoleButtonCustomId(roleId: string): string {
  return `${OPT_ROLE_BUTTON_PREFIX}${roleId}`;
}

export function parseOptRoleButtonCustomId(customId: string): string | null {
  const match = customId.match(OPT_ROLE_BUTTON_PATTERN);
  return match?.[1] ?? null;
}

export function parseOptRoleEmoji(input: string): OptRoleEmoji | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const custom = CUSTOM_EMOJI_RE.exec(trimmed);
  if (custom) {
    return {
      animated: custom[1] === "a",
      name: custom[2],
      id: custom[3],
    };
  }

  if (SNOWFLAKE_RE.test(trimmed)) {
    return { id: trimmed, name: "emoji" };
  }

  if (trimmed.includes("<") || trimmed.includes(":")) {
    return null;
  }

  if ([...trimmed].length > 12) {
    return null;
  }

  return { name: trimmed };
}

export function getOptRolePreset(key: string): OptRolePanel | null {
  if (key === "event-opt-in" || key === "opt-in") {
    return OPT_ROLE_PRESETS[key];
  }
  return null;
}

export function buildCustomOptRolePanel(
  description: string,
  buttons: OptRoleButton[],
): OptRolePanel {
  return {
    sections: [
      {
        body: description,
        buttons,
      },
    ],
  };
}

export function getOptRoleEligibilityError(role: OptRoleEligibilityInput): string | null {
  if (role.id === role.guild.id) {
    return "❌ The @everyone role cannot be assigned.";
  }

  if (role.managed) {
    return "❌ That role is managed by an integration and cannot be assigned.";
  }

  if (role.permissions.any(SENSITIVE_OPT_ROLE_PERMISSIONS)) {
    return "❌ That role has elevated permissions and cannot be used as an opt-in role.";
  }

  return null;
}

/** Required membership roles to *add* a preset opt-in role (removal is always allowed). */
export function getRequiredRoleIdsForOptIn(optInRoleId: string): string[] {
  for (const panel of Object.values(OPT_ROLE_PRESETS)) {
    for (const section of panel.sections) {
      for (const button of section.buttons) {
        if (button.roleId === optInRoleId) {
          return button.requiredRoleIds ?? [];
        }
      }
    }
  }
  return [];
}

export function getOptInRequirementError(
  memberRoleIds: Iterable<string>,
  optInRoleId: string,
): string | null {
  const required = getRequiredRoleIdsForOptIn(optInRoleId);
  if (required.length === 0) {
    return null;
  }

  const owned = new Set(memberRoleIds);
  const missing = required.filter((id) => !owned.has(id));
  if (missing.length === 0) {
    return null;
  }

  if (missing.length === 1) {
    return `❌ You need <@&${missing[0]}> to opt into this role.`;
  }

  return `❌ You need ${missing.map((id) => `<@&${id}>`).join(" and ")} to opt into this role.`;
}

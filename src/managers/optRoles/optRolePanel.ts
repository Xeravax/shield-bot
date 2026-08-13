import {
  PermissionFlagsBits,
  type APIMessageComponentEmoji,
  type PermissionsBitField,
} from "discord.js";

export const OPT_ROLE_BUTTON_PREFIX = "opt-role:";
export const OPT_ROLE_BUTTON_PATTERN = /^opt-role:(\d+)$/;

export const GOLDEN_COOKIE_DIVIDER =
  "▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬    <a:GOLDENCOOKIE:868564750001381378>    ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬";

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
  hint: string;
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
  "This can only be used outside of Scheduled Events. If you are looking to go out and patrol during an Active event, please get in contact with the current Dispatcher online at that time. They can be found in",
  `<#${DISPATCHER_CHANNEL_A}> or <#${DISPATCHER_CHANNEL_B}> during Active Events!`,
].join(" ");

export const OPT_ROLE_PRESETS: Record<OptRolePresetKey, OptRolePanel> = {
  "event-opt-in": {
    sections: [
      {
        body: [
          `Here, you can opt in to get notified about <@&${ROLE_OFF_DUTY_EVENTS}> that occur within <#${EVENT_CHANNEL}>! These Events are prioritized for the community as a whole and not just members of SHIELD, hence, anyone can enjoy them!`,
          "",
          "Off Duty Events are run by the members of The Event Hosts Team within the SHIELD Community!",
        ].join("\n"),
        buttons: [
          {
            roleId: ROLE_OFF_DUTY_EVENTS,
            label: "Off Duty Events",
            emoji: EMOJI_VRC_ALERT,
            hint: `${formatEmojiMarkdown(EMOJI_VRC_ALERT)} — Get notified when OFF Duty Events are occurring in <#${EVENT_CHANNEL}>!`,
          },
        ],
      },
      {
        body: [
          `Here, you can opt in to get notified about <@&${ROLE_OFF_DUTY_VR}> that occur within <#${EVENT_CHANNEL}>! These events are prioritized for the community as a whole and not just members of SHIELD. These particular Events are based in VR, so games like VRChat, Pavlov, Elite Dangerous, Population:One and many more are the main focus!`,
          "",
          "Off Duty VR Events are run by the members of The Event Hosts Team within the SHIELD Community",
        ].join("\n"),
        buttons: [
          {
            roleId: ROLE_OFF_DUTY_VR,
            label: "Off Duty VR",
            emoji: EMOJI_VRC_INVITE,
            hint: `${formatEmojiMarkdown(EMOJI_VRC_INVITE)} — Get notified when OFF Duty VR Events are occurring in <#${EVENT_CHANNEL}>!`,
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
          `Here, you can opt in to be notified when somebody is looking for a Patrol Partner outside of Scheduled Events! When you, or another Deputy uses <#${FIND_A_GROUP_CHANNEL}>, you can ping the <@&${ROLE_FIND_A_GROUP}> role to notify other Deputies that you are seeking to patrol!`,
          "",
          ACTIVE_EVENT_CONTACT,
          "",
          `When you wish to go patrolling, please use the <#${FIND_A_GROUP_CHANNEL}> channel and ping the <@&${ROLE_FIND_A_GROUP}> role!`,
        ].join("\n"),
        buttons: [
          {
            roleId: ROLE_FIND_A_GROUP,
            label: "Find A Group",
            emoji: EMOJI_STAR,
            hint: `${formatEmojiMarkdown(EMOJI_STAR)} — Get notified when someone is looking to go out and Patrol`,
          },
        ],
      },
      {
        body: [
          "# __Standby Deputies, TRU, EMT__",
          `Here, you can be notified when Deputies are requesting backup to one of 3 different backups. <@&${ROLE_STANDBY_DEPUTIES}> <@&${ROLE_EMT}> or <@&${ROLE_TRU}>`,
          "",
          `When requesting backup, use the <#${BACKUP_CHANNEL}> channel.`,
          "",
          ACTIVE_EVENT_CONTACT,
          "",
          "If you are responding to any backup call, let the Requester know that you are responding to the call! Please refrain from exceeding 4 backup members to one call, and that the group as a whole does not exceed 8 members to one VC.",
        ].join("\n"),
        buttons: [
          {
            roleId: ROLE_STANDBY_DEPUTIES,
            label: "Deputies",
            emoji: EMOJI_SHIELD,
            hint: `${formatEmojiMarkdown(EMOJI_SHIELD)} — Get notified when a group needs Additional Deputies`,
          },
          {
            roleId: ROLE_EMT,
            label: "EMT",
            emoji: EMOJI_EMT,
            hint: `${formatEmojiMarkdown(EMOJI_EMT)} — Get notified when a group needs EMT Support`,
          },
          {
            roleId: ROLE_TRU,
            label: "TRU",
            emoji: EMOJI_TRU,
            hint: `${formatEmojiMarkdown(EMOJI_TRU)} — Get notified when a group needs TRU Backup`,
          },
        ],
      },
      {
        body: [
          "# __Standby Actor__",
          `Here, you can opt-in to be an assistant to the Media Team as a <@&${ROLE_STANDBY_ACTOR}>.`,
          "",
          "Standby Actors are members of the Community who on their own free time have the option to assist the Media Team in a multitude of projects, ranging from Photoshoots, Live Filming, etc.",
        ].join("\n"),
        buttons: [
          {
            roleId: ROLE_STANDBY_ACTOR,
            label: "Standby Actor",
            emoji: EMOJI_CAMERA,
            hint: `${formatEmojiMarkdown(EMOJI_CAMERA)} — Get notified when the Media Team needs Standby Actors`,
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

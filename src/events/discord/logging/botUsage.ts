import { ArgsOf, Discord, On } from "discordx";
import {
  ApplicationCommandOptionType,
  type ChatInputCommandInteraction,
  type CommandInteractionOption,
} from "discord.js";
import { auditLogManager } from "../../../main.js";
import { loggers } from "../../../utility/logger.js";

function formatOptionValue(option: CommandInteractionOption): string {
  switch (option.type) {
    case ApplicationCommandOptionType.Subcommand:
    case ApplicationCommandOptionType.SubcommandGroup:
      return "";
    case ApplicationCommandOptionType.String:
    case ApplicationCommandOptionType.Integer:
    case ApplicationCommandOptionType.Number:
    case ApplicationCommandOptionType.Boolean:
      return String(option.value ?? "");
    case ApplicationCommandOptionType.User:
      return option.user
        ? `${option.user.username} (\`${option.user.id}\`)`
        : String(option.value ?? "");
    case ApplicationCommandOptionType.Channel:
      return option.channel
        ? `#${"name" in option.channel && option.channel.name ? option.channel.name : "channel"} (\`${option.channel.id}\`)`
        : String(option.value ?? "");
    case ApplicationCommandOptionType.Role:
      return option.role
        ? `${option.role.name} (\`${option.role.id}\`)`
        : String(option.value ?? "");
    case ApplicationCommandOptionType.Mentionable:
      if (option.user) {
        return `${option.user.username} (\`${option.user.id}\`)`;
      }
      if (option.role) {
        return `${option.role.name} (\`${option.role.id}\`)`;
      }
      return String(option.value ?? "");
    case ApplicationCommandOptionType.Attachment:
      return option.attachment
        ? `${option.attachment.name} (\`${option.attachment.id}\`)`
        : String(option.value ?? "");
    default:
      return String(option.value ?? "");
  }
}

function collectOptions(
  options: readonly CommandInteractionOption[],
  parts: string[] = [],
): string[] {
  for (const option of options) {
    if (
      option.type === ApplicationCommandOptionType.Subcommand ||
      option.type === ApplicationCommandOptionType.SubcommandGroup
    ) {
      parts.push(option.name);
      if (option.options?.length) {
        collectOptions(option.options, parts);
      }
      continue;
    }
    const value = formatOptionValue(option);
    parts.push(`${option.name}:${value || "*empty*"}`);
  }
  return parts;
}

function formatChatInput(interaction: ChatInputCommandInteraction): {
  command: string;
  options: string;
} {
  const root = `/${interaction.commandName}`;
  const data = interaction.options.data;
  if (!data.length) {
    return { command: root, options: "*none*" };
  }

  const parts = collectOptions(data);
  // Subcommand path is first segment(s) without `key:value`
  const pathParts: string[] = [];
  const optionParts: string[] = [];
  for (const part of parts) {
    if (part.includes(":")) {
      optionParts.push(part);
    } else {
      pathParts.push(part);
    }
  }

  const command =
    pathParts.length > 0 ? `${root} ${pathParts.join(" ")}` : root;
  return {
    command,
    options: optionParts.length ? optionParts.join(" · ") : "*none*",
  };
}

function shouldSkip(interaction: ArgsOf<"interactionCreate">[0]): boolean {
  if (!interaction.guildId) {
    return true;
  }
  if (interaction.user.bot) {
    return true;
  }
  // Autocomplete fires constantly while typing - do not log.
  if (interaction.isAutocomplete()) {
    return true;
  }
  return false;
}

@Discord()
export class LoggingBotUsageEvents {
  @On({ event: "interactionCreate" })
  async onInteraction([
    interaction,
  ]: ArgsOf<"interactionCreate">): Promise<void> {
    try {
      if (shouldSkip(interaction)) {
        return;
      }

      const fields: { name: string; value: string; inline?: boolean }[] = [
        {
          name: "User",
          value: await auditLogManager.formatUser(
            interaction.user.id,
            interaction.user.username,
          ),
          inline: true,
        },
      ];

      if (interaction.channelId) {
        fields.push({
          name: "Channel",
          value: auditLogManager.formatChannel(interaction.channelId),
          inline: true,
        });
      }

      let title = "Bot Interaction";
      let description: string | undefined;

      if (interaction.isChatInputCommand()) {
        const formatted = formatChatInput(interaction);
        title = "Slash Command";
        fields.push({ name: "Command", value: `\`${formatted.command}\`` });
        fields.push({
          name: "Options",
          value: auditLogManager.truncate(formatted.options),
        });
      } else if (interaction.isUserContextMenuCommand()) {
        title = "User Context Menu";
        fields.push({
          name: "Command",
          value: `\`${interaction.commandName}\``,
        });
        fields.push({
          name: "Target",
          value: await auditLogManager.formatUser(
            interaction.targetUser.id,
            interaction.targetUser.username,
          ),
        });
      } else if (interaction.isMessageContextMenuCommand()) {
        title = "Message Context Menu";
        fields.push({
          name: "Command",
          value: `\`${interaction.commandName}\``,
        });
        fields.push({
          name: "Message",
          value: `\`${interaction.targetId}\``,
        });
      } else if (interaction.isButton()) {
        title = "Button";
        fields.push({
          name: "Custom ID",
          value: `\`${auditLogManager.truncate(interaction.customId, 200)}\``,
        });
      } else if (interaction.isAnySelectMenu()) {
        title = "Select Menu";
        fields.push({
          name: "Custom ID",
          value: `\`${auditLogManager.truncate(interaction.customId, 200)}\``,
        });
        fields.push({
          name: "Values",
          value: auditLogManager.truncate(
            interaction.values.map((v) => `\`${v}\``).join(", ") || "*none*",
          ),
        });
      } else if (interaction.isModalSubmit()) {
        title = "Modal Submit";
        fields.push({
          name: "Custom ID",
          value: `\`${auditLogManager.truncate(interaction.customId, 200)}\``,
        });
        const entries = [...interaction.fields.fields.values()].map((field) => {
          const raw =
            "value" in field && typeof field.value === "string"
              ? field.value.trim()
              : "*complex field*";
          const value = raw || "*empty*";
          return `**${field.customId}**: ${auditLogManager.truncate(value, 200)}`;
        });
        fields.push({
          name: "Fields",
          value: auditLogManager.truncate(
            entries.join("\n") || "*none*",
          ),
        });
      } else {
        // Unknown interaction type - still record a minimal entry.
        title = "Bot Interaction";
        description = `Type \`${interaction.type}\``;
      }

      void auditLogManager
        .postLog({
          guildId: interaction.guildId!,
          category: "bot",
          title,
          description,
          severity: "info",
          fields,
          footer: `Interaction ${interaction.id}`,
        })
        .catch((error) => {
          loggers.bot.debug("bot usage log failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } catch (error) {
      loggers.bot.debug("bot usage log failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

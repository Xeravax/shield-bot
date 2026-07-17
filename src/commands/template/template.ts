import { Discord, Slash, SlashGroup, SlashOption, Guard } from "discordx";
import {
  ApplicationCommandOptionType,
  Attachment,
  AutocompleteInteraction,
  CommandInteraction,
  GuildMember,
  MessageFlags,
} from "discord.js";
import { GuildGuard } from "../../utility/guards.js";
import { searchUsers } from "../../utility/vrchat.js";
import type { VRChatUser } from "../../utility/vrchat/types.js";

function getVoiceMembers(member: GuildMember): GuildMember[] | null {
  const channel = member.voice?.channel;
  if (!channel) {
    return null;
  }
  return [...channel.members.values()].filter((m) => !m.user.bot);
}

function formatMentions(members: GuildMember[]): string {
  return members.map((m) => `<@${m.id}>`).join(", ");
}

@Discord()
@SlashGroup({
  name: "template",
  description: "Report text shortcuts",
})
@SlashGroup("template")
@Guard(GuildGuard)
export class TemplateCommands {
  @Slash({
    name: "mugshot",
    description: "Generate a mugshot report from your voice channel roster",
  })
  async mugshot(
    @SlashOption({
      name: "name",
      description: "VRChat display name",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    name: string,
    @SlashOption({
      name: "crime",
      description: "Crime committed",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    crime: string,
    @SlashOption({
      name: "picture_1",
      description: "Optional mugshot image",
      type: ApplicationCommandOptionType.Attachment,
      required: false,
    })
    picture1: Attachment | null,
    @SlashOption({
      name: "picture_2",
      description: "Optional second mugshot image",
      type: ApplicationCommandOptionType.Attachment,
      required: false,
    })
    picture2: Attachment | null,
    interaction: CommandInteraction | AutocompleteInteraction,
  ): Promise<void> {
    if (interaction.isAutocomplete()) {
      return this.autocompleteVrchatDisplayName(interaction);
    }

    if (!interaction.isCommand()) {
      return;
    }

    const member = interaction.member as GuildMember;
    const voiceMembers = getVoiceMembers(member);
    if (!voiceMembers) {
      await interaction.reply({
        content: "Join a voice channel first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const displayName = typeof name === "string" ? name.trim() : "";
    const content = [
      `Name: ${displayName}`,
      `Crime: ${crime}`,
      `Deputies on scene: ${formatMentions(voiceMembers)}`,
      `-# Command ran by: <@${interaction.user.id}>`,
    ].join("\n");

    const files = [picture1, picture2].filter(
      (file): file is Attachment => file != null,
    );

    await interaction.reply({
      content,
      files: files.length > 0 ? files : undefined,
    });
  }

  @Slash({
    name: "diagnosis",
    description: "Generate a diagnosis report from your voice channel roster",
  })
  async diagnosis(
    @SlashOption({
      name: "name",
      description: "VRChat display name",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: true,
    })
    name: string,
    @SlashOption({
      name: "situation",
      description: "Patient situation",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    situation: string,
    @SlashOption({
      name: "treatment",
      description: "Treatment provided",
      type: ApplicationCommandOptionType.String,
      required: true,
    })
    treatment: string,
    @SlashOption({
      name: "picture",
      description: "Optional diagnosis image",
      type: ApplicationCommandOptionType.Attachment,
      required: false,
    })
    picture: Attachment | null,
    interaction: CommandInteraction | AutocompleteInteraction,
  ): Promise<void> {
    if (interaction.isAutocomplete()) {
      return this.autocompleteVrchatDisplayName(interaction);
    }

    if (!interaction.isCommand()) {
      return;
    }

    const member = interaction.member as GuildMember;
    const voiceMembers = getVoiceMembers(member);
    if (!voiceMembers) {
      await interaction.reply({
        content: "Join a voice channel first.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const displayName = typeof name === "string" ? name.trim() : "";
    const content = [
      `Name: ${displayName}`,
      `Situation: ${situation}`,
      `Treatment: ${treatment}`,
      `EMT: ${formatMentions(voiceMembers)}`,
      `-# Command ran by: <@${interaction.user.id}>`,
    ].join("\n");

    await interaction.reply({
      content,
      files: picture ? [picture] : undefined,
    });
  }

  private async autocompleteVrchatDisplayName(
    interaction: AutocompleteInteraction,
  ): Promise<void> {
    const query = interaction.options.getFocused();
    if (!query || query.length < 2) {
      await interaction.respond([]);
      return;
    }

    try {
      const users = await searchUsers({ search: query, n: 25 });
      const queryLower = query.toLowerCase();

      const filteredUsers = users
        .filter((user: VRChatUser) => {
          const displayName = user.displayName?.toLowerCase() || "";
          return displayName.includes(queryLower);
        })
        .sort((a: VRChatUser, b: VRChatUser) => {
          const aDisplayName = a.displayName?.toLowerCase() || "";
          const bDisplayName = b.displayName?.toLowerCase() || "";

          if (aDisplayName === queryLower) {
            return -1;
          }
          if (bDisplayName === queryLower) {
            return 1;
          }
          if (
            aDisplayName.startsWith(queryLower) &&
            !bDisplayName.startsWith(queryLower)
          ) {
            return -1;
          }
          if (
            bDisplayName.startsWith(queryLower) &&
            !aDisplayName.startsWith(queryLower)
          ) {
            return 1;
          }
          return aDisplayName.localeCompare(bDisplayName);
        });

      const seen = new Set<string>();
      const choices: { name: string; value: string }[] = [];

      for (const user of filteredUsers) {
        const displayName = user.displayName?.trim();
        if (!displayName || seen.has(displayName)) {
          continue;
        }
        seen.add(displayName);
        choices.push({
          name: displayName.slice(0, 100),
          value: displayName.slice(0, 100),
        });
        if (choices.length >= 25) {
          break;
        }
      }

      await interaction.respond(choices);
    } catch {
      await interaction.respond([]);
    }
  }
}

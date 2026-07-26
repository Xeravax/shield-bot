import { getUserById } from '../../../../utility/vrchat.js';
import { getGroupMember } from '../../../../utility/vrchat/groups.js';
import { whitelistManager } from '../../../../managers/whitelist/whitelistManager.js';
import { prisma, bot } from '../../../../main.js';
import { EmbedBuilder, Colors, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { sendWhitelistLog, getUserWhitelistRoles } from '../../../../utility/vrchat/whitelistLogger.js';
import { VerificationInteractionManager } from '../../../../managers/verification/verificationInteractionManager.js';
import { loggers } from '../../../../utility/logger.js';

interface FriendAddContent {
  userId?: string;
  id?: string;
}

export async function handleFriendAdd(content: unknown) {
  const typedContent = content as FriendAddContent;
    // content should include the VRChat user ID of the new friend
    const vrcUserId = typedContent.userId || typedContent.id;
    if (!vrcUserId) {
        loggers.vrchat.warn('No VRChat user ID found in event', { content });
        return;
    }
    // Find the VRChatAccount in the database (pending verification)
    const vrcAccount = await prisma.vRChatAccount.findFirst({
        where: { vrcUserId, accountType: { in: ["IN_VERIFICATION"] } },
    });
    if (!vrcAccount) {
        loggers.vrchat.debug('No VRChatAccount found for VRChat user', { vrcUserId });
        return;
    }
    // Try to update the verified field and set verification status to VERIFIED
    let vrchatUsername: string | null = null;
    // Save verificationGuildId before clearing it (need it outside try block)
    const verificationGuildId = vrcAccount.verificationGuildId;
    try {
        // Get VRChat username for caching
        try {
            const userInfo = await getUserById(vrcUserId);
            const userTyped = userInfo as { displayName?: string; username?: string } | null;
            vrchatUsername = userTyped?.displayName || userTyped?.username || null;
        } catch (e) {
            loggers.vrchat.warn(`Failed to fetch username for ${vrcUserId}`, e);
        }

        // Determine account type based on whether user has a MAIN account
        const hasMainAccount = await prisma.vRChatAccount.findFirst({
            where: { userId: vrcAccount.userId, accountType: "MAIN" }
        });
        const finalAccountType = hasMainAccount ? "ALT" : "MAIN";

        await prisma.vRChatAccount.update({
            where: { id: vrcAccount.id },
            data: {
                accountType: finalAccountType,
                vrchatUsername,
                usernameUpdatedAt: new Date(),
                verificationGuildId: null, // Clear guild ID after verification is complete
            }
        });

        loggers.vrchat.info(`Account ${vrcUserId} successfully verified and marked as VERIFIED`);

        // Get user's Discord ID for interaction lookup
        const user = await prisma.user.findUnique({ where: { id: vrcAccount.userId } });
        const discordId = user?.discordId;

        // Try to update the original verification message, fall back to DM if it fails
        const messageUpdated = await updateVerificationMessage(
            discordId,
            vrcUserId,
            vrchatUsername,
            vrcAccount.userId
        );

        // If we couldn't update the message, send a DM instead
        if (!messageUpdated) {
            await sendDMConfirmation(vrcAccount.userId, vrcUserId, vrchatUsername);
        }
    } catch (e) {
        loggers.vrchat.error('Could not update verification status', e);
    }
    // Fetch the Discord user by userId and update whitelist
    const user = await prisma.user.findUnique({ where: { id: vrcAccount.userId, } });
    if (user && user.discordId) {
        loggers.vrchat.debug(`VRChat account for Discord user: ${user.discordId}`);
        try {
            // For verified accounts, sync and publish with roles
            if (vrchatUsername && verificationGuildId) { // If username was fetched, it was verified
                await whitelistManager.syncAndPublishAfterVerification(user.discordId, verificationGuildId, undefined);
                
                // Send whitelist verification log to the guild where verification was started
                if (bot && bot.guilds && vrcAccount.verificationGuildId) {
                    try {
                        // Get the account type from the updated account
                        const updatedAccount = await prisma.vRChatAccount.findFirst({
                            where: { vrcUserId, userId: vrcAccount.userId }
                        });
                        
                        // Fetch the guild where verification was initiated
                        const guild = await bot.guilds.fetch(vrcAccount.verificationGuildId).catch(() => null);
                        if (guild) {
                            const member = await guild.members.fetch(user.discordId).catch(() => null);
                            if (member) {
                                const displayName = member.displayName || member.user?.username || user.discordId;
                                const whitelistRoles = await getUserWhitelistRoles(user.discordId, verificationGuildId);
                                
                                await sendWhitelistLog(bot, guild.id, {
                                    discordId: user.discordId,
                                    displayName,
                                    vrchatUsername,
                                    vrcUserId,
                                    roles: whitelistRoles,
                                    action: "verified",
                                    accountType: updatedAccount?.accountType,
                                });
                            }
                        }
                    } catch (logError) {
                        loggers.vrchat.warn(`Failed to send whitelist log for ${user.discordId}`, logError);
                    }
                }
            }
        } catch (e) {
            loggers.vrchat.warn(`Failed to update whitelist for user ${user.discordId}`, e);
        }
        // Optionally, send a Discord notification here
    }
}

/**
 * Builds the verification success embed and components
 */
async function buildVerificationSuccessEmbed(
    vrcUserId: string,
    vrchatUsername: string | null,
    discordId: string | null
): Promise<{ embed: EmbedBuilder; components: ActionRowBuilder[] }> {
    const embed = new EmbedBuilder()
        .setTitle("✅ Verification Successful")
        .setDescription(
            `Your VRChat account (**${vrchatUsername || vrcUserId}**) has been successfully verified via friend request!\n\n✅ Your account is now fully verified and protected from takeover.`
        )
        .setColor(Colors.Green)
        .setFooter({ text: "S.H.I.E.L.D. Bot - Verification System" })
        .setTimestamp();

    const components: ActionRowBuilder[] = [];

    if (discordId) {
        // Check if there's a VRChat group configured for any guild
        const guildSettings = await prisma.guildSettings.findFirst({
            where: { vrcGroupId: { not: null } },
        });

        if (guildSettings?.vrcGroupId) {
            // Check if user is already in the group
            let isInGroup = false;
            let hasOnlyDefaultRole = false;
            
            try {
                const groupMember = await getGroupMember(guildSettings.vrcGroupId, vrcUserId);
                if (groupMember) {
                    isInGroup = true;
                    const totalRoles = [
                        ...((groupMember as { roleIds?: string[] }).roleIds || []),
                        ...((groupMember as { mRoleIds?: string[] }).mRoleIds || []),
                    ].length;
                    hasOnlyDefaultRole = totalRoles <= 1;
                }
            } catch (_error) {
                loggers.vrchat.debug(`Could not check group membership for ${vrcUserId}`, _error);
            }

            if (isInGroup) {
                const syncRolesButton = new ButtonBuilder()
                    .setCustomId(`grp-sync:${discordId}:${vrcUserId}`)
                    .setLabel("Sync Roles")
                    .setStyle(hasOnlyDefaultRole ? ButtonStyle.Primary : ButtonStyle.Secondary)
                    .setEmoji("🔄");

                components.push(
                    new ActionRowBuilder().addComponents(syncRolesButton)
                );

                const currentDescription = embed.data.description || "";
                const additionalText = `\n\n**SHIELD VRChat Group**\n✅ You're already in the group!\n• Click **Sync Roles** to update your VRChat group roles based on your Discord roles`;
                const newDescription = currentDescription + additionalText;
                
                if (newDescription.length <= 4096) {
                    embed.setDescription(newDescription);
                }
            } else {
                const joinGroupButton = new ButtonBuilder()
                    .setCustomId(`grp-inv:${discordId}:${vrcUserId}`)
                    .setLabel("Join Group")
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji("🛡️");

                const syncRolesButton = new ButtonBuilder()
                    .setCustomId(`grp-sync:${discordId}:${vrcUserId}`)
                    .setLabel("Sync Roles")
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji("🔄");

                components.push(
                    new ActionRowBuilder().addComponents(joinGroupButton, syncRolesButton)
                );

                const currentDescription = embed.data.description || "";
                const additionalText = `\n\n**SHIELD VRChat Group**\n• Click **Join Group** to receive an invite\n• Click **Sync Roles** to update your VRChat group roles based on your Discord roles`;
                const newDescription = currentDescription + additionalText;
                
                if (newDescription.length <= 4096) {
                    embed.setDescription(newDescription);
                }
            }
        }
    }

    return { embed, components };
}

/**
 * Updates the original verification message when verification completes automatically
 * Uses stored interaction (valid for 15 minutes)
 * Returns true if successful, false otherwise
 */
async function updateVerificationMessage(
    discordId: string | null | undefined,
    vrcUserId: string,
    vrchatUsername: string | null,
    _userId: number
): Promise<boolean> {
    if (!discordId) {
        // Can't use interaction without Discord ID
        return false;
    }

    // Try to use stored interaction (valid for 15 minutes)
    const storedInteraction = VerificationInteractionManager.getInteraction(discordId, vrcUserId);
    if (storedInteraction) {
        try {
            const { embed, components } = await buildVerificationSuccessEmbed(
                vrcUserId,
                vrchatUsername,
                discordId
            );

            // Use interaction.editReply() to update the ephemeral message
            await storedInteraction.editReply({
                embeds: [embed],
                components: components.length > 0 ? components as unknown as readonly (import("discord.js").APIMessageTopLevelComponent | import("discord.js").JSONEncodable<import("discord.js").APIMessageTopLevelComponent> | import("discord.js").TopLevelComponentData | import("discord.js").ActionRowData<import("discord.js").ActionRowComponentData>)[] : [],
            });

            // Remove the interaction since we've used it
            VerificationInteractionManager.removeInteraction(discordId, vrcUserId);

            loggers.vrchat.info(`Successfully updated via stored interaction for ${vrcUserId}`);
            return true;
        } catch (_error) {
            loggers.vrchat.warn(`Failed to update via stored interaction`, _error);
            return false;
        }
    }

    // Interaction expired or not found
    return false;
}

/**
 * Sends a DM confirmation to the user when their VRChat account is verified automatically
 */
async function sendDMConfirmation(userId: number, vrcUserId: string, vrchatUsername: string | null) {
    try {
        // Get the user from database to get their Discord ID
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user?.discordId) {
            loggers.vrchat.warn('No Discord ID found for user', { userId });
            return;
        }

        // Try to send a DM to the user
        try {
            const discordUser = await bot.users.fetch(user.discordId);
            
            const embed = new EmbedBuilder()
                .setTitle("✅ VRChat Verification Complete!")
                .setDescription(`Your VRChat account has been successfully verified!\n\n**Account:** ${vrchatUsername || vrcUserId}\n**Method:** Friend Request\n\nYour account is now fully verified and protected from takeover. You now have access to all whitelisted worlds!`)
                .setColor(Colors.Green)
                .setFooter({ text: "S.H.I.E.L.D. Bot - Verification System" })
                .setTimestamp();

            // Check if there's a VRChat group configured for any guild
            const guildSettings = await prisma.guildSettings.findFirst({
                where: { vrcGroupId: { not: null } },
            });

            const components: ActionRowBuilder[] = [];
            if (guildSettings?.vrcGroupId) {
                // Check if user is already in the group
                let isInGroup = false;
                let hasOnlyDefaultRole = false;
                
                try {
                    const groupMember = await getGroupMember(guildSettings.vrcGroupId, vrcUserId);
                    if (groupMember) {
                        isInGroup = true;
                        // Check if they only have the default/everyone role (0 or 1 role total)
                        const totalRoles = [
                            ...((groupMember as { roleIds?: string[] }).roleIds || []),
                            ...((groupMember as { mRoleIds?: string[] }).mRoleIds || []),
                        ].length;
                        // If they have 1 or fewer roles, they likely only have the default role
                        hasOnlyDefaultRole = totalRoles <= 1;
                    }
                } catch (_error) {
                    // User is not in group or error checking - treat as not in group
                    loggers.vrchat.debug(`Could not check group membership for ${vrcUserId}`, _error);
                }

                if (isInGroup) {
                    if (hasOnlyDefaultRole) {
                        // User is in group but only has default role - prompt to sync
                        const syncRolesButton = new ButtonBuilder()
                            .setCustomId(`grp-sync:${user.discordId}:${vrcUserId}`)
                            .setLabel("Sync Roles")
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji("🔄");

                        components.push(
                            new ActionRowBuilder().addComponents(syncRolesButton)
                        );

                        const currentDescription = embed.data.description || "";
                        const additionalText = `\n\n**SHIELD VRChat Group**\n✅ You're already in the group!\n• Click **Sync Roles** to update your VRChat group roles based on your Discord roles`;
                        const newDescription = currentDescription + additionalText;
                        
                        if (newDescription.length <= 4096) {
                            embed.setDescription(newDescription);
                        }
                    } else {
                        // User is in group and has roles - just show sync option
                        const syncRolesButton = new ButtonBuilder()
                            .setCustomId(`grp-sync:${user.discordId}:${vrcUserId}`)
                            .setLabel("Sync Roles")
                            .setStyle(ButtonStyle.Secondary)
                            .setEmoji("🔄");

                        components.push(
                            new ActionRowBuilder().addComponents(syncRolesButton)
                        );

                        const currentDescription = embed.data.description || "";
                        const additionalText = `\n\n**SHIELD VRChat Group**\n✅ You're already in the group!\n• Click **Sync Roles** to update your VRChat group roles based on your Discord roles`;
                        const newDescription = currentDescription + additionalText;
                        
                        if (newDescription.length <= 4096) {
                            embed.setDescription(newDescription);
                        }
                    }
                } else {
                    // User is not in group - show invite button
                    const joinGroupButton = new ButtonBuilder()
                        .setCustomId(`grp-inv:${user.discordId}:${vrcUserId}`)
                        .setLabel("Join Group")
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji("🛡️");

                    // Format: grp-sync:{discordId}:{vrcUserId}
                    const syncRolesButton = new ButtonBuilder()
                        .setCustomId(`grp-sync:${user.discordId}:${vrcUserId}`)
                        .setLabel("Sync Roles")
                        .setStyle(ButtonStyle.Secondary)
                        .setEmoji("🔄");

                    components.push(
                        new ActionRowBuilder().addComponents(joinGroupButton, syncRolesButton)
                    );

                    const currentDescription = embed.data.description || "";
                    const additionalText = `\n\n**SHIELD VRChat Group**\n• Click **Join Group** to receive an invite\n• Click **Sync Roles** to update your VRChat group roles based on your Discord roles`;
                    const newDescription = currentDescription + additionalText;
                    
                    // Ensure we don't exceed Discord's 4096 character limit for embed descriptions
                    if (newDescription.length <= 4096) {
                        embed.setDescription(newDescription);
                    }
                }
            }

            await discordUser.send({ 
                embeds: [embed],
                components: components.length > 0 ? components as unknown as readonly (import("discord.js").APIMessageTopLevelComponent | import("discord.js").JSONEncodable<import("discord.js").APIMessageTopLevelComponent> | import("discord.js").TopLevelComponentData | import("discord.js").ActionRowData<import("discord.js").ActionRowComponentData>)[] : undefined,
            });
            loggers.vrchat.info(`Successfully sent verification confirmation DM to ${user.discordId}`);
        } catch (dmError: unknown) {
            // If DM fails (user has DMs disabled, etc.), log but don't throw
            loggers.vrchat.warn(`Failed to send DM to ${user.discordId}`, dmError);
        }
    } catch (_error) {
        loggers.vrchat.error('Error in sendDMConfirmation', _error);
    }
}

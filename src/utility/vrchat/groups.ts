// VRChat Group API utilities using vrc-ts

import {
  RequestError,
  GroupIdType,
  GroupUserVisibility,
  GroupRoleIdType,
  type GroupAudit,
} from "vrc-ts";
import { vrchatApi } from "./index.js";
import { VRChatError } from "../errors.js";
import { loggers } from "../logger.js";

/**
 * Invite a user to a VRChat group
 * @param groupId The VRChat group ID (e.g., grp_xxx)
 * @param userId The VRChat user ID to invite (e.g., usr_xxx)
 * @returns Promise resolving to the invitation response or an object with success status
 * @throws {VRChatError} If the invitation fails for reasons other than user already being a member
 */
export async function inviteUserToGroup(
  groupId: string,
  userId: string,
): Promise<{ success: boolean; alreadyMember?: boolean } | unknown> {
  try {
    return await vrchatApi.groupApi.inviteUsertoGroup({
      groupId: groupId as GroupIdType,
      userId,
      confirmOverrideBlock: true,
    });
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      // Handle case where user is already a member (400 error)
      if (error.statusCode === 400) {
        const errorMessage = (error.message || String(error)).toLowerCase();
        // Check if the error indicates the user is already a member
        // Handle various error message formats
        if (
          errorMessage.includes("already a member") ||
          errorMessage.includes("already a member of this group") ||
          errorMessage.includes("is already a member")
        ) {
          // User is already in the group, this is not an error
          loggers.vrchat.info(
            `User ${userId} is already a member of group ${groupId}`,
          );
          return { success: true, alreadyMember: true };
        }
      }
      throw new VRChatError(
        `Failed to invite user to group: ${error.statusCode} ${error.message}`,
        error.statusCode,
        { groupId, userId },
      );
    }
    // Also check for non-RequestError errors that might have the same structure
    const errorObj = error as { statusCode?: number; status?: number; message?: string };
    if (errorObj?.statusCode === 400 || errorObj?.status === 400) {
      const errorMessage = (errorObj.message || JSON.stringify(error) || String(error)).toLowerCase();
      if (
        errorMessage.includes("already a member") ||
        errorMessage.includes("already a member of this group") ||
        errorMessage.includes("is already a member")
      ) {
        loggers.vrchat.debug(
          `User ${userId} is already a member of group ${groupId}`,
        );
        return { success: true, alreadyMember: true };
      }
    }
    throw error;
  }
}

/**
 * Get information about a group member
 * @param groupId The VRChat group ID
 * @param userId The VRChat user ID
 * @returns Promise resolving to the member information, or null if user is not in group
 * @throws {VRChatError} If the request fails for reasons other than 404
 */
export async function getGroupMember(
  groupId: string,
  userId: string,
): Promise<unknown | null> {
  try {
    return await vrchatApi.groupApi.getGroupMember({
      groupId: groupId as GroupIdType,
      userId,
    });
  } catch (error: unknown) {
    if (error instanceof RequestError && error.statusCode === 404) {
      return null; // User not in group
    }
    if (error instanceof RequestError) {
      throw new VRChatError(
        `Failed to get group member: ${error.statusCode} ${error.message}`,
        error.statusCode,
        { groupId, userId },
      );
    }
    throw error;
  }
}

/**
 * Update a group member's roles (assign/unassign)
 * This endpoint allows updating member visibility, subscription settings, and manager notes
 * For role management, use addRoleToGroupMember or removeRoleFromGroupMember
 * @param groupId The VRChat group ID
 * @param userId The VRChat user ID
 * @param updates Object with fields to update
 * @returns Promise resolving to the updated member information
 * @throws {VRChatError} If the update fails
 */
export async function updateGroupMember(
  groupId: string,
  userId: string,
  updates: {
    visibility?: "visible" | "hidden" | "friends";
    isSubscribedToAnnouncements?: boolean;
    isSubscribedToEventAnnouncements?: boolean;
    managerNotes?: string;
  },
): Promise<unknown> {
  try {
    // Map visibility string to GroupUserVisibility enum
    const visibility = updates.visibility 
      ? (updates.visibility === "visible" ? GroupUserVisibility.Visible :
         updates.visibility === "hidden" ? GroupUserVisibility.Hidden :
         GroupUserVisibility.Friends)
      : undefined;

    return await vrchatApi.groupApi.updateGroupMember({
      groupId: groupId as GroupIdType,
      userId,
      visibility,
      isSubscribedToAnnouncements: updates.isSubscribedToAnnouncements,
      managerNotes: updates.managerNotes,
      // Note: isSubscribedToEventAnnouncements is not supported by vrc-ts API
    });
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      throw new VRChatError(
        `Failed to update group member: ${error.statusCode} ${error.message}`,
        error.statusCode,
        { groupId, userId },
      );
    }
    throw error;
  }
}

/**
 * Add a role to a group member
 * @param groupId The VRChat group ID
 * @param userId The VRChat user ID
 * @param roleId The VRChat group role ID (e.g., grol_xxx)
 * @returns Promise resolving to the updated member list
 * @throws {VRChatError} If adding the role fails
 */
export async function addRoleToGroupMember(
  groupId: string,
  userId: string,
  roleId: string,
): Promise<unknown> {
  try {
    return await vrchatApi.groupApi.addRoleToGroupMember({
      groupId: groupId as GroupIdType,
      userId,
      groupRoleId: roleId as GroupRoleIdType, // vrc-ts uses groupRoleId, not roleId
    });
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      throw new VRChatError(
        `Failed to add role to group member: ${error.statusCode} ${error.message}`,
        error.statusCode,
        { groupId, userId, roleId },
      );
    }
    throw error;
  }
}

/**
 * Remove a role from a group member
 * @param groupId The VRChat group ID
 * @param userId The VRChat user ID
 * @param roleId The VRChat group role ID (e.g., grol_xxx)
 * @returns Promise resolving to the updated member list
 * @throws {VRChatError} If removing the role fails
 */
export async function removeRoleFromGroupMember(
  groupId: string,
  userId: string,
  roleId: string,
): Promise<unknown> {
  try {
    return await vrchatApi.groupApi.removeRoleFromGroupMember({
      groupId: groupId as GroupIdType,
      userId,
      groupRoleId: roleId as GroupRoleIdType, // vrc-ts uses groupRoleId, not roleId
    });
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      throw new VRChatError(
        `Failed to remove role from group member: ${error.statusCode} ${error.message}`,
        error.statusCode,
        { groupId, userId, roleId },
      );
    }
    throw error;
  }
}

/**
 * Get all roles for a group
 * @param groupId The VRChat group ID
 * @returns Promise resolving to list of group roles
 * @throws {VRChatError} If fetching roles fails
 */
export async function getGroupRoles(groupId: string): Promise<unknown> {
  try {
    return await vrchatApi.groupApi.getGroupRoles({ 
      groupId: groupId as GroupIdType 
    });
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      throw new VRChatError(
        `Failed to get group roles: ${error.statusCode} ${error.message}`,
        error.statusCode,
        { groupId },
      );
    }
    throw error;
  }
}

export type GetGroupAuditLogsOptions = {
  n?: number;
  offset?: number;
  startDate?: string;
  endDate?: string;
};

/**
 * Fetch VRChat group audit log entries (requires group-audit-view permission).
 */
export async function getGroupAuditLogs(
  groupId: string,
  options: GetGroupAuditLogsOptions = {},
): Promise<GroupAudit> {
  try {
    return await vrchatApi.groupApi.getGroupAuditLogs({
      groupId: groupId as GroupIdType,
      n: options.n,
      offset: options.offset,
      startDate: options.startDate,
      endDate: options.endDate,
    });
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      throw new VRChatError(
        `Failed to get group audit logs: ${error.statusCode} ${error.message}`,
        error.statusCode,
        { groupId },
      );
    }
    throw error;
  }
}
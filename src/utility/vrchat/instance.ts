// Instance-related VRChat API methods using vrc-ts

import { RequestError, InstanceRegionType, InstanceAccessNormalType, WorldIdType, InstanceIdType } from "vrc-ts";
import { vrchatApi } from "./index.js";
import { getCurrentUser } from "./user.js";
import { loggers } from "../logger.js";
import type { VRChatInstance } from "./types.js";

/**
 * Create a VRChat instance
 */
export async function createInstance({
  worldId,
  type = "friends",
  region = "us",
  ownerId,
  canRequestInvite: _canRequestInvite = false,
}: {
  worldId: string;
  type?: "public" | "hidden" | "friends" | "private" | "group";
  region?: "us" | "use" | "eu" | "jp";
  ownerId?: string;
  canRequestInvite?: boolean;
}): Promise<unknown> {
  // For non-public instances, ownerId is required
  let finalOwnerId = ownerId;
  if (type !== "public" && !finalOwnerId) {
    // Get the bot's own user ID if not provided
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      throw new Error("Failed to get current user ID for instance creation");
    }
    finalOwnerId = currentUser.id;
  }

  try {
    // Map type to InstanceAccessNormalType
    const instanceType = type === "public" ? "public" :
                        type === "hidden" ? "hidden" :
                        type === "friends" ? "friends" :
                        type === "private" ? "private" : "friends";
    
    // Map region to InstanceRegionType
    const instanceRegion = (region === "us" ? "us" :
                            region === "use" ? "use" :
                            region === "eu" ? "eu" :
                            region === "jp" ? "jp" : "us") as InstanceRegionType;

    // Build request - ownerId only needed for invite types
    const request: {
      worldId: WorldIdType;
      instanceType: InstanceAccessNormalType;
      region: InstanceRegionType;
      ownerId?: string;
    } = {
      worldId: worldId as WorldIdType,
      instanceType: instanceType as unknown as InstanceAccessNormalType,
      region: instanceRegion,
    };

    // Add ownerId for private instances (needed for non-public instances)
    if (finalOwnerId && type === "private") {
      request.ownerId = finalOwnerId;
    }

    return await vrchatApi.instanceApi.generateNormalInstance(request as Parameters<typeof vrchatApi.instanceApi.generateNormalInstance>[0]);
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      throw new Error(
        `Failed to create instance: ${error.statusCode} ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Invite a user to an instance
 */
export async function inviteUser(
  userId: string,
  instanceLocation: string,
): Promise<unknown> {
  try {
    return await vrchatApi.inviteApi.inviteUser({
      userId,
      instanceId: instanceLocation as InstanceIdType,
    });
  } catch (error: unknown) {
    if (error instanceof RequestError) {
      throw new Error(
        `Failed to invite user: ${error.statusCode} ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Get instance info by short name (e.g., from vrch.at links)
 */
export async function getInstanceInfoByShortName(
  shortName: string,
): Promise<VRChatInstance | null> {
  if (!shortName) {
    loggers.vrchat.debug("No shortName provided for instance lookup");
    return null;
  }

  try {
    const result = await vrchatApi.instanceApi.getInstanceByShortName({
      shortName,
    });
    return result as VRChatInstance;
  } catch (error: unknown) {
    if (error instanceof RequestError && error.statusCode === 404) {
      loggers.vrchat.debug(
        `Instance not found for shortName ${shortName}`,
      );
      return null;
    }
    if (error instanceof RequestError) {
      throw new Error(
        `Failed to fetch instance info by shortName: ${error.statusCode} ${error.message}`,
        { cause: error },
      );
    }
    throw error;
  }
}
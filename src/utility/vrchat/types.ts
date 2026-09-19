/**
 * Type definitions for VRChat API responses
 * These types are based on the vrc-ts library responses
 */

export interface VRChatUser {
  id: string;
  displayName?: string;
  username?: string;
  userIcon?: string;
  profilePicOverride?: string;
  currentAvatarImageUrl?: string;
  currentAvatarThumbnailImageUrl?: string;
  isFriend?: boolean;
  statusDescription?: string;
  [key: string]: unknown; // Allow additional properties
}

/** Fields from GET /profile/{userId} used for avatar/icon URLs. */
export interface VRChatPublicProfile {
  id?: string;
  displayName?: string;
  userIcon?: string;
  iconUrl?: string;
  profilePicOverride?: string;
  currentAvatarImageUrl?: string;
  currentAvatarThumbnailImageUrl?: string;
  bannerUrl?: string;
  [key: string]: unknown;
}

export type VRChatUserAvatarUrls = {
  image: string | null;
  thumbnail: string | null;
};

// Type guard for VRChatUser
export function isVRChatUser(obj: unknown): obj is VRChatUser {
  return typeof obj === "object" && obj !== null && "id" in obj && typeof (obj as { id: unknown }).id === "string";
}

export interface VRChatInstance {
  id?: string;
  instanceId?: string;
  worldId?: string;
  location?: string;
  shortName?: string;
  secureName?: string;
  world?: {
    id?: string;
    name?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown; // Allow additional properties
}

export interface VRChatWorld {
  id?: string;
  name?: string;
  [key: string]: unknown; // Allow additional properties
}

export interface VRChatGroupMember {
  roleIds?: string[];
  mRoleIds?: string[];
  [key: string]: unknown; // Allow additional properties
}

export interface VRChatWebSocketData {
  user?: VRChatUser;
  userId?: string;
  location?: string;
  worldId?: string;
  travelingToLocation?: string;
  [key: string]: unknown; // Allow additional properties
}


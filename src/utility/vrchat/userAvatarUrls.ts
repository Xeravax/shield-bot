import type {
  VRChatPublicProfile,
  VRChatUser,
  VRChatUserAvatarUrls,
} from "./types.js";

function firstUrl(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

/**
 * Prefer leftover getUser image fields, then getPublicProfile.
 * Image is the large embed art; thumbnail is the small icon.
 */
export function pickUserAvatarUrls(
  user?: Pick<
    VRChatUser,
    | "userIcon"
    | "profilePicOverride"
    | "currentAvatarImageUrl"
    | "currentAvatarThumbnailImageUrl"
  > | null,
  profile?: VRChatPublicProfile | null,
): VRChatUserAvatarUrls {
  return {
    image: firstUrl(
      user?.profilePicOverride,
      user?.currentAvatarImageUrl,
      user?.currentAvatarThumbnailImageUrl,
      profile?.profilePicOverride,
      profile?.currentAvatarImageUrl,
      profile?.bannerUrl,
      profile?.currentAvatarThumbnailImageUrl,
      profile?.iconUrl,
      profile?.userIcon,
      user?.userIcon,
    ),
    thumbnail: firstUrl(
      user?.userIcon,
      user?.profilePicOverride,
      profile?.userIcon,
      profile?.iconUrl,
      profile?.profilePicOverride,
      profile?.currentAvatarThumbnailImageUrl,
    ),
  };
}

export function userHasCompleteAvatarUrls(
  user: Pick<
    VRChatUser,
    | "userIcon"
    | "profilePicOverride"
    | "currentAvatarImageUrl"
    | "currentAvatarThumbnailImageUrl"
  >,
): boolean {
  const urls = pickUserAvatarUrls(user, null);
  return Boolean(urls.image && urls.thumbnail);
}

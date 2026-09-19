import { describe, expect, it } from "vitest";
import {
  pickUserAvatarUrls,
  userHasCompleteAvatarUrls,
} from "./userAvatarUrls.js";

describe("pickUserAvatarUrls", () => {
  it("prefers leftover getUser profile and avatar URLs", () => {
    expect(
      pickUserAvatarUrls(
        {
          profilePicOverride: "https://example.com/override.png",
          currentAvatarImageUrl: "https://example.com/avatar.png",
          currentAvatarThumbnailImageUrl: "https://example.com/thumb.png",
          userIcon: "https://example.com/icon.png",
        },
        {
          iconUrl: "https://example.com/profile-icon.png",
          bannerUrl: "https://example.com/banner.png",
        },
      ),
    ).toEqual({
      image: "https://example.com/override.png",
      thumbnail: "https://example.com/icon.png",
    });
  });

  it("falls back to public profile when getUser no longer has images", () => {
    expect(
      pickUserAvatarUrls(
        {},
        {
          iconUrl: "https://example.com/icon.png",
          bannerUrl: "https://example.com/banner.png",
        },
      ),
    ).toEqual({
      image: "https://example.com/banner.png",
      thumbnail: "https://example.com/icon.png",
    });
  });

  it("treats blank strings as missing", () => {
    expect(
      pickUserAvatarUrls(
        { profilePicOverride: "  ", userIcon: "" },
        { iconUrl: "https://example.com/icon.png" },
      ),
    ).toEqual({
      image: "https://example.com/icon.png",
      thumbnail: "https://example.com/icon.png",
    });
  });

  it("returns nulls when nothing is available", () => {
    expect(pickUserAvatarUrls(null, null)).toEqual({
      image: null,
      thumbnail: null,
    });
  });
});

describe("userHasCompleteAvatarUrls", () => {
  it("is true when getUser still has image and thumbnail", () => {
    expect(
      userHasCompleteAvatarUrls({
        profilePicOverride: "https://example.com/override.png",
        userIcon: "https://example.com/icon.png",
      }),
    ).toBe(true);
  });

  it("is false when image fields have left getUser", () => {
    expect(userHasCompleteAvatarUrls({})).toBe(false);
  });
});

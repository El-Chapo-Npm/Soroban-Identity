import { describe, expect, it, vi } from "vitest";
import { AvatarUploadError, uploadAvatar } from "./avatarUpload";

describe("uploadAvatar", () => {
  it("rejects a 413 pin response instead of reporting success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "PAYLOAD_TOO_LARGE" }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(
      uploadAvatar(new File(["avatar"], "avatar.png", { type: "image/png" }), "/pin", fetchImpl)
    ).rejects.toMatchObject<Partial<AvatarUploadError>>({
      name: "AvatarUploadError",
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
    });
  });

  it("returns the CID only for a successful pin response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ IpfsHash: "bafy-avatar" }), { status: 200 })
      );

    await expect(uploadAvatar(new File(["avatar"], "avatar.png"), "/pin", fetchImpl)).resolves.toBe(
      "bafy-avatar"
    );
  });
});

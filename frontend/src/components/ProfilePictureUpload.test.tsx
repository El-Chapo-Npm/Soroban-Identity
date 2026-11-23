/** Profile picture upload linked to a DID (issue #1258). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({
  uploadAvatar: vi.fn(),
  AvatarUploadError: class AvatarUploadError extends Error {
    status: number;
    code: string | null;
    constructor(message: string, status: number, code: string | null = null) {
      super(message);
      this.name = "AvatarUploadError";
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("../services/avatarUpload", () => ({
  uploadAvatar: m.uploadAvatar,
  AvatarUploadError: m.AvatarUploadError,
}));

import { ProfilePictureUpload } from "./ProfilePictureUpload";

const imageFile = (name = "avatar.png", type = "image/png", bytes = 16) =>
  new File([new Uint8Array(bytes)], name, { type });

describe("ProfilePictureUpload (#1258)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads the image then links the CID to the DID", async () => {
    m.uploadAvatar.mockResolvedValueOnce("bafy-avatar");
    const onLinked = vi.fn().mockResolvedValue(undefined);
    render(<ProfilePictureUpload address="GABCDEF" onLinked={onLinked} upload={m.uploadAvatar} />);

    fireEvent.change(screen.getByTestId("avatar-file"), {
      target: { files: [imageFile()] },
    });
    fireEvent.click(screen.getByTestId("avatar-submit"));

    await waitFor(() => expect(onLinked).toHaveBeenCalledWith("bafy-avatar"));
    expect(m.uploadAvatar).toHaveBeenCalledTimes(1);
    const preview = await screen.findByTestId("avatar-preview");
    expect(preview.getAttribute("src")).toContain("bafy-avatar");
  });

  it("reports a rejected upload and never links an unuploaded CID", async () => {
    m.uploadAvatar.mockRejectedValueOnce(
      new m.AvatarUploadError("Avatar is too large. Choose an image smaller than 2 MB.", 413, "PAYLOAD_TOO_LARGE"),
    );
    const onLinked = vi.fn().mockResolvedValue(undefined);
    render(<ProfilePictureUpload address="GABCDEF" onLinked={onLinked} upload={m.uploadAvatar} />);

    fireEvent.change(screen.getByTestId("avatar-file"), {
      target: { files: [imageFile()] },
    });
    fireEvent.click(screen.getByTestId("avatar-submit"));

    expect(await screen.findByTestId("avatar-error")).toBeTruthy();
    expect(onLinked).not.toHaveBeenCalled();
    expect(screen.queryByTestId("avatar-preview")).toBeNull();
  });

  it("rejects non-image and oversized files before uploading", () => {
    render(<ProfilePictureUpload address="GABCDEF" onLinked={vi.fn()} upload={m.uploadAvatar} />);

    fireEvent.change(screen.getByTestId("avatar-file"), {
      target: { files: [imageFile("notes.txt", "text/plain")] },
    });
    expect(screen.getByTestId("avatar-error").textContent).toContain("image file");
    expect((screen.getByTestId("avatar-submit") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByTestId("avatar-file"), {
      target: { files: [imageFile("huge.png", "image/png", 3 * 1024 * 1024)] },
    });
    expect(screen.getByTestId("avatar-error").textContent).toContain("2 MB");
    expect(m.uploadAvatar).not.toHaveBeenCalled();
  });
});

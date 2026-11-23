import { useState } from "react";
import { AvatarUploadError, uploadAvatar } from "../services/avatarUpload";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const DEFAULT_GATEWAY = "https://ipfs.io/ipfs/";

function gatewayUrl(cid: string): string {
  const base = import.meta.env.VITE_IPFS_GATEWAY || DEFAULT_GATEWAY;
  return `${base.replace(/\/?$/, "/")}${encodeURIComponent(cid)}`;
}

interface ProfilePictureUploadProps {
  /** Address whose DID metadata will hold the avatar reference. */
  address: string;
  /** Existing CID, when the DID already has an avatar. */
  currentCid?: string | null;
  /** Persists the CID to the DID. Called only after a successful upload. */
  onLinked: (cid: string) => Promise<void>;
  /** Injectable for tests. */
  upload?: typeof uploadAvatar;
}

/**
 * Profile picture upload for a DID (issue #1258).
 *
 * The file is pinned through the configured IPFS or centralized pin endpoint
 * and the returned CID is written to the DID's metadata as `avatar`. Consumers
 * can resolve it through any IPFS gateway, so the DID stays portable.
 */
export function ProfilePictureUpload({
  address,
  currentCid,
  onLinked,
  upload = uploadAvatar,
}: ProfilePictureUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [cid, setCid] = useState<string | null>(currentCid ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectFile = (next: File | null) => {
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!next.type.startsWith("image/")) {
      setFile(null);
      setError("Choose an image file (PNG, JPEG, GIF or WebP).");
      return;
    }
    if (next.size > MAX_AVATAR_BYTES) {
      setFile(null);
      setError("Avatar is too large. Choose an image smaller than 2 MB.");
      return;
    }
    setFile(next);
  };

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await upload(file);
      await onLinked(uploaded);
      setCid(uploaded);
      setFile(null);
    } catch (err) {
      setError(
        err instanceof AvatarUploadError || err instanceof Error
          ? err.message
          : "Unable to upload profile picture.",
      );
    } finally {
      setBusy(false);
    }
  };

  const displayCid = cid ?? currentCid;

  return (
    <section aria-label="Profile picture" data-testid="profile-picture-upload">
      <h3>Profile picture</h3>
      {displayCid && (
        <img
          src={gatewayUrl(displayCid)}
          alt={`Profile picture for ${address}`}
          width={96}
          height={96}
          data-testid="avatar-preview"
          style={{ borderRadius: "50%", objectFit: "cover" }}
        />
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/*"
        aria-label="Choose a profile picture"
        data-testid="avatar-file"
        onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        disabled={!file || busy}
        onClick={() => void submit()}
        data-testid="avatar-submit"
      >
        {busy ? "Uploading…" : "Upload & link to DID"}
      </button>
      {file && (
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          Selected: {file.name}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="avatar-error">
          {error}
        </p>
      )}
    </section>
  );
}

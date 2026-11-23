export class AvatarUploadError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "AvatarUploadError";
    this.status = status;
    this.code = code;
  }
}

interface PinResponse {
  cid?: string;
  IpfsHash?: string;
  code?: string;
  error?: string;
  message?: string;
}

/**
 * Upload a profile avatar to the configured IPFS pin endpoint.
 *
 * A pin request is successful only when the server returns a 2xx response and
 * a CID. In particular, a 413 must reject so callers do not show a success
 * toast for an avatar that was never pinned.
 */
export async function uploadAvatar(
  file: File,
  endpoint = import.meta.env.VITE_IPFS_PIN_ENDPOINT || "/api/v1/profile/avatar",
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const body = new FormData();
  body.append("avatar", file, file.name);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, { method: "POST", body });
  } catch (error) {
    throw new AvatarUploadError(
      error instanceof Error ? error.message : "Unable to upload avatar.",
      0
    );
  }

  let payload: PinResponse = {};
  try {
    payload = (await response.json()) as PinResponse;
  } catch {
    // Preserve the HTTP status below when the server sends an empty/non-JSON body.
  }

  if (!response.ok) {
    const message =
      payload.message ||
      payload.error ||
      (response.status === 413
        ? "Avatar is too large. Choose an image smaller than 2 MB."
        : "Unable to upload avatar.");
    throw new AvatarUploadError(message, response.status, payload.code || payload.error || null);
  }

  const cid = payload.cid || payload.IpfsHash;
  if (!cid) {
    throw new AvatarUploadError(
      "Avatar upload returned no IPFS content identifier.",
      response.status
    );
  }
  return cid;
}

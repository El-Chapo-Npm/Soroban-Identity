const WEB3_STORAGE_UPLOAD_URL = "https://api.web3.storage/upload";

export class IpfsStorageError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "IpfsStorageError";
  }
}

/** Pin JSON through web3.storage. The token is never included in errors. */
export async function pinJson(document, {
  token = process.env.WEB3_STORAGE_TOKEN,
  fetchImpl = globalThis.fetch,
  endpoint = WEB3_STORAGE_UPLOAD_URL,
} = {}) {
  if (!token) throw new IpfsStorageError("WEB3_STORAGE_TOKEN is not configured.");
  if (typeof fetchImpl !== "function") throw new IpfsStorageError("A fetch implementation is required for IPFS uploads.");
  const body = new Blob([JSON.stringify(document)], { type: "application/json" });
  const form = new FormData();
  form.append("file", body, "did-document.json");
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
  } catch (error) {
    throw new IpfsStorageError("IPFS upload failed.", error);
  }
  if (!response.ok) throw new IpfsStorageError(`IPFS upload failed with status ${response.status}.`);
  let result;
  try { result = await response.json(); } catch (error) { throw new IpfsStorageError("IPFS upload returned invalid JSON.", error); }
  if (typeof result?.cid !== "string" || result.cid.length === 0) throw new IpfsStorageError("IPFS upload did not return a CID.");
  return result.cid;
}

/** Create an app-friendly pinning adapter; unset tokens disable automatic pinning. */
export function createIpfsStorage(config = {}, options = {}) {
  const token = config.web3StorageToken ?? process.env.WEB3_STORAGE_TOKEN;
  if (!token) return null;
  return { pinJson: (document) => pinJson(document, { ...options, token }) };
}

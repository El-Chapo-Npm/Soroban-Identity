import { useMemo } from "react";
import type { Credential } from "../../../sdk/src/types";
import { trackShareEvent } from "../utils/credentialCrypto";
import { buildPlatformUrl, trackSocialShare } from "../utils/socialShare";

type SharePlatform = "native" | "x" | "linkedin" | "facebook" | "whatsapp";

type PrivacyMode = "link-only" | "credential-summary" | "public" | "private" | "selective";

interface SocialShareProps {
  url: string;
  credential: Pick<Credential, "id" | "credentialType">;
  privacyMode?: PrivacyMode;
}

const platformLabels: Record<Exclude<SharePlatform, "native">, string> = {
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  whatsapp: "WhatsApp",
};

/** Share a verification link without putting claims or encryption keys in analytics. */
export default function SocialShare({
  url,
  credential,
  privacyMode = "link-only",
}: SocialShareProps) {
  const shareText = useMemo(
    () =>
      privacyMode === "credential-summary" || privacyMode === "public"
        ? `Verify my ${credential.credentialType} credential on Soroban Identity`
        : "Verify this credential on Soroban Identity",
    [credential.credentialType, privacyMode]
  );

  const share = async (platform: SharePlatform) => {
    if (platform === "native" && navigator.share) {
      await navigator.share({ title: "Credential verification", text: shareText, url });
    } else if (platform !== "native") {
      const target = buildPlatformUrl(platform, { url, text: shareText });
      window.open(target, "_blank", "noopener,noreferrer,width=640,height=640");
    }
    trackShareEvent("credential_social_share", {
      platform,
      credentialType: credential.credentialType,
      privacyMode,
      // Deliberately omit credential ID, claims, and the encryption key.
    });
    trackSocialShare({
      platform,
      credentialType: credential.credentialType,
      privacyMode,
    });
  };

  return (
    <div
      aria-label="Share verification link"
      style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}
    >
      {typeof navigator !== "undefined" && "share" in navigator && (
        <button type="button" onClick={() => void share("native")}>
          Share…
        </button>
      )}
      {(Object.keys(platformLabels) as Array<Exclude<SharePlatform, "native">>).map((platform) => (
        <button key={platform} type="button" onClick={() => void share(platform)}>
          {platformLabels[platform]}
        </button>
      ))}
    </div>
  );
}

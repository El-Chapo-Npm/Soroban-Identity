import { useMemo } from "react";
import type { Credential } from "../../../sdk/src/types";
import { trackShareEvent } from "../utils/credentialCrypto";

type SharePlatform = "native" | "x" | "linkedin" | "facebook" | "whatsapp";

interface SocialShareProps {
  url: string;
  credential: Pick<Credential, "id" | "credentialType">;
  privacyMode?: "link-only" | "credential-summary";
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
      privacyMode === "credential-summary"
        ? `Verify my ${credential.credentialType} credential on Soroban Identity`
        : "Verify this credential on Soroban Identity",
    [credential.credentialType, privacyMode]
  );

  const share = async (platform: SharePlatform) => {
    if (platform === "native" && navigator.share) {
      await navigator.share({ title: "Credential verification", text: shareText, url });
    } else {
      const encodedUrl = encodeURIComponent(url);
      const encodedText = encodeURIComponent(shareText);
      const targets: Record<Exclude<SharePlatform, "native">, string> = {
        x: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
        linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
        whatsapp: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
      };
      window.open(targets[platform], "_blank", "noopener,noreferrer,width=640,height=640");
    }
    trackShareEvent("credential_social_share", {
      platform,
      credentialType: credential.credentialType,
      privacyMode,
      // Deliberately omit credential ID, claims, and the encryption key.
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

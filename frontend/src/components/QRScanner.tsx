import { useEffect, useRef, useState } from 'react';

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
};
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;

export type QRScannerProps = {
  /** Called with the credential ID / DID parsed from a valid QR code. */
  onVerify: (id: string) => void;
  onClose?: () => void;
};

/**
 * Extract a credential ID or DID from scanned QR text. Accepts a
 * `?verify=<id>` share URL, a `did:stellar:<address>` DID, or a bare ID.
 * Returns null for anything else.
 */
export function parseScannedId(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const verify = new URL(text).searchParams.get('verify');
    if (verify) return verify;
  } catch {
    // not a URL
  }
  if (/^did:stellar:[A-Za-z0-9]+$/.test(text)) return text;
  return /^[A-Za-z0-9_-]{1,128}$/.test(text) ? text : null;
}

export default function QRScanner({ onVerify, onClose }: QRScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onVerifyRef = useRef(onVerify);
  onVerifyRef.current = onVerify;

  useEffect(() => {
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setError('QR scanning is not supported in this browser.');
      return;
    }
    const detector = new Detector({ formats: ['qr_code'] });
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;

    const scan = async () => {
      const video = videoRef.current;
      if (cancelled || !video) return;
      try {
        const [code] = await detector.detect(video);
        if (code) {
          const id = parseScannedId(code.rawValue);
          if (id) {
            onVerifyRef.current(id);
            return;
          }
          setError('Invalid QR code: not a credential or DID.');
        }
      } catch {
        // frame not ready; retry
      }
      timer = window.setTimeout(scan, 300);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        void scan();
      })
      .catch(() => setError('Camera permission denied or unavailable.'));

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div role="dialog" aria-label="Scan credential QR code">
      <video ref={videoRef} playsInline muted style={{ width: '100%', maxWidth: 360 }} />
      {error && <p role="alert">{error}</p>}
      {onClose && (
        <button type="button" onClick={onClose}>
          Close
        </button>
      )}
    </div>
  );
}

import { useState } from "react";
import type { WalletState } from "../hooks/useWallet";

interface Props {
  wallet: WalletState & { signTransaction: (xdr: string) => Promise<string> };
}

const STEPS = ["Profile", "Recovery", "Confirm"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function CreateIdentityWizard({ wallet }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [recoveryAddress, setRecoveryAddress] = useState("");
  const [threshold, setThreshold] = useState("1");
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const step1Valid = name.trim() !== "" && EMAIL_RE.test(email);
  const step2Valid = recoveryAddress === "" || /^G[A-Z2-7]{55}$/.test(recoveryAddress.trim());
  const canNext = step === 0 ? step1Valid : step2Valid;

  const deploy = async () => {
    if (!wallet.connected || !wallet.publicKey) return;
    setDeploying(true);
    setResult(null);
    try {
      // TODO: build tx via IdentityClient.createDid() with metadata, sign via wallet.signTransaction(), submit
      await new Promise((r) => setTimeout(r, 1000));
      setResult(`DID created: did:stellar:${wallet.publicKey}`);
    } catch (e: unknown) {
      setResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeploying(false);
    }
  };

  if (!wallet.connected || !wallet.publicKey) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
        Connect your Freighter wallet to create a new on-chain DID.
      </p>
    );
  }

  return (
    <>
      <ol className="wizard-steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "active" : i < step ? "done" : ""}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <>
          <input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </>
      )}

      {step === 1 && (
        <>
          <input
            placeholder="Recovery address (G…, optional)"
            value={recoveryAddress}
            onChange={(e) => setRecoveryAddress(e.target.value)}
          />
          <label style={{ display: "block", color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "0.25rem" }}>
            Recovery threshold
          </label>
          <input type="number" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          {!step2Valid && <p style={{ color: "var(--error-text)", fontSize: "0.8rem" }}>Invalid Stellar address.</p>}
        </>
      )}

      {step === 2 && (
        <pre className="result" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
{`Controller: ${wallet.publicKey}
Name:       ${name}
Email:      ${email}
Recovery:   ${recoveryAddress || "none"}
Threshold:  ${threshold}`}
        </pre>
      )}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        {step > 0 && (
          <button className="theme-toggle" onClick={() => setStep(step - 1)} disabled={deploying}>
            Back
          </button>
        )}
        {step < 2 ? (
          <button onClick={() => setStep(step + 1)} disabled={!canNext}>Next</button>
        ) : (
          <button onClick={deploy} disabled={deploying}>{deploying ? "Deploying…" : "Confirm & Deploy"}</button>
        )}
      </div>
      {result && <pre className="result">{result}</pre>}
    </>
  );
}

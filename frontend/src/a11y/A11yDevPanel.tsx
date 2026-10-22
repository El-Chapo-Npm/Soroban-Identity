import { useEffect, useState } from "react";
import { runA11yAudit, subscribeA11y, reportToJson, reportToMarkdown, type A11yReport } from "./axeRuntime";

/** Floating dev tools panel listing live accessibility findings. Rendered only in development. */
export default function A11yDevPanel() {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<A11yReport | null>(null);
  const [exported, setExported] = useState<string>("");

  useEffect(() => subscribeA11y(setReport), []);

  const total = report ? report.violations.length + report.keyboard.length + report.screenReader.length : 0;

  return (
    <aside aria-label="Accessibility dev tools" style={{ position: "fixed", bottom: 16, left: 16, zIndex: 9999 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        a11y {report ? `(${total})` : ""}
      </button>
      {open && (
        <div role="region" aria-label="Accessibility findings" style={{ background: "#fff", color: "#111", padding: 12, maxWidth: 420, maxHeight: 400, overflow: "auto", border: "1px solid #888" }}>
          <button type="button" onClick={() => void runA11yAudit()}>Re-run audit</button>{" "}
          <button type="button" disabled={!report} onClick={() => report && setExported(reportToMarkdown(report))}>Markdown report</button>{" "}
          <button type="button" disabled={!report} onClick={() => report && setExported(reportToJson(report))}>JSON report</button>
          {report && (
            <>
              <p aria-live="polite">{report.violations.length} WCAG violations, {report.passes} passes</p>
              <ul>
                {report.violations.map((v) => (
                  <li key={v.id}><strong>{v.impact}</strong> {v.id}: {v.help} ({v.nodes.length})</li>
                ))}
                {report.keyboard.map((k, i) => <li key={`k${i}`}>keyboard: {k.selector} — {k.issue}</li>)}
                {report.screenReader.map((s, i) => <li key={`s${i}`}>screen reader: {s.selector} — {s.issue}</li>)}
              </ul>
            </>
          )}
          {exported && <textarea aria-label="Exported report" readOnly value={exported} rows={10} style={{ width: "100%" }} />}
        </div>
      )}
    </aside>
  );
}

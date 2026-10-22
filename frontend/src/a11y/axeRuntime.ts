import type { AxeResults, Result } from "axe-core";

export interface A11yReport {
  url: string;
  timestamp: string;
  violations: Result[];
  passes: number;
  incomplete: Result[];
  keyboard: KeyboardIssue[];
  screenReader: ScreenReaderIssue[];
}

export interface KeyboardIssue {
  selector: string;
  issue: string;
}

export interface ScreenReaderIssue {
  selector: string;
  issue: string;
}

/** WCAG 2.1 A/AA rule tags used for automated checks. */
export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"];

type Listener = (report: A11yReport) => void;
const listeners = new Set<Listener>();
let lastReport: A11yReport | null = null;

export function subscribeA11y(listener: Listener): () => void {
  listeners.add(listener);
  if (lastReport) listener(lastReport);
  return () => listeners.delete(listener);
}

function selectorFor(el: Element): string {
  if (el.id) return `#${el.id}`;
  const cls = el.classList.length ? `.${Array.from(el.classList).join(".")}` : "";
  return `${el.tagName.toLowerCase()}${cls}`;
}

/** Keyboard navigation checks: focusable elements must be reachable and visible on focus. */
export function checkKeyboardNavigation(root: ParentNode = document): KeyboardIssue[] {
  const issues: KeyboardIssue[] = [];
  root.querySelectorAll<HTMLElement>("[onclick], [role='button'], [role='link']").forEach((el) => {
    const native = ["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
    if (!native && el.tabIndex < 0) {
      issues.push({ selector: selectorFor(el), issue: "Interactive element is not keyboard focusable" });
    }
  });
  root.querySelectorAll<HTMLElement>("[tabindex]").forEach((el) => {
    if (el.tabIndex > 0) {
      issues.push({ selector: selectorFor(el), issue: "Positive tabindex disrupts natural tab order" });
    }
  });
  return issues;
}

/** Screen reader compatibility heuristics complementing axe (for NVDA/JAWS/VoiceOver). */
export function checkScreenReader(root: ParentNode = document): ScreenReaderIssue[] {
  const issues: ScreenReaderIssue[] = [];
  root.querySelectorAll<HTMLElement>("[aria-hidden='true']").forEach((el) => {
    if (el.querySelector("a, button, input, select, textarea, [tabindex]:not([tabindex='-1'])")) {
      issues.push({ selector: selectorFor(el), issue: "aria-hidden region contains focusable content" });
    }
  });
  if (!root.querySelector("main, [role='main']")) {
    issues.push({ selector: "document", issue: "No main landmark for screen reader navigation" });
  }
  root.querySelectorAll<HTMLElement>("[aria-live]").forEach((el) => {
    const v = el.getAttribute("aria-live");
    if (v && !["polite", "assertive", "off"].includes(v)) {
      issues.push({ selector: selectorFor(el), issue: `Invalid aria-live value "${v}"` });
    }
  });
  return issues;
}

export async function runA11yAudit(context: Element | Document = document): Promise<A11yReport> {
  const axe = (await import("axe-core")).default;
  const results: AxeResults = await axe.run(context as Element, {
    runOnly: { type: "tag", values: WCAG_TAGS },
  });
  const report: A11yReport = {
    url: typeof location !== "undefined" ? location.href : "",
    timestamp: new Date().toISOString(),
    violations: results.violations,
    passes: results.passes.length,
    incomplete: results.incomplete,
    keyboard: checkKeyboardNavigation(context),
    screenReader: checkScreenReader(context),
  };
  lastReport = report;
  listeners.forEach((l) => l(report));
  return report;
}

export function reportToJson(report: A11yReport): string {
  return JSON.stringify(report, null, 2);
}

export function reportToMarkdown(report: A11yReport): string {
  const lines = [
    `# Accessibility report`,
    ``,
    `- URL: ${report.url}`,
    `- Generated: ${report.timestamp}`,
    `- Violations: ${report.violations.length} | Passes: ${report.passes} | Needs review: ${report.incomplete.length}`,
    ``,
    `## WCAG violations`,
    ...report.violations.map(
      (v) => `- **${v.id}** (${v.impact ?? "n/a"}): ${v.help} — ${v.nodes.length} node(s) ${v.helpUrl}`,
    ),
    ``,
    `## Keyboard navigation`,
    ...report.keyboard.map((k) => `- \`${k.selector}\`: ${k.issue}`),
    ``,
    `## Screen reader`,
    ...report.screenReader.map((s) => `- \`${s.selector}\`: ${s.issue}`),
  ];
  return lines.join("\n");
}

/** Dev-only: re-run axe on DOM changes (debounced) and log violations to the console. */
export function startRuntimeA11y(debounceMs = 1500): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const report = await runA11yAudit();
      if (report.violations.length) {
        console.groupCollapsed(`[a11y] ${report.violations.length} WCAG violation(s)`);
        report.violations.forEach((v) => console.warn(v.id, v.help, v.nodes.map((n) => n.target)));
        console.groupEnd();
      }
    }, debounceMs);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  schedule();
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}

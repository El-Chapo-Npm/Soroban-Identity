import { describe, it, expect } from "vitest";
import { checkKeyboardNavigation, checkScreenReader, reportToMarkdown } from "./axeRuntime";

describe("a11y runtime checks", () => {
  it("flags positive tabindex and non-focusable role=button", () => {
    document.body.innerHTML = `<div role="button" tabindex="-1">x</div><span tabindex="3">y</span>`;
    const issues = checkKeyboardNavigation(document);
    expect(issues).toHaveLength(2);
  });

  it("flags focusable content inside aria-hidden and missing main", () => {
    document.body.innerHTML = `<div aria-hidden="true"><button>b</button></div>`;
    const issues = checkScreenReader(document);
    expect(issues.map((i) => i.issue)).toEqual(
      expect.arrayContaining(["aria-hidden region contains focusable content", "No main landmark for screen reader navigation"]),
    );
  });

  it("renders a markdown report", () => {
    const md = reportToMarkdown({ url: "u", timestamp: "t", violations: [], passes: 3, incomplete: [], keyboard: [], screenReader: [] });
    expect(md).toContain("Passes: 3");
  });
});

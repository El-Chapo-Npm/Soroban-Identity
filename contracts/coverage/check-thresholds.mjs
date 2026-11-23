// Validates cargo-llvm-cov JSON summary against line/branch thresholds and writes a markdown summary.
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [file, lineMin = "80", branchMin = "70"] = process.argv.slice(2);
const totals = JSON.parse(readFileSync(file, "utf8")).data[0].totals;
const line = totals.lines.percent;
const branch = totals.branches?.count ? totals.branches.percent : null;

const summary = [
  "## Contract Coverage",
  "",
  "| Metric | Covered | Total | % | Threshold |",
  "|---|---|---|---|---|",
  `| Lines | ${totals.lines.covered} | ${totals.lines.count} | ${line.toFixed(2)} | ${lineMin}% |`,
  `| Branches | ${totals.branches?.covered ?? "-"} | ${totals.branches?.count ?? "-"} | ${branch === null ? "n/a" : branch.toFixed(2)} | ${branchMin}% |`,
  `| Functions | ${totals.functions.covered} | ${totals.functions.count} | ${totals.functions.percent.toFixed(2)} | - |`,
].join("\n");
writeFileSync(join(dirname(file), "summary.md"), summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
console.log(summary);

const failures = [];
if (line < Number(lineMin)) failures.push(`line coverage ${line.toFixed(2)}% < ${lineMin}%`);
if (branch !== null && branch < Number(branchMin)) failures.push(`branch coverage ${branch.toFixed(2)}% < ${branchMin}%`);
if (failures.length) {
  console.error("Coverage below threshold: " + failures.join(", "));
  process.exit(1);
}

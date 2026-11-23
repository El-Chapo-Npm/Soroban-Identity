// Computes mutation score from cargo-mutants outcomes.json and writes a markdown report.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [file, thresholdArg = "70"] = process.argv.slice(2);
const threshold = Number(thresholdArg);
const { outcomes } = JSON.parse(readFileSync(file, "utf8"));
const mutants = outcomes.filter((o) => o.scenario !== "Baseline");
const count = (s) => mutants.filter((o) => o.summary === s).length;
const caught = count("CaughtMutant");
const missed = count("MissedMutant");
const timeout = count("Timeout");
const unviable = count("Unviable");
const scored = caught + missed + timeout;
const score = scored === 0 ? 100 : ((caught + timeout) / scored) * 100;

const survivors = mutants
  .filter((o) => o.summary === "MissedMutant")
  .map((o) => `- \`${o.scenario?.Mutant?.file}:${o.scenario?.Mutant?.span?.start?.line}\` ${o.scenario?.Mutant?.name ?? ""}`);
const report = [
  "# Mutation Testing Report",
  "",
  `| Caught | Missed | Timeout | Unviable | Score | Threshold |`,
  `|---|---|---|---|---|---|`,
  `| ${caught} | ${missed} | ${timeout} | ${unviable} | ${score.toFixed(1)}% | ${threshold}% |`,
  "",
  "## Surviving mutants",
  survivors.length ? survivors.join("\n") : "_None_",
].join("\n");
writeFileSync(join(dirname(dirname(file)), "mutation-report.md"), report);
console.log(report);
if (score < threshold) {
  console.error(`Mutation score ${score.toFixed(1)}% is below threshold ${threshold}%`);
  process.exit(1);
}

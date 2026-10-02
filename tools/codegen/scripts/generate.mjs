import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_SPEC = resolve(ROOT, "..", "..", "server", "openapi.json");
const SPEC = resolve(ROOT, "spec", "openapi.json");
const CLI = "@openapitools/openapi-generator-cli";

const UPSTREAM = "El-Chapo-Npm/Soroban-Identity";
const REPO_URL = `https://github.com/${UPSTREAM}.git`;
const GO_MODULE = `github.com/${UPSTREAM}/tools/codegen/generated/go`;
const GIT_META = "gitUserId=El-Chapo-Npm,gitRepoId=Soroban-Identity";

const GENERATORS = ["typescript", "python", "go"];

const PRUNE = {
  go: ["git_push.sh", ".travis.yml"],
  python: ["git_push.sh", ".travis.yml", ".gitlab-ci.yml", ".github", "tox.ini", "test-requirements.txt"],
  typescript: ["git_push.sh", ".gitattributes"],
};

function writeIgnore(output, patterns) {
  const body = [
    "# OpenAPI Generator Ignore",
    "# Managed by tools/codegen/scripts/generate.mjs",
    "",
    "# Generator boilerplate that must never be committed (pruned after each run):",
    ...patterns.map((p) => p.endsWith("/") ? `${p}**` : p),
    "",
  ].join("\n");
  writeFileSync(resolve(output, ".openapi-generator-ignore"), body, "utf8");
}

const requested = process.argv.slice(2).filter((flag) => flag.startsWith("--"));
const only = requested.length > 0 ? requested.map((flag) => flag.replace(/^--/, "")) : GENERATORS;

for (const key of only) {
  if (!GENERATORS.includes(key)) {
    console.error(`Unknown generator "${key}". Valid values: ${GENERATORS.join(", ")}`);
    process.exit(1);
  }
}

function pinSpec() {
  mkdirSync(dirname(SPEC), { recursive: true });
  if (!existsSync(SERVER_SPEC)) {
    console.error(`Server spec not found at ${SERVER_SPEC}`);
    process.exit(1);
  }
  copyFileSync(SERVER_SPEC, SPEC);
  console.log(`Pinned spec: ${relative(ROOT, SERVER_SPEC)} -> ${relative(ROOT, SPEC)}`);
}

function run(command) {
  const cli = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(cli, command, { cwd: ROOT, shell: process.platform === "win32", stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function replaceInFile(file, search, replacement, what) {
  if (!existsSync(file)) {
    console.warn(`  ! skip ${what}: ${relative(ROOT, file)} not found`);
    return;
  }
  const text = readFileSync(file, "utf8");
  if (!text.includes(search)) {
    console.warn(`  ! skip ${what}: pattern not found in ${relative(ROOT, file)}`);
    return;
  }
  writeFileSync(file, text.replace(search, replacement));
  console.log(`  ✓ ${what}`);
}

function patchPublishMetadata(key) {
  const out = resolve(ROOT, "generated", key);
  const prune = PRUNE[key] ?? [];
  for (const entry of prune) {
    rmSync(resolve(out, entry), { recursive: true, force: true });
  }
  writeIgnore(out, prune);
  if (prune.length > 0) {
    console.log(`  ✓ ${key}: pruned generator boilerplate (${prune.join(", ")})`);
  }
  if (key === "typescript") {
    const pkg = resolve(out, "package.json");
    if (!existsSync(pkg)) return;
    const doc = JSON.parse(readFileSync(pkg, "utf8"));
    doc.author = "Soroban Identity";
    doc.description = "Generated TypeScript API client for the Soroban Identity Server API (typescript-fetch).";
    doc.repository = { type: "git", url: REPO_URL };
    doc.publishConfig = { access: "public", registry: "https://registry.npmjs.org/" };
    writeFileSync(pkg, JSON.stringify(doc, null, 2) + "\n");
    console.log("  ✓ typescript: package.json publish metadata");
  }
  if (key === "python") {
    const pyproject = resolve(out, "pyproject.toml");
    const setupPy = resolve(out, "setup.py");
    replaceInFile(
      pyproject,
      'name = "soroban_identity_client"',
      `name = "soroban-identity-python"`,
      "python: pyproject dist name",
    );
    replaceInFile(
      pyproject,
      '  {name = "OpenAPI Generator Community",email = "team@openapitools.org"},',
      `  {name = "Soroban Identity"},\n  {name = "El-Chapo-Npm"},`,
      "python: pyproject authors",
    );
    replaceInFile(
      pyproject,
      'Repository = "https://github.com/GIT_USER_ID/GIT_REPO_ID"',
      `Repository = "${REPO_URL.replace(/\.git$/, "")}"`,
      "python: pyproject repository url",
    );
    replaceInFile(setupPy, 'author="OpenAPI Generator community",', `author="Soroban Identity",`, "python: setup.py author");
    replaceInFile(setupPy, 'author_email="team@openapitools.org",', 'author_email="dev@soroban-identity.stellar.org",', "python: setup.py author email");
  }
  if (key === "go") {
    const gomod = resolve(out, "go.mod");
    writeFileSync(
      gomod,
      readFileSync(gomod, "utf8").replace(/^module .*$/m, `module ${GO_MODULE}`),
      "utf8",
    );
    console.log("  ✓ go: module path pinned");
    rmSync(resolve(out, "test"), { recursive: true, force: true });
    console.log("  ✓ go: removed auto-generated test scaffolding");
    try {
      execSync("gofmt -w .", { cwd: out, stdio: "ignore" });
      console.log("  ✓ go: gofmt applied");
    } catch (err) {
      console.warn(`  ! go: gofmt unavailable (${err.message}) — expect formatting drift`);
    }
  }
  if (key === "python") {
    rmSync(resolve(out, "test"), { recursive: true, force: true });
    console.log("  ✓ python: removed auto-generated test scaffolding");
  }
}

pinSpec();

for (const key of only) {
  const config = resolve(ROOT, "config", `${key}.yaml`);
  const output = resolve(ROOT, "generated", key);
  rmSync(output, { recursive: true, force: true });
  console.log(`\n=== Generating ${key} client ===`);
  run([
    "--yes",
    CLI,
    "generate",
    "--input-spec",
    SPEC,
    "--generator-name",
    key,
    "--output",
    output,
    "--config",
    config,
    "--global-property",
    GIT_META,
  ]);
  patchPublishMetadata(key);
}

console.log("\nDone. Generated clients:");
for (const key of only) {
  console.log(`  - ${key}: ${relative(ROOT, resolve(ROOT, "generated", key))}`);
}
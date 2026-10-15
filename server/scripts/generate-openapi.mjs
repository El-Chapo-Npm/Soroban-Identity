import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Generates `server/openapi.json` from the Zod schemas defined in
 * `server/src/schemas/openapi.ts`.
 *
 * Approach
 * --------
 * The schemas live in TypeScript, but the server runs as plain Node ESM.
 * Rather than duplicating the schema definitions or hand-maintaining a
 * separate JSON spec, this script loads the TypeScript module through
 * `tsx` (a zero-config TypeScript loader for Node) and then serializes the
 * resulting spec object to disk.
 *
 * This keeps the published OpenAPI document in lock-step with the Zod
 * schemas: whenever the schemas change, re-running this script regenerates
 * the spec. It is intended to be run via `npm run generate:openapi` (or
 * directly with `node --import tsx server/scripts/generate-openapi.mjs`).
 *
 * If `tsx` is not available in the environment, the script falls back to
 * importing the compiled output at `server/dist/schemas/openapi.js`, which
 * is produced by `tsc` during the normal build. This makes the script
 * usable both in development (via `tsx`) and in CI/release pipelines that
 * only have the compiled artifacts.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverRoot = resolve(__dirname, '..');
const outputPath = resolve(serverRoot, 'openapi.json');

/**
 * Attempt to load the OpenAPI spec generator.
 *
 * Preference order:
 *   1. TypeScript source via `tsx` (development / schema-authoring).
 *   2. Compiled JavaScript output (CI / release builds).
 *
 * @returns {Promise<() => unknown>} The `generateOpenApiSpec` function.
 */
async function loadGenerator() {
  const tsSourcePath = resolve(serverRoot, 'src/schemas/openapi.ts');
  const compiledPath = resolve(serverRoot, 'dist/schemas/openapi.js');

  // 1. Try the TypeScript source through the `tsx` loader.
  try {
    const mod = await import('tsx/esm/api').then((tsx) =>
      tsx.register(),
    ).then(() => import(tsSourcePath));
    if (typeof mod.generateOpenApiSpec === 'function') {
      return mod.generateOpenApiSpec;
    }
  } catch {
    // `tsx` is unavailable or the TS source could not be loaded; fall
    // through to the compiled output below.
  }

  // 2. Fall back to the compiled JavaScript output.
  try {
    const mod = await import(compiledPath);
    if (typeof mod.generateOpenApiSpec === 'function') {
      return mod.generateOpenApiSpec;
    }
  } catch {
    // Handled by the explicit error below.
  }

  throw new Error(
    'Unable to load `generateOpenApiSpec`. Ensure either `tsx` is ' +
      'installed (for TypeScript sources) or the server has been built ' +
      '(`npm run build`) so that `dist/schemas/openapi.js` exists.',
  );
}

async function main() {
  const generateOpenApiSpec = await loadGenerator();

  const spec = generateOpenApiSpec();

  if (spec === undefined || spec === null) {
    throw new Error(
      '`generateOpenApiSpec` returned an empty value; refusing to write ' +
        'an invalid OpenAPI document.',
    );
  }

  const json = `${JSON.stringify(spec, null, 2)}\n`;
  writeFileSync(outputPath, json, 'utf8');

  // eslint-disable-next-line no-console
  console.log(`Wrote OpenAPI spec to ${outputPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to generate OpenAPI spec:', error);
  process.exitCode = 1;
});
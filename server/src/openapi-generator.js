import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { V1_ROUTES } from "./routes/v1.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const BASE_SPEC_PATH = resolve(HERE, "../openapi.json");
export const GENERATED_SPEC_PATH = resolve(HERE, "../openapi.generated.json");

const METHOD_OPERATIONS = {
  GET: { tag: "read", response: "200", description: "Successful response" },
  POST: { tag: "write", response: "201", description: "Resource created or action accepted" },
  PATCH: { tag: "write", response: "200", description: "Resource updated" },
  DELETE: { tag: "write", response: "204", description: "Resource deleted" },
};

const ERROR_RESPONSES = {
  "400": { description: "Invalid request" },
  "401": { description: "Authentication required" },
  "403": { description: "Forbidden: caller is not authorized for this operation" },
  "404": { description: "Resource not found" },
  "429": { description: "Too many requests" },
  "500": { description: "Internal server error" },
};

const IDENTITY_DOCUMENT_SCHEMA = {
  type: "object",
  description: "Resolved DID document",
  properties: {
    id: { type: "string", description: "The DID this document describes" },
    controller: { type: "string" },
    verificationMethod: { type: "array", items: { type: "object" } },
    authentication: { type: "array", items: { type: "string" } },
    service: { type: "array", items: { type: "object" } },
    created: { type: "string", format: "date-time" },
    updated: { type: "string", format: "date-time" },
  },
  required: ["id"],
};

const ATTESTATION_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Attestation identifier" },
    issuer: { type: "string", description: "DID of the issuing account" },
    subject: { type: "string", description: "DID of the attested subject" },
    claim: { type: "string", description: "Attestation claim type" },
    data: { type: "object", additionalProperties: true },
    status: { type: "string", enum: ["active", "revoked"] },
    createdAt: { type: "string", format: "date-time" },
    revokedAt: { type: "string", format: "date-time", nullable: true },
  },
  required: ["id", "issuer", "subject", "status"],
};

const TX_RESULT_SCHEMA = {
  type: "object",
  properties: {
    hash: { type: "string", description: "Transaction hash" },
    status: { type: "string", enum: ["SUCCESS", "FAILED", "PENDING"] },
    ledger: { type: "integer", nullable: true },
    resultXdr: { type: "string", description: "Base64-encoded transaction result XDR" },
    error: { type: "string", nullable: true },
  },
  required: ["hash", "status"],
};

const SIGNED_XDR_BODY_SCHEMA = {
  type: "object",
  properties: {
    signedXdr: { type: "string", description: "Base64-encoded signed Soroban transaction XDR" },
  },
  required: ["signedXdr"],
};

const ATTESTATION_BODY_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "DID of the subject being attested" },
    claim: { type: "string", description: "Attestation claim type" },
    data: { type: "object", additionalProperties: true },
    signedXdr: {
      type: "string",
      description: "Optional pre-signed Soroban transaction XDR for the attestation",
    },
  },
  required: ["subject", "claim"],
};

const IDENTITY_ATTESTATIONS_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    did: { type: "string" },
    document: IDENTITY_DOCUMENT_SCHEMA,
    attestations: { type: "array", items: ATTESTATION_SCHEMA },
  },
  required: ["did", "document", "attestations"],
};

const EXPLICIT_OPERATIONS = {
  "GET /identity/{did}": {
    tag: "identity",
    summary: "Resolve DID document and attestations",
    description:
      "Returns the resolved DID document and the current attestation list from indexed data.",
    operationId: "getIdentity",
    security: [],
    parameters: [
      {
        name: "did",
        in: "path",
        required: true,
        schema: { type: "string" },
        description: "Decentralized identifier to resolve",
      },
    ],
    responses: {
      "200": {
        description: "Resolved DID document and attestations",
        content: {
          "application/json": { schema: IDENTITY_ATTESTATIONS_RESPONSE_SCHEMA },
        },
      },
      ...ERROR_RESPONSES,
    },
  },
  "POST /identity": {
    tag: "identity",
    summary: "Submit a signed identity transaction",
    description: "Accepts a signed XDR, submits it to Soroban and returns the transaction result.",
    operationId: "postIdentity",
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
    requestBody: {
      required: true,
      content: { "application/json": { schema: SIGNED_XDR_BODY_SCHEMA } },
    },
    responses: {
      "200": {
        description: "Transaction result",
        content: { "application/json": { schema: TX_RESULT_SCHEMA } },
      },
      ...ERROR_RESPONSES,
    },
  },
  "POST /attestation": {
    tag: "attestation",
    summary: "Submit a new attestation",
    description: "Issuer-authenticated endpoint that submits a new attestation on-chain.",
    operationId: "postAttestation",
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
    requestBody: {
      required: true,
      content: { "application/json": { schema: ATTESTATION_BODY_SCHEMA } },
    },
    responses: {
      "201": {
        description: "Attestation submitted",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                attestation: ATTESTATION_SCHEMA,
                transaction: TX_RESULT_SCHEMA,
              },
              required: ["attestation"],
            },
          },
        },
      },
      ...ERROR_RESPONSES,
    },
  },
  "DELETE /attestation/{id}": {
    tag: "attestation",
    summary: "Revoke an attestation",
    description:
      "Revokes an attestation. Only callable by the original issuer or the contract owner.",
    operationId: "deleteAttestation",
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
    parameters: [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
        description: "Attestation identifier to revoke",
      },
    ],
    responses: {
      "204": { description: "Attestation revoked" },
      ...ERROR_RESPONSES,
    },
  },
};

export function toOpenApiPath(path) {
  return String(path).replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export function collectPathParameters(path) {
  const names = String(path).match(/:([A-Za-z0-9_]+)/g) ?? [];
  return names.map((token) => {
    const name = token.slice(1);
    return {
      name,
      in: "path",
      required: true,
      schema: { type: "string" },
      description: `${name} identifier`,
    };
  });
}

export function tagForRoute(name, path) {
  const segment = String(path).split("/").filter(Boolean)[0] ?? "system";
  if (name.startsWith("cache")) return "system";
  if (segment === "admin") return "admin";
  if (segment === "credentials" || segment === "batch") return "credentials";
  if (segment === "webhooks") return "webhooks";
  return segment;
}

export function humanizeRouteName(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

export function generateOpenApiSpec(baseSpec, routes = V1_ROUTES) {
  const spec = structuredClone(baseSpec);
  spec.paths = spec.paths ?? {};
  spec.components = spec.components ?? {};
  spec.components.securitySchemes = spec.components.securitySchemes ?? {};
  spec.tags = Array.isArray(spec.tags) ? [...spec.tags] : [];

  const addedTags = new Set(spec.tags.map((tag) => tag.name));
  const generated = [];

  for (const [name, descriptor] of Object.entries(routes)) {
    if (!descriptor?.method || !descriptor?.path) continue;
    const method = String(descriptor.method).toLowerCase();
    const path = toOpenApiPath(descriptor.path);
    const operation = METHOD_OPERATIONS[descriptor.method];
    if (!operation) continue;

    spec.paths[path] = spec.paths[path] ?? {};
    if (spec.paths[path][method]) continue;

    const tag = tagForRoute(name, descriptor.path);
    if (!addedTags.has(tag)) {
      spec.tags.push({ name: tag, description: `${tag} endpoints` });
      addedTags.add(tag);
    }

    const parameters = collectPathParameters(descriptor.path);
    spec.paths[path][method] = {
      tags: [tag],
      summary: humanizeRouteName(name),
      description: `Generated from the ${name} route descriptor.`,
      operationId: name,
      ...(descriptor.read ? {} : { security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }] }),
      ...(parameters.length ? { parameters } : {}),
      responses: {
        [operation.response]: { description: operation.description },
        "400": { description: "Invalid request" },
        "401": { description: "Authentication required" },
        "500": { description: "Internal server error" },
      },
    };
    generated.push({ name, method, path });
  }

  for (const [key, definition] of Object.entries(EXPLICIT_OPERATIONS)) {
    const [method, path] = key.split(" ");
    const lowerMethod = method.toLowerCase();
    spec.paths[path] = spec.paths[path] ?? {};
    if (spec.paths[path][lowerMethod]) continue;

    if (!addedTags.has(definition.tag)) {
      spec.tags.push({ name: definition.tag, description: `${definition.tag} endpoints` });
      addedTags.add(definition.tag);
    }

    const { tag, ...rest } = definition;
    spec.paths[path][lowerMethod] = { tags: [tag], ...rest };
    generated.push({ name: definition.operationId, method: lowerMethod, path });
  }

  spec["x-generated-routes"] = generated;
  spec["x-generator"] = "server/src/openapi-generator.js";
  return spec;
}

export async function buildGeneratedSpec() {
  const baseSpec = JSON.parse(await readFile(BASE_SPEC_PATH, "utf8"));
  return generateOpenApiSpec(baseSpec);
}

export async function writeGeneratedSpec() {
  const spec = await buildGeneratedSpec();
  await writeFile(GENERATED_SPEC_PATH, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  return spec;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const spec = await writeGeneratedSpec();
  process.stdout.write(
    `Generated ${GENERATED_SPEC_PATH} with ${Object.keys(spec.paths).length} paths\n`,
  );
}

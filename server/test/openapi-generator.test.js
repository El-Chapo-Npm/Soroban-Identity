import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateOpenApiSpec,
  toOpenApiPath,
  collectPathParameters,
  humanizeRouteName,
} from "../src/openapi-generator.js";
import { V1_ROUTES } from "../src/routes/v1.js";

const baseSpec = () => ({
  openapi: "3.0.3",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/health": {
      get: { operationId: "health", responses: { 200: { description: "ok" } } },
    },
  },
  tags: [{ name: "system", description: "System endpoints" }],
});

test("toOpenApiPath converts express style parameters", () => {
  assert.equal(toOpenApiPath("/credentials/:id/revoke"), "/credentials/{id}/revoke");
});

test("collectPathParameters extracts every path placeholder", () => {
  const params = collectPathParameters("/admin/tenants/:id/members/:memberId");
  assert.deepEqual(
    params.map((parameter) => parameter.name),
    ["id", "memberId"],
  );
  assert.ok(params.every((parameter) => parameter.in === "path" && parameter.required));
});

test("humanizeRouteName produces readable summaries", () => {
  assert.equal(humanizeRouteName("listCredentials"), "List Credentials");
});

test("generator adds operations from route descriptors without dropping existing paths", () => {
  const spec = generateOpenApiSpec(baseSpec());

  assert.ok(spec.paths["/health"].get);
  assert.equal(spec.paths["/credentials"].get.operationId, "listCredentials");
  assert.equal(spec.paths["/credentials/{id}"].get.operationId, "getCredential");
  assert.equal(spec.paths["/credentials/{id}/revoke"].post.operationId, "revokeCredential");
  assert.deepEqual(spec.paths["/admin/tenants/{id}"].patch.parameters[0].name, "id");
});

test("generator never overwrites hand-written operations", () => {
  const spec = generateOpenApiSpec(baseSpec(), {
    health: { method: "GET", path: "/health" },
  });
  assert.equal(spec.paths["/health"].get.responses[200].description, "ok");
  assert.equal(spec.paths["/health"].get.operationId, "health");
});

test("generator records every generated route for traceability", () => {
  const spec = generateOpenApiSpec(baseSpec());
  assert.ok(Array.isArray(spec["x-generated-routes"]));
  assert.ok(spec["x-generated-routes"].length > 0);
  assert.ok(spec["x-generated-routes"].some((route) => route.name === "listCredentials"));
  assert.ok(Object.keys(V1_ROUTES).length > spec["x-generated-routes"].length);
});

test("generator marks write operations as authenticated", () => {
  const spec = generateOpenApiSpec(baseSpec());
  assert.ok(spec.paths["/credentials"].post.security);
  assert.ok(!spec.paths["/credentials"].get.security);
});

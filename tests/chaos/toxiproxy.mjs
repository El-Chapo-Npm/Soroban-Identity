// Thin Toxiproxy HTTP API client.
const API = process.env.TOXIPROXY_URL ?? "http://localhost:8474";

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404 && res.status !== 409) {
    throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json().catch(() => null);
}

export const proxies = {
  api: { listen: "0.0.0.0:3002", upstream: "api:3001" },
  redis: { listen: "0.0.0.0:6380", upstream: "redis:6379" },
  rpc: { listen: "0.0.0.0:8001", upstream: "rpc-mock:8000" },
};

export async function setup() {
  for (const [name, cfg] of Object.entries(proxies)) {
    await call("POST", "/proxies", { name, ...cfg, enabled: true });
  }
}

export const reset = () => call("POST", "/reset");
export const addToxic = (proxy, toxic) => call("POST", `/proxies/${proxy}/toxics`, toxic);
export const setEnabled = (proxy, enabled) => call("POST", `/proxies/${proxy}`, { enabled });

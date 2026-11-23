import { addToxic } from "../toxiproxy.mjs";

export default {
  name: "RPC endpoint high latency (2s)",
  target: "RPC endpoint",
  async inject({ probe }) {
    await addToxic("rpc", { name: "latency", type: "latency", stream: "downstream", attributes: { latency: 2000, jitter: 500 } });
    return probe(8000);
  },
  // API health must stay up; RPC-dependent latency may degrade but not error out.
  verify: ({ during, recoveryMs }) => ({
    pass: during.successRate >= 0.95 && recoveryMs < 10000,
    reason: `success=${(during.successRate * 100).toFixed(1)}% p95=${during.p95.toFixed(0)}ms recovery=${recoveryMs}ms`,
  }),
};

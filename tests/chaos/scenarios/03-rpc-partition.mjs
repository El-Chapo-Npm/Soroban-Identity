import { setEnabled } from "../toxiproxy.mjs";

export default {
  name: "RPC endpoint network partition",
  target: "RPC endpoint",
  async inject({ probe }) {
    await setEnabled("rpc", false);
    return probe(8000);
  },
  restore: () => setEnabled("rpc", true),
  // Liveness endpoint must stay reachable (no crash); dependent calls may return 503.
  verify: ({ during, recoveryMs }) => ({
    pass: during.requests > 0 && !during.statuses.includes(0) && recoveryMs < 15000,
    reason: `statuses=${during.statuses} recovery=${recoveryMs}ms`,
  }),
};

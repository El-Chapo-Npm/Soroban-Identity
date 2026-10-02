import { setEnabled } from "../toxiproxy.mjs";

export default {
  name: "Redis cache network partition",
  target: "Redis cache",
  async inject({ probe }) {
    await setEnabled("redis", false);
    return probe(8000);
  },
  restore: () => setEnabled("redis", true),
  // Cache is optional: API should fall through to origin with no 5xx.
  verify: ({ during, recoveryMs }) => ({
    pass: during.successRate >= 0.99 && recoveryMs < 15000,
    reason: `success=${(during.successRate * 100).toFixed(1)}% statuses=${during.statuses} recovery=${recoveryMs}ms`,
  }),
};

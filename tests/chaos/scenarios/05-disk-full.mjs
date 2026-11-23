import { execSync } from "node:child_process";

const compose = "docker compose -f docker-compose.chaos.yml";
const cwd = new URL("..", import.meta.url).pathname;

export default {
  name: "Disk full (/tmp tmpfs exhausted)",
  target: "API server",
  async inject({ probe }) {
    execSync(`${compose} exec -T api sh -c "dd if=/dev/zero of=/tmp/fill bs=1M count=64 || true"`, { cwd });
    return probe(5000);
  },
  restore: () => execSync(`${compose} exec -T api rm -f /tmp/fill`, { cwd }),
  verify: ({ during, recoveryMs }) => ({
    pass: during.successRate >= 0.95 && recoveryMs < 10000,
    reason: `success=${(during.successRate * 100).toFixed(1)}% recovery=${recoveryMs}ms`,
  }),
};

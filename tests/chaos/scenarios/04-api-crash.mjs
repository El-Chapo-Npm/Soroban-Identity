import { execSync } from "node:child_process";

const compose = "docker compose -f docker-compose.chaos.yml";
const cwd = new URL("..", import.meta.url).pathname;

export default {
  name: "API server crash",
  target: "API server",
  async inject({ probe }) {
    execSync(`${compose} kill -s SIGKILL api`, { cwd });
    const during = await probe(2000);
    execSync(`${compose} up -d api`, { cwd });
    return during;
  },
  // Service must be restarted and healthy within 30s.
  verify: ({ recoveryMs }) => ({
    pass: recoveryMs < 30000,
    reason: `recovery=${recoveryMs}ms`,
  }),
};

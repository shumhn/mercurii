import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const backend = join(root, "backend");
const frontend = join(root, "frontend");
const children = [];
let stopping = false;

function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.pid) {
      try { process.kill(-child.pid, signal); } catch { /* Already stopped. */ }
    }
  }
}

function start(name, args, cwd) {
  const child = spawn(process.execPath, args, { cwd, env: process.env,
    stdio: "inherit", detached: true });
  children.push(child);
  child.on("error", (error) => {
    process.stderr.write(`${name} could not start: ${error.message}\n`);
    process.exitCode = 1;
    stop();
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    process.stderr.write(`${name} stopped (${signal ?? code}). Stopping the workspace.\n`);
    process.exitCode = code === 0 ? 0 : 1;
    stop();
  });
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const backendArgs = [
  ...(existsSync(join(backend, ".env.local")) ? ["--env-file=.env.local"] : []),
  "--experimental-strip-types", "src/server.ts",
];
start("Mercurii API", backendArgs, backend);
const webPort = process.env.MERCURII_WEB_PORT ?? "3000";
start("Next.js", [join(frontend, "node_modules/next/dist/bin/next"),
  "dev", "--webpack", "-p", webPort], frontend);

process.stdout.write(`Mercurii workspace: http://localhost:${webPort} (app: /app)\n`);

import assert from "node:assert/strict";
import { test } from "node:test";
import { AgentRateLimitError, enforceAgentRateLimit } from "../src/agent-rate-limit.ts";

test("agent limits signed wallet requests before model use", () => {
  const company = "rate-limit-company";
  const actor = "rate-limit-actor";
  for (let index = 0; index < 5; index++) enforceAgentRateLimit(company, actor, 0);
  assert.throws(() => enforceAgentRateLimit(company, actor, 5_000), AgentRateLimitError);
  enforceAgentRateLimit(company, "another-actor", 5_000);
  enforceAgentRateLimit(company, actor, 60_000);
  for (let index = 1; index < 5; index++) {
    enforceAgentRateLimit(company, actor, 60_000 + index * 1_000);
  }
  assert.throws(() => enforceAgentRateLimit(company, actor, 65_000), AgentRateLimitError);
  enforceAgentRateLimit(company, actor, 3_600_000);
});

test("agent hourly cap survives spacing out requests", () => {
  for (let index = 0; index < 30; index++) {
    enforceAgentRateLimit("hourly-company", "hourly-actor", index * 61_000);
  }
  assert.throws(() => enforceAgentRateLimit("hourly-company", "hourly-actor", 30 * 61_000),
    AgentRateLimitError);
  enforceAgentRateLimit("hourly-company", "hourly-actor", 3_600_000);
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const calls = new Map<string, number[]>();

export class AgentRateLimitError extends Error {
  constructor() { super("Agent request limit reached; wait before trying again"); }
}

// Count signed requests before any model call. This is scoped to one backend process.
export function enforceAgentRateLimit(company: string, actor: string,
  now = Date.now()): void {
  const key = `${company}:${actor}`;
  const recent = (calls.get(key) ?? []).filter((time) => now - time < HOUR);
  if (recent.length >= 30 || recent.filter((time) => now - time < MINUTE).length >= 5) {
    calls.set(key, recent);
    throw new AgentRateLimitError();
  }
  recent.push(now);
  calls.set(key, recent);
  if (calls.size > 10_000) {
    for (const [entry, times] of calls) {
      if (times.every((time) => now - time >= HOUR)) calls.delete(entry);
    }
  }
}

# Mercurii Next.js application boundary

The repository contains a Next.js web app, a Mercury HTTP API, a Solana program, and encrypted Supabase records. Browser requests already use one origin through `/api/mercurii/*`. The API process currently runs separately; `npm run dev` at the repository root starts both local processes together.

## Why the API is still a process

- Payment, onboarding, payroll, invoice, audit, x402, and agent records have a mix of encrypted Supabase repositories and local journal/cache paths. The latter cannot be relied on across hosted Next.js function instances.
- Guided payment recovery depends on receipt reconciliation and an operator watcher. A request handler's lifetime is bounded and cannot serve as that watcher.
- The API uses Node HTTP request/response objects and loads the program IDL from disk. Moving its route file into `app/api` would require an adapter or route refactor plus deployment packaging and replay tests.
- Mobile clients can call the same authenticated HTTP API. They do not need the web UI to be online for private payment status.

## Consolidation checklist

- [x] Browser reaches the API through a same-origin Next.js route.
- [x] One repository command starts the local UI and API.
- [ ] Replace every money-affecting local journal with an encrypted, atomic database repository; remove request-time cache hydration as an authority source.
- [ ] Move receipt reconciliation to a durable scheduled worker or explicit idempotent job endpoint.
- [ ] Extract the Node HTTP handler into framework-independent request logic, then mount it in Next.js Route Handlers with the Node runtime.
- [ ] Package the Mercury IDL and server-only secrets for the hosting environment; verify no secret enters client bundles.
- [ ] Replay all wallet, PER, DB, and transaction recovery flows against the hosted route before removing the standalone API.

The first two boxes improve local use. They do not prove that a Vercel deployment can execute payment flows. Until the unchecked items pass, deploy the Mercury API as a persistent service and set `MERCURII_BACKEND_URL` for the Next.js deployment.

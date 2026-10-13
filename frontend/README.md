# Mercurii frontend

This Next.js 16 app contains the public landing page (`/`) and the wallet-connected company workspace (`/app`). It calls the separate Mercury API through a same-origin gateway at `/api/mercurii/*`. The API URL defaults to `http://127.0.0.1:8787` in local development; a hosted frontend needs `MERCURII_BACKEND_URL`.

For the product story, Founder walkthrough, MagicBlock architecture, devnet proofs, and complete local setup, read the [repository README](../README.md).

From the repository root, `npm run dev` starts both the frontend on port `3000` and the backend on port `8787`. To run only the frontend after `npm ci --prefix frontend`:

```bash
cd frontend
npm run dev
```

A frontend by itself can render the landing page, but company registration, wallet login, private reads, and payment workflows require the API and its configured devnet dependencies. Run `npm run build` and `npm test` from this directory for local code checks.

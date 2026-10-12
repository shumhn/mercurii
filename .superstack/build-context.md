# Mercurii build context

```yaml
review:
  security_score: B
  quality_score: B
  ready_for_mainnet: false
  findings:
    - severity: high
      category: correctness
      description: Core receive, payment execution, Finance Agent, x402, and recipient withdrawal capabilities are disabled in the current runtime.
      fix: Revalidate the configured devnet mint and PER validator, enable one feature flag at a time, and replay the exact wallet-signed browser flow before presenting it as live.
    - severity: high
      category: testing
      description: Founder, Finance, Manager, Requester, Viewer, Agent, and recipient browser sessions were not replayed in the current audit.
      fix: Run and record a role matrix with allowed navigation, denied reads, one valid action, account-change handling, and session expiry for each role.
    - severity: medium
      category: testing
      description: Frontend automated coverage contains only two number-formatting tests.
      fix: Add interaction tests for navigation gates, role filtering, session clearing, payment lifecycle state, and signed receipt retry protections.
    - severity: medium
      category: durability
      description: Audit shares and x402 purchases still use local-first dedicated journals even though encrypted mirrors exist.
      fix: Add database-primary repositories with optimistic concurrency and recovery tests before hosted production use.
    - severity: medium
      category: security
      description: The custody program has not completed an external audit or fuzz campaign.
      fix: Add property/fuzz coverage for authorization, one-shot payment state, arithmetic conservation, and CPI account binding, then commission an external audit before mainnet funds.
    - severity: low
      category: organization
      description: An unused mock workspace component remains beside the connected application.
      fix: Remove or archive frontend/components/app/mercurii-workspace.tsx after confirming it is no longer used as a design reference.
    - severity: low
      category: tooling
      description: Contract tests pass with two unexpected cfg warnings from the Anchor/Solana macro toolchain.
      fix: Align the pinned toolchain or explicitly document and gate the accepted warning in CI.
```

The detailed per-feature evidence is in `docs/FULL_STACK_FUNCTIONALITY_MATRIX.md`.

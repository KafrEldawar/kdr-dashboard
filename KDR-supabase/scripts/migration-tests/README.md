# Migration tests

Behavioural tests for migrations, run against [PGlite](https://pglite.dev)
(real Postgres compiled to WASM, in memory). Nothing touches the live project.

Each `NNN_stub_schema.sql` is a **minimal** copy of the live schema: only the
tables, columns and helper functions the migration under test touches. It is
not a schema dump; keep it small and in step with the migration.

```bash
cd KDR-supabase/scripts/migration-tests
npm install
npm run test:081
```

`081_test.mjs` covers: the service-role-only auth lookup, the dropped RLS
policies, the profile privileged-column guard, `rpc_update_profile`'s phone
rule, every new `rpc_checkout` refusal, pickup branches, totals/commission,
voucher locking, the voucher refund trigger, one-use-per-customer vouchers,
and an idempotent re-run.

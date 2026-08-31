# Environment setup checklist (UAT / production)

Everything here applies to **any** environment running with `NODE_ENV=production`
— which is the Dockerfile default, so it includes UAT, not just a hypothetical
"real" production. `NODE_ENV` cannot currently distinguish UAT from production;
they are configured identically. If UAT ever needs to behave differently from
production, that needs its own variable (e.g. `DEPLOY_ENV=uat|production`) — do
not repurpose `NODE_ENV` for that, since `ComplianceOrganizationSeed` and
anything else gated on it assumes `production` means "a real, shared
environment, never seed fixture data."

This list exists because a first deploy to a shared environment (2026-08) hit
every item below in production, one at a time, over the course of a single
debugging session. See git log around commit `041c7b0` for the full story.

## 1. Confirm the dev-seed fixture was never created (or clean it up)

`ComplianceOrganizationSeed.runIfEmpty()` used to unconditionally create a
"Dev merchant" tenant (`sync2booksCompanyId: 'merchant-1'`) with a placeholder
SANDBOX eTIMS connection (`kraPin: 'P1234567890'`, `cmcKey: 'cmc-key-stub'`) on
every boot if no tenant existed yet. As of `041c7b0` it's gated on
`NODE_ENV !== 'production'`, so a fresh environment stood up after that commit
won't get it. But:

- **If this environment's database was cloned/restored from a snapshot taken
  before `041c7b0`**, the fixture row may already be there. Check:

  ```sql
  SELECT id, kraPin, cmcKey, environment, status
  FROM compliance_etims_connections
  WHERE kraPin = 'P1234567890' AND cmcKey = 'cmc-key-stub';
  ```

  If it returns a row with `status = 'ACTIVE'`, either delete it (fresh
  environment, definitely shouldn't be there) or suspend it:

  ```sql
  UPDATE compliance_etims_connections
  SET status = 'SUSPENDED'
  WHERE kraPin = 'P1234567890' AND cmcKey = 'cmc-key-stub';
  ```

  Leaving it ACTIVE means `MainApiConnectionApplicationService.findAnyConnected()`
  can pick it as "the" SANDBOX connection for the OSCU reference-data sync
  (`CatalogService.syncReferenceDataFromOscu`, cron + `POST
  catalog/reference-data/sync-now`) ahead of any real connection, and KRA
  rejects the fake PIN with `"The tin you provided does not meet the required
  tin format"` — a confusing error that has nothing to do with PIN formatting.

## 2. `COMPLIANCE_SERVICE_TOKEN` must be a real generated secret

`ComplianceServiceAuthGuard` (guards `CatalogController` and other
service-to-service routes) **fails open** — if `COMPLIANCE_SERVICE_TOKEN` is
unset, every request is allowed through with no auth check at all. If it's
set to something guessable (a literal string like `caprover-service-token`
rather than a generated random value), it's barely better than unset. Set it
to a real random secret in whatever secret store backs this deploy (CapRover
app env vars, etc.) before this environment handles anything sensitive.

Every request through this guard also requires a non-empty
`x-sync2books-company-id` header alongside the bearer token — for routes that
don't otherwise need a company id (like `reference-data/sync-now`), any
non-empty value satisfies it; the guard doesn't validate it against anything.

## 3. `ETIMS_SANDBOX_SHARED_KRA_PIN` and friends

New SANDBOX businesses created with no explicit `kraPin` (the normal
dashboard "Add a business" flow) get auto-wired to one shared credential set
read from `ETIMS_SANDBOX_SHARED_KRA_PIN` / `_DVC_SRL_NO` / `_DEVICE_ID` /
`_CMC_KEY` — see `getSharedSandboxEtimsCredentials()` in
`compliance-organization.application.service.ts`. This is meant to be a real,
currently-live KRA sandbox Application Test Pin.

- KRA's sandbox Application Test Pins are session/time-bound and do expire —
  the `etims-golive-testing` skill documents this pattern and how to refresh
  credentials. If OSCU calls start failing with "tin format" or similar
  rejections and item 1 above is ruled out, check whether the pin behind
  these env vars is still the one currently shown on developer.go.ke.

## 4. A brand-new environment won't sync reference data until *something* is connected

`findAnyConnected()` needs at least one ACTIVE eTIMS connection per
environment (SANDBOX / PRODUCTION) to authenticate the OSCU reference-data
pull — it's environment-wide, not merchant-scoped, but it still needs *some*
real connection to exist. On a genuinely fresh environment with zero
businesses onboarded yet, `POST catalog/reference-data/sync-now` will
correctly report `{"environment": "...", "skipped": true}` for any
environment with nothing connected — that's expected, not a bug, until the
first real business finishes eTIMS setup there.

# Slade360 support ticket draft

Drafted 2026-08-23 after an end-to-end test of the eTIMS API against Slade360's dev
environment, using OAuth client ID `ceva-be` (not a business name — Slade360 issued this
credential to us, so they know what organisation it's tied to; we don't). Updated
2026-09-01 after re-running the same test — the original 401 is gone, but the underlying
org-association problem hasn't actually been fixed, it's just surfacing differently, and
now only on one endpoint rather than every endpoint. Copy the block below into an email or
their support portal — just fill in your name at the sign-off. See
`sync2books-compliance-api/src/regulatory/oscu/adapters/etims-adapter.slade360.ts` for the
adapter this was tested against, and the "eTIMS Provider Swap" architecture plan for full
context on why Slade360 is being integrated.

---

Subject: eTIMS API integration blocked — OAuth client ID `ceva-be` gets a 500 AttributeError on `fetch_etims_organisation_branches`

Hi Slade360 team,

You provided us with an OAuth client_credentials pair (client ID `ceva-be`) for eTIMS API
integration on your dev environment. Token exchange with it succeeds, and most endpoints we've
tested now process requests normally (see "What works" below) — but the branches endpoint
still fails, and the failure mode points at the same root cause we flagged before: this
service account still isn't fully associated with a business/organisation on your side.

**OAuth client details**
- OAuth Client ID: `ceva-be`
- Service account subject (`sub`): `97d4eb22-eed3-43d0-aaba-a8708de0b1d7`
- Environment: dev (`identity-dev.slade360edi.com` / `api-dev.slade360edi.com/erp`)

**What works**
- `POST https://identity-dev.slade360edi.com/realms/slade360/protocol/openid-connect/token`
  with `grant_type=client_credentials` — succeeds, returns a valid bearer token every time.
- `POST /erp/api/products/products/` (item/product creation) — no longer 401s. It reaches
  real request validation and returns ordinary `400` field-level errors (invalid choice /
  UUID / foreign-key values in our test payload — that's on us to fix on our side, not
  something we're asking you about here). This tells us `ceva-be` *is* authorized to act on
  this endpoint.

**What fails**
`GET /erp/api/branches/branches/fetch_etims_organisation_branches/` (and, transitively,
anything that calls it, e.g. our go-live/device-init check) now returns:
```
HTTP 500
AttributeError at /api/branches/branches/fetch_etims_organisation_branches/
'SILServiceAccount' object has no attribute 'organisation'
```
with a full Django debug traceback in the response body (also worth flagging separately —
a dev environment returning `DEBUG=True` tracebacks to API callers exposes internal paths,
installed apps, and versions).

Retested 2026-09-01T16:47Z — consistent, fast (~1-2s), reproducible every time.

**Why we think this is the same underlying issue as before**
Previously this endpoint returned a clean `401 {"detail":"Your credentials aren't allowed"}`
rather than a 500. The error changed, but the shape is the same: it's specifically the
*organisation-scoped* endpoint that fails for `ceva-be`, while an endpoint that doesn't need
an organisation lookup (`products`) now works. The `AttributeError` — a service account
object with no `organisation` attribute set — looks like a direct confirmation that
`ceva-be` still has no business/organisation association, just hitting an unhandled code
path now instead of a permission check.

**What we need**
1. Please confirm which business/organisation `ceva-be` was created under (if any).
2. Please associate it with the correct branch(es) so `fetch_etims_organisation_branches`
   succeeds — or, if there's a self-serve step we're expected to complete ourselves (e.g.
   your onboarding wizard), let us know and we'll take it from there.
3. Separately: an unhandled `AttributeError` returning HTTP 500 with a full debug traceback
   (rather than a clean 4xx) seems like a bug on your end regardless of the org-association
   fix — worth a look even after `ceva-be` is sorted.

**One more open question**
Your docs mention an `X-Workstation` header required on every call (described as "the
workstation ID of the user"), but we haven't found where a workstation ID actually comes
from — no endpoint to create, register, or list one. Could you point us to how that's
provisioned? We haven't been able to confirm whether it's actually enforced yet, since our
calls to organisation-scoped endpoints are being rejected earlier (on the account/organisation
association above) before we could tell — though it's evidently not required on `products`,
since that endpoint works without one.

Thanks,
**[your name]**

---

Notes for whoever sends this (not part of the message itself):
- One placeholder left to fill in: your name at the sign-off.
- Business name and KRA PIN are deliberately *not* asserted in this message — Slade360
  issued `ceva-be`, so they're the ones who know what organisation it's tied to, not us.
  If their reply names an organisation that doesn't match yours, that's worth flagging back
  to them rather than assuming it's correct.
- Deliberately no `client_secret` in this message — not needed for this ask, and shouldn't
  go in an email/ticket regardless.
- Worth trying Slade360's self-serve onboarding wizard in parallel
  (`dev.advantage.slade360.com/auth/welcome`) — might resolve this faster than waiting on a
  support queue, though it may create a *separate* business/org rather than fixing `ceva-be`'s
  association, so check with support before assuming that path is the right one here.
- The `saveItem` 400 errors (invalid `product_type`/UUID fields) are a separate, real gap in
  our own adapter — `mapItemToSlade360Product` in `etims-adapter.slade360.ts` sends OSCU's
  plain codes (`taxTyCd`, `qtyUnitCd`, `pkgUnitCd`, `itemClsCd`) straight through, but
  Slade360's `products` endpoint expects those as UUID foreign keys into their own tax/
  classification/unit-of-measure tables. There's no code→UUID lookup built yet. Not part of
  this ticket — tracked as follow-up implementation work, not a Slade360-side issue.

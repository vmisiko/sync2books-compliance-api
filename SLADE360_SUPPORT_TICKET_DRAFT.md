# Slade360 support ticket draft

Drafted 2026-08-23 after an end-to-end test of the eTIMS API against Slade360's dev
environment, using OAuth client ID `ceva-be` (not a business name — Slade360 issued this
credential to us, so they know what organisation it's tied to; we don't). Copy the block
below into an email or their support portal — just fill in your name at the sign-off. See
`sync2books-compliance-api/src/regulatory/oscu/adapters/etims-adapter.slade360.ts` for the
adapter this was tested against, and the "eTIMS Provider Swap" architecture plan for full
context on why Slade360 is being integrated.

---

Subject: eTIMS API integration blocked — OAuth client ID `ceva-be` returns 401 "Your credentials aren't allowed" on every authenticated call

Hi Slade360 team,

You provided us with an OAuth client_credentials pair (client ID `ceva-be`) for eTIMS API
integration on your dev environment. Token exchange with it succeeds, but every
authenticated API call is rejected. We don't have visibility into which
business/organisation `ceva-be` was created under on your side — could you confirm that,
and complete or verify its association with a business/organisation and branch(es) so
authenticated calls succeed?

**OAuth client details**
- OAuth Client ID: `ceva-be`
- Service account subject (`sub`): `97d4eb22-eed3-43d0-aaba-a8708de0b1d7`
- Environment: dev (`identity-dev.slade360edi.com` / `api-dev.slade360edi.com/erp`)

**What works**
- `POST https://identity-dev.slade360edi.com/realms/slade360/protocol/openid-connect/token`
  with `grant_type=client_credentials` — succeeds, returns a valid bearer token every time.

**What fails**
Every subsequent authenticated call against `api-dev.slade360edi.com/erp` returns:
```
HTTP 401
{"detail":"Your credentials aren't allowed"}
```
Confirmed on multiple endpoints, e.g.:
- `GET /erp/api/branches/branches/fetch_etims_organisation_branches/`
- `GET /erp/api/products/products/`

Both return the identical 401 within ~1-2 seconds (fast, consistent — not a timeout or a
routing issue), tested 2026-08-23T20:59Z.

**What we found when we decoded the token**
The token's `group` claim is `["/Default Group"]` — it doesn't appear to be associated
with any specific business/organisation, which we suspect is why every organisation-scoped
call is rejected.

**What we need**
1. Please confirm which business/organisation `ceva-be` was created under.
2. Please associate it with the correct branch(es) so authenticated calls succeed — or, if
   there's a self-serve step we're expected to complete ourselves (e.g. your onboarding
   wizard), let us know and we'll take it from there.

**One more open question**
Your docs mention an `X-Workstation` header required on every call (described as "the
workstation ID of the user"), but we haven't found where a workstation ID actually comes
from — no endpoint to create, register, or list one. Could you point us to how that's
provisioned? We haven't been able to confirm whether it's actually enforced yet, since our
calls are being rejected earlier (on the account/organisation association above) before we
could tell.

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

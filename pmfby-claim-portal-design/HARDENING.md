# Draft-intimation demo: operations and QA

This app prepares a **draft**, not an insurer submission or an official receipt.
No automated test proves PMFBY eligibility or Devanagari shaping in a phone viewer.

## Run and configure

Use `npm install`, `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`
from this application directory. The npm lockfile was updated during hardening.
The lint setup is intentionally minimal (explicit `any`, TS suppression comments,
and debugger statements); it is not a comprehensive accessibility/React ruleset.

Copy `.env.example` to `.env.local` **only if no local file already exists**.
Set `GEMINI_API_KEY` privately, server-side, and `GEMINI_MODEL=gemini-3.6-flash`
or another verified audio/image/structured-output model available to your account.
The default was verified against Google's stable-model documentation:
https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash
Do not use a `NEXT_PUBLIC_` prefix for credentials.

Optional server-only `FALLBACK_LAT` / `FALLBACK_LNG` enable an explicitly approximate
fallback; absent configuration means location unavailable, not invented coordinates.
Timezone-less EXIF/entered incident dates are interpreted as IST. Camera clocks and
EXIF can be wrong or edited; they do not establish incident time or timely filing.

Edit `FILING_CONTACT_TODO` in `lib/types.ts` to a verified insurer/helpline number.
Until configured, the header links to the official PMFBY portal rather than displaying
an unverified number. Verify the actual filing process with the insurer before rollout.

## Secret response required from the operator

1. Rotate/revoke any real key ever committed using its provider's console.
2. Update the private local/deployment environment and redeploy.
3. `.env.local` was removed from Git's index but retained locally. Review and commit
   this staged removal with the other changes. Ignore rules now protect it.
4. Optional history purge, after coordinating with every collaborator: in a fresh
   mirror clone, run `git filter-repo --path pmfby-claim-portal-design/.env.local
   --invert-paths`, then force-push rewritten branches/tags to the intended remote.
   filter-repo may remove the origin remote; re-add the verified URL first if needed.
   Collaborators must re-clone; inspect forks, PR refs, CI artifacts and deployment
   logs separately. Purging history never replaces key rotation. BFG is an alternative.

## Upload and privacy limits

- Only the **first photo** is analyzed/embedded; keep all original photos for filing.
- Audio plus that photo must be under 4,000,000 bytes; the server bounds the complete
  multipart body at 4,200,000 bytes. This leaves headroom below Vercel's ~4.5 MB cap.
  Vercel can still reject a request before app code; the UI handles non-JSON errors.
- Recording stops at 60 seconds. A rejected/failed request retains session inputs.
  Refreshing or closing the page loses them; there is no persistent/offline draft store.
- Media is sent to Google Gemini only on the explicit Prepare draft action. Review
  provider retention/consent terms before real farmer data is used.
- HEIC may be analyzed/read for EXIF but phone preview/PDF image decoding is not
  universal. PDF warns and omits an image it cannot decode; keep the original.
- No public-service abuse protection, durable rate limiting or authentication has
  been added. Protect access and provider quotas before exposing this demo publicly.

## Manual QA: Android Chrome and iPhone Safari

- Deny microphone permission, retry; rapidly tap; navigate away during permission.
  Ensure no remaining microphone indicator/tracks and auto-stop at 60 seconds.
- Upload a screenshot, a WhatsApp-compressed photo, a corrupt photo and HEIC.
  Verify missing EXIF never blocks analysis and no fabricated verified location appears.
- Deny/grant device location; verify EXIF > device > labeled fallback/unavailable.
- Enable airplane mode mid-request. Check visible retry, preserved inputs, no duplicate
  request, and no assertion that an insurer received anything.
- Test initially empty voices, no Hindi voice, rapid listen/stop, long summaries,
  backgrounding and browser playback denial. No automatic status speech; no delayed
  speech after stopping; blocked playback offers a manual action.
- Read/open the downloaded PDF: exactly one A4 page, intact conjuncts/matras, bounded
  long text, matching printed/QR ID, correct location provenance and draft-only status.
- Block font/QR loading and verify usable English-only/no-QR download with warnings.
- Verify keyboard focus, screen-reader notices, low-memory phones and slow networks.
- With a valid configured key, verify real model availability, 429/503 handling, audio
  transcription, selected languages, and the quality of damage estimates. Mock tests
  do not prove a live Gemini request or an insurance submission.
# KisanSahay: PMFBY 72-Hour Fast-Track Claim Portal

An AI-assisted web app that helps Indian tenant farmers prepare a **draft crop-loss intimation** within the 72-hour window required under the Pradhan Mantri Fasal Bima Yojana (PMFBY). A farmer speaks in their own language, uploads a field photo, and gets a structured draft with a Hindi voice readback and a one-page printable claim slip.

> **Important:** This app prepares a **draft only**. It does **not** submit anything to an insurer. The farmer must still report the loss through official channels (see [Filing the claim](#filing-the-claim)).

Built as a hackathon project.

---

## Features

- **Voice note in the farmer's language.** In-browser recording with automatic MIME negotiation (WebM on Chrome, MP4 on Safari), a 60-second cap with countdown, and clear microphone-permission handling.
- **Field photo upload.** The first photo is analyzed and embedded in the slip. Additional photos stay in the session.
- **AI analysis (Google Gemini).** Transcribes the voice note, translates it to English, identifies the crop, estimates visible damage percentage and likely cause, and writes short Hindi and English summaries.
- **Location and time from the photo (EXIF).** GPS and capture time are read from the image when present. Every location is labeled by source: photo metadata, device location, or approximate / not verified.
- **72-hour awareness.** Warns when the photo timestamp is missing, unparseable, or outside the 72-hour window.
- **Hindi voice readback.** Uses the browser's Web Speech API (`hi-IN`, with fallbacks), chunked by sentence, with manual playback controls.
- **Claim slip PDF.** One-page A4 slip with an embedded Devanagari font, a matching reference ID printed and in the QR code, location provenance, summaries, and a clear "Draft, not yet submitted" marker.
- **Graceful failure.** Missing EXIF, font failure, QR failure, malformed model output, and network errors produce warnings or retryable errors instead of crashes.

## Tech stack

| Area | Technology |
|---|---|
| Framework | Next.js (App Router), React, TypeScript |
| Styling / UI | Tailwind CSS, shadcn/ui (generated with v0) |
| AI | Google Gemini via `@google/genai` |
| EXIF | `exifr` |
| PDF / QR | `jspdf`, `qrcode`, Noto Sans Devanagari (TTF) |
| Speech | Web Speech API (`speechSynthesis`) |
| Testing | Vitest |
| Linting | ESLint |

## How it works

```
Browser                                   Server (Next.js route)
-------                                   ----------------------
Record voice  --+
                |-- multipart POST -->    Validate type and size
Upload photo  --+   /api/process-claim    Read EXIF (GPS, timestamp)
Device GPS (optional)                      Call Gemini (structured JSON)
                                           Parse defensively + normalize
Show draft  <-------- JSON --------------  Return analysis, gps, warnings
Hindi readback (Web Speech)
Download PDF slip (jsPDF + QR)
```

1. The browser sends the audio, the first photo, and optional device coordinates to `POST /api/process-claim`.
2. The server validates MIME types and sizes, reads EXIF once, and sends the media to Gemini with a JSON response schema.
3. The response is parsed defensively (fences and prose stripped), validated, and normalized. Missing fields get safe defaults and are listed in `warnings`.
4. The UI shows the result with provenance labels and warnings. The PDF is generated client-side.

## Project structure

```
app/
  api/process-claim/route.ts   Server route: validation, EXIF, Gemini, normalization
components/
  voice-recorder.tsx           Recording lifecycle (MIME, cap, permissions, cleanup)
  claim-preview.tsx            Draft preview, warnings, PDF download, readback
lib/
  types.ts                     Shared ClaimAnalysis types and filing-contact constant
  claimAnalysis.ts             JSON parsing and normalization
  claimSlipLayout.ts           Pure layout computation for the PDF (testable)
  generateClaimSlip.ts         jsPDF + QR generation
  gemini.ts                    Gemini client helpers
  pmfbyRules.ts                PMFBY rule constants
  useSpeech.ts, speechUtils.ts Speech synthesis hook and helpers
public/                        Fonts and static assets
tests/                         Vitest suites
HARDENING.md                   Audit fixes and operating notes
```

## Getting started

### Prerequisites

- Node.js 20 or later
- npm
- A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/)

### Install

```bash
git clone <your-repo-url>
cd pmfby-claim-portal-design
npm install
```

### Configure environment

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

`.env.local`:

```
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash-lite
```

- Use `.env.local` only. The app does not read `.env.example`, which must stay empty.
- No quotes or spaces around values.
- **Restart the dev server after changing env files.**
- Model names and free-tier limits change. Check the model list and rate limits in AI Studio and use a model your project can access. A flash-lite model usually has the most generous free limits.

### Run

```bash
npm run dev
```

Open <http://localhost:3000>.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Production build with type checking enforced |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Run Vitest suites |

## Security

- **Never commit real keys.** `.env.local` is git-ignored. `.env.example` contains empty values only.
- The API key is read **server-side only** and is never exposed to the browser bundle.
- Logs contain sizes and error codes only, never media payloads or personal data.
- If a key was ever committed or shown in a screenshot, **revoke it in AI Studio and create a new one**. Removing it from git history does not make an exposed key safe.
- There is no authentication or durable rate limiting yet. Protect the deployment and your provider quota before sharing it publicly.

## Limits and known gaps

- Audio and photo must total **under 4 MB** (a hosting body-size limit). There is no automatic image compression yet, so large phone photos can be rejected.
- Only the **first photo** is analyzed and embedded.
- Inputs survive request failures but not a page refresh or tab close.
- HEIC photos may not preview or embed on every device. A warning is shown if embedding fails.
- Free-tier Gemini quotas can return HTTP 429. Quotas apply per project, not per key.
- **EXIF is self-reported, not proof.** Metadata can be edited or missing (WhatsApp and screenshots strip it). The app labels location and time as supporting evidence only. The insurer's field assessment is the authoritative check.
- AI damage estimates are indicative only and are not a loss assessment.

## Testing

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Automated tests cover JSON parsing, normalization, GPS and timestamp validation, speech helpers, route error handling (mocked Gemini), and real jsPDF generation (single A4 page, matching printed and QR reference IDs, long Hindi text, and font/QR/photo failure recovery).

**Not covered by automated tests** (check manually on a real device):

- Live Gemini accuracy and model access with your key
- Devanagari shaping (conjuncts and matras) in phone PDF viewers
- Safari `audio/mp4` recording, blocked autoplay on iOS, and Hindi voice availability on Android

### Suggested test images

| Case | What to use |
|---|---|
| Verified path | A phone photo with location on, or a photo with GPS and a recent date added via EXIF tooling |
| Old photo | Same photo with a capture date more than 72 hours ago |
| No EXIF | A screenshot or a WhatsApp-forwarded photo |
| Size limit | An original phone photo over 4 MB |
| Bad input | A text file renamed to `.jpg` |

### Manual QA checklist (Android Chrome and iPhone Safari)

- [ ] Deny microphone permission, retry, and rapidly tap record
- [ ] Confirm the 60-second auto-stop and that the mic indicator turns off
- [ ] Upload a screenshot and a WhatsApp photo; results still appear with a warning
- [ ] Deny and grant location; check provenance labels in the UI and PDF
- [ ] Turn on airplane mode mid-request; check the error, retained inputs, and retry
- [ ] Test with no Hindi voice installed and with initially empty voices
- [ ] Tap Listen/Stop rapidly; no overlapping or delayed speech
- [ ] Open the PDF on a phone: Devanagari intact, one page, QR ID matches printed ID, draft marker visible

## Filing the claim

This app does not file claims. Farmers should report crop loss to their insurer through official channels within the PMFBY window. The UI links to the official PMFBY portal. To show a verified helpline or contact in the app, set the filing-contact constant in `lib/types.ts` (currently marked `FILING_CONTACT_TODO`). Verify the number against official sources before adding it.

## Roadmap

- Client-side image compression before upload
- Offline draft persistence
- Authentication and rate limiting
- Multi-photo analysis
- Server-side receipt time as the authoritative intimation timestamp
- EXIF versus device-location mismatch warnings
- More regional languages and voices

## Disclaimer

This is a hackathon prototype. It is not affiliated with or endorsed by any government body or insurer. It does not provide insurance advice, submit claims, or replace official loss assessment. Always confirm deadlines and procedures with your insurer and official PMFBY sources.

## License

Add a license before sharing publicly (for example MIT).

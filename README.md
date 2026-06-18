# CodeWithQuirk — automated short-form video pipeline

Ask a coding question in Telegram → get a finished, code-verified vertical video featuring
**Coddy** (a pixel-robot teacher) → approve it → it posts to Instagram, Facebook & TikTok.

Human-in-the-loop: nothing publishes without your tap.

## How it works

```
Telegram question
  → ContentGenerator   (OpenRouter, multi-model: Claude code / GPT copy / Gemini glue)
  → CodeVerifier       (runs every snippet in an E2B sandbox — bad code never ships)
  → VoiceSynthesizer   (ElevenLabs v3, expressive + word timestamps)
  → MascotSequencer    (Coddy sprite timeline from coddy-atlas.json)
  → VideoComposer      (Remotion: retro UI + Shiki code + captions + Coddy + audio → MP4)
  → Telegram preview   (✅ Approve / ⚡ Post now / ✏️ Revise / ❌ Reject)
  → Publisher          (Blotato → IG + FB + TikTok, per-platform captions)
  → Scheduler          (fixed daily slots, or post-now)
```

Core domain: a pure **JobOrchestrator** state machine
(`draft → generating → verifying → rendering → review → approved → posted`), driven by the
**Runtime** (intent executor) which wires the state machine to the real modules.

## Setup

```bash
pnpm install
cp .env.example .env      # then fill in the keys (see below)
pnpm start                # launches the Telegram bot (long-poll)
```

Required `.env` keys: `OPENROUTER_API_KEY`, `E2B_API_KEY`, `ELEVENLABS_API_KEY`,
`ELEVENLABS_VOICE_ID`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OPERATOR_CHAT_ID`, `BLOTATO_API_KEY`
(+ `BLOTATO_INSTAGRAM_ID` / `BLOTATO_FACEBOOK_ID` / `BLOTATO_FACEBOOK_PAGE_ID` /
`BLOTATO_TIKTOK_ID` for live posting). Set `USE_MOCK_PUBLISHER=false` to post for real.

## Commands

```bash
pnpm test        # vitest (unit + integration, all with mocks/fakes — no keys needed)
pnpm typecheck   # tsc --noEmit (strict)
pnpm lint        # biome
pnpm start       # run the bot
```

Live-validation scripts (hit real APIs, need `.env`) live in `scripts/`.

## Layout

- `src/domain/` — `Job`, `JobState`, `ScriptPackage` (Zod) — the core contracts
- `src/modules/<module>/` — one folder per deep module (interface + impl + tests)
- `src/runtime/` — the intent-executor that drives the pipeline
- `src/app.ts` — wires everything from `.env` and starts the bot + scheduler tick
- `remotion/` — the React video composition (isolated from the Node build)
- `assets/mascot/` — Coddy sprite sheet + atlas

Branch policy: work on `dev`; `main` is gated for manual merges.

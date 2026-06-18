# Deploying the bot (always-on, remote)

The bot is a single **always-on worker**: it long-polls Telegram (no inbound
HTTP) and renders video in-process with Remotion. That means it needs a
container host with:

- **~2 GB RAM** (Remotion rendering OOMs on 512 MB tiers),
- a **persistent disk** mounted at `/data` (SQLite job state + rendered mp4s),
- **exactly one instance** — two pollers make Telegram return `409 Conflict`,
  and the SQLite store isn't shared. **Never scale this past 1.**

The `Dockerfile` builds the image for any container platform; below are Render
(Blueprint, IaC) and Railway (dashboard).

## ⚠️ Before you go live

Stop the bot running on your laptop first. Telegram allows only one long-poll
consumer per token — if the laptop bot and the remote bot are both up, one of
them gets `409 Conflict` and drops updates.

```sh
pkill -f "src/app.ts"
```

## Required environment variables

Secrets (set in the platform dashboard — never commit):

| Var | Notes |
| --- | --- |
| `OPENROUTER_API_KEY` | required |
| `E2B_API_KEY` | required (code + SQL sandbox) |
| `ELEVENLABS_API_KEY` | required |
| `ELEVENLABS_VOICE_ID` | required (e.g. `tIb1FHpzlwSiTGg6JxF0`) |
| `TELEGRAM_BOT_TOKEN` | required |
| `TELEGRAM_OPERATOR_CHAT_ID` | required (your numeric chat id) |
| `BLOTATO_API_KEY` | publishing |
| `BLOTATO_INSTAGRAM_ID` / `BLOTATO_FACEBOOK_ID` / `BLOTATO_FACEBOOK_PAGE_ID` / `BLOTATO_TIKTOK_ID` | publishing target ids |
| `STACKOVERFLOW_API_KEY` | optional (lifts auto-topic lookup quota) |

Non-secret config (already set in `render.yaml`; set manually on Railway):

| Var | Value |
| --- | --- |
| `USE_MOCK_PUBLISHER` | `false` (real posting) |
| `DATABASE_PATH` | `/data/coddy.db` |
| `OUTPUT_DIR` | `/data/media` |
| `AUTO_TOPIC_LANGUAGES` | `javascript,python,typescript,css,sql` |
| `AUTO_TOPIC_HOUR` | `09:00` |
| `SCHEDULE_TZ` | `America/Toronto` |
| `ELEVENLABS_MODEL_ID` | `eleven_v3` |

## Option A — Render (Blueprint)

1. Push this repo to GitHub (already on `Golm117/Social_Media_Auto`).
2. Render dashboard → **New → Blueprint** → pick this repo. It reads
   `render.yaml` and proposes one `worker` + a 5 GB disk on the **Standard**
   plan.
3. Fill in the `sync:false` secrets when prompted, then **Apply**.
4. Watch the deploy logs; once it boots you'll see it long-polling. DM the bot a
   question to confirm.

To change instance size or disk later: the service's **Settings** page.

## Option B — Railway

1. Railway → **New Project → Deploy from GitHub repo** → this repo. It detects
   the `Dockerfile`.
2. **Settings → Resources**: give the service ~2 GB RAM.
3. **Variables**: add every var from both tables above.
4. **Volumes**: add a volume mounted at `/data`.
5. Deploy. Confirm by DMing the bot.

## Notes

- **First render** may be slower if Chromium wasn't baked in; the Dockerfile
  runs `remotion browser ensure` at build to avoid that.
- **Backups**: the disk holds `coddy.db`. Deleting it resets all job history;
  if you delete it, also remove `coddy.db-wal` / `coddy.db-shm`.
- **Tighter memory**: if you must run on <2 GB, lower Remotion's render
  concurrency in `src/modules/video-composer/video-composer.ts`
  (`renderMedia({ concurrency: 1, ... })`) — slower, but less RAM.

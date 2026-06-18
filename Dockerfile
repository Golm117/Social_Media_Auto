# CodeWithQuirk bot — always-on container (long-polls Telegram + renders video).
# Debian bookworm (glibc), NOT Alpine: Alpine's musl breaks better-sqlite3
# prebuilds and Remotion's headless Chromium.
FROM node:20-bookworm-slim

# System libraries Remotion's headless Chromium needs at runtime, plus the
# toolchain to compile native modules (better-sqlite3) if no prebuild matches.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation tzdata \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libasound2 \
      libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libxshmfence1 libpango-1.0-0 libcairo2 libcups2 libx11-6 libxext6 libxcb1 \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Install deps first for layer caching. devDependencies are KEPT on purpose —
# the app runs in production via `tsx` (a devDependency), not a compiled build.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# App source (remotion/, assets/, src/ …). .dockerignore keeps node_modules,
# .git, data/ and .env out.
COPY . .

# Bake Remotion's Chromium Headless Shell into the image so the first render
# doesn't have to download it at runtime. (The `remotion` CLI isn't a dependency
# here — rendering is programmatic — so we call the renderer's ensureBrowser().)
RUN node --input-type=module -e "const { ensureBrowser } = await import('@remotion/renderer'); await ensureBrowser();"

# State + rendered media persist on a mounted volume (see render.yaml / DEPLOY.md).
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/coddy.db
ENV OUTPUT_DIR=/data/media
RUN mkdir -p /data/media

CMD ["pnpm", "start"]

# ── base ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
# argon2 ships prebuilds, but keep the toolchain around for platforms without one.
RUN apk add --no-cache python3 make g++
COPY package*.json ./

# Noto Sans Lao is REQUIRED for PDF generation — PDFKit's built-in fonts have no
# Lao glyphs, so without it every report renders as blank boxes. Installed in the
# development and production stages below.

# ── development ─────────────────────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development
RUN apk add --no-cache font-noto-lao
# Phetsarath OT as well, so a dev container renders official letters in the same
# face production does rather than in the Noto fallback.
RUN apk add --no-cache --virtual .fetch-deps curl \
    && mkdir -p /usr/share/fonts/phetsarath \
    && curl -fsSL -o /usr/share/fonts/phetsarath/Phetsarath-Regular.ttf \
       https://raw.githubusercontent.com/google/fonts/main/ofl/phetsarath/Phetsarath-Regular.ttf \
    && curl -fsSL -o /usr/share/fonts/phetsarath/Phetsarath-Bold.ttf \
       https://raw.githubusercontent.com/google/fonts/main/ofl/phetsarath/Phetsarath-Bold.ttf \
    && apk del .fetch-deps
RUN npm install
COPY . .
CMD ["npm", "run", "start:dev"]

# ── build ───────────────────────────────────────────────────────────────────
FROM base AS build
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ── production ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
# Lao fonts, so report and certificate PDFs render legibly.
RUN apk add --no-cache font-noto-lao
# Phetsarath OT — the Lao government's typeface, which official letters
# (ໃບຢັ້ງຢືນການສຶກສາ) are set in. Not in any Alpine package, and the repo's copy
# is git-ignored along with the other fonts, so it is fetched here rather than
# relying on the build context. Without it the letters silently fall back to Noto
# Sans Lao — legible, but not what a signed Lao document looks like, and Noto
# carries no digits so dates and phone numbers change face mid-line.
RUN apk add --no-cache --virtual .fetch-deps curl \
    && mkdir -p /usr/share/fonts/phetsarath \
    && curl -fsSL -o /usr/share/fonts/phetsarath/Phetsarath-Regular.ttf \
       https://raw.githubusercontent.com/google/fonts/main/ofl/phetsarath/Phetsarath-Regular.ttf \
    && curl -fsSL -o /usr/share/fonts/phetsarath/Phetsarath-Bold.ttf \
       https://raw.githubusercontent.com/google/fonts/main/ofl/phetsarath/Phetsarath-Bold.ttf \
    && apk del .fetch-deps
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json
# The letterhead images. Unlike the fonts, these are not in any package: the
# national emblem and the school's own logo ship with the repo, and the paths the
# renderer looks in are relative to the working directory.
COPY --from=build --chown=app:app /app/assets ./assets
USER app
EXPOSE 3000
CMD ["node", "dist/main"]

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
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json
USER app
EXPOSE 3000
CMD ["node", "dist/main"]

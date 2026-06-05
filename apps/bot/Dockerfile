# Copyright (c) 2026 Counter (counter.ltd)
# SPDX-License-Identifier: LicenseRef-CSL-1.0

# Self-contained Node image for the gateway bot. It installs only its own deps
# (not the Bun monorepo's), so the build never touches the rest of core/.
FROM node:20-slim

WORKDIR /app

# Install deps first so the layer caches when only source changes.
COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# The bot connects out to Discord's Gateway; the only inbound listener is the
# health server on $PORT, which Cloud Run provides.
CMD ["node", "src/index.mjs"]

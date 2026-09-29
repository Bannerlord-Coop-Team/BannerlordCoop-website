# Local development image; runtime configuration comes only from the local Compose stack.
FROM node:22-bookworm-slim

RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .
# This route exists only in the local image, never in the production source routes.
COPY --chown=node:node deploy/local/dev-login/ ./src/app/dev-login/

ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

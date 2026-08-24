FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY agent.mjs ./

ENV NODE_ENV=production
# Docker socket permissions differ by host. Run with only the socket mount and
# no published ports; the server/container allowlist is enforced by the agent.
CMD ["node", "agent.mjs"]

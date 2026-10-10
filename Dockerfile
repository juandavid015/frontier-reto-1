# The agent's HTTP server. Node 24 runs our TypeScript directly, so there is no build step.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# Install only runtime dependencies, exactly as locked.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile

COPY src ./src
# Traces are written here at run time, by the unprivileged user below.
RUN mkdir artifacts && chown node:node artifacts

# The host sets PORT; TEAM_TOKEN and OPENROUTER_API_KEY come from its secret settings, never from the image.
USER node
CMD ["node", "src/server/main.ts"]

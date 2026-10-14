# The API as an image. Built from the repository root (the folder with package-lock.json):
#   docker build -f apps/api/Dockerfile .
# deploy/docker-compose.yml does that. Everything it needs is in apps/api and packages/shared.
FROM node:24-bookworm-slim

# Prisma's migration engine needs OpenSSL, which the slim image leaves out
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 PORT=3001

# The dependencies first, so that a change in the code does not fetch them again. TypeScript, the Nest and Prisma
# command lines and tsx are development dependencies: they are needed to build, to bring the tables up to date when
# the API starts, and to load the starting data (npm run db:seed).
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --include=dev -w @trendlix/api -w @trendlix/shared

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @trendlix/shared && npm run build -w @trendlix/api

# The stamp of the build: the last commit that changed what this image is built from, and its date. deploy/deploy.sh
# works them out, deploy/docker-compose.yml hands them over, and the API answers with them at /api/version. Taken
# after the build, so a new stamp does not make the steps above run again.
ARG PEOPLE_COMMIT=""
ARG PEOPLE_COMMITTED=""
ENV PEOPLE_COMMIT="$PEOPLE_COMMIT" PEOPLE_COMMITTED="$PEOPLE_COMMITTED"

USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# The tables are brought up to date, then the API starts. `exec` lets node itself receive the signal to stop.
CMD ["sh", "-c", "npm run db:deploy -w @trendlix/api && exec node apps/api/dist/main.js"]

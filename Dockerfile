# 本人専用の常駐デプロイ用。Vercelのようなサーバーレスには載せない
# （SQLiteへの書き込みと常駐クロールがあるため、ディスクの残る常時起動環境が前提）。
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# データは必ず永続ディスクに置く（例: マウントした /data）。
# 未設定だと作業ディレクトリ直下 data/ に書くので、コンテナ再作成で消える。
ENV APP_DATA_DIR=/data
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/scripts ./scripts
EXPOSE 3000
CMD ["sh", "-c", "node scripts/agent-daemon.mjs & exec ./node_modules/.bin/next start -p ${PORT:-3000}"]

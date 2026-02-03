FROM oven/bun:latest
WORKDIR /app

COPY package.json bun.lockb bunfig.toml turbo.json ./
COPY packages ./packages
COPY apps ./apps

RUN bun install --production --frozen-lockfile

ENV NODE_ENV=production
EXPOSE 3000

CMD ["bun", "run", "--filter=@dln/api", "start"]

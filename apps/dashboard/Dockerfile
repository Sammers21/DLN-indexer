FROM oven/bun:latest AS build
WORKDIR /app

COPY package.json bun.lockb bunfig.toml turbo.json ./
COPY packages ./packages
COPY apps ./apps

RUN bun install --frozen-lockfile
RUN bun run --filter=@dln/dashboard build

FROM nginx:latest
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/dashboard/dist/client /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

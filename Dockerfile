FROM node:22.14-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS build
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/build ./build
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
EXPOSE 10000
CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/seed.mjs && npm run start"]

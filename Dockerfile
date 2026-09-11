FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN npx prisma generate && npm run build

ENV NODE_ENV=production
ENV QMRMED_DISABLE_ARCHIVE_SYNC=1
EXPOSE 8080

CMD ["npm", "run", "start:miniapp"]

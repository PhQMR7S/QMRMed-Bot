FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV QMRMED_DISABLE_ARCHIVE_SYNC=1
EXPOSE 8080

CMD ["npm", "run", "start:miniapp"]

FROM node:24.21.0@sha256:9af606de2e947cfb3f276633b7c5130c4cd22365aa10f5a647b7675d5cfce0c0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY tsconfig.json ./
RUN mkdir -p data/pdfs && chown -R node:node /app/data
USER node
CMD ["npm", "run", "start"]

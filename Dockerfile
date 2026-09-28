# Imagem usada pelo Google Cloud Run (e por qualquer host que rode Docker).
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

# Instala so as dependencias de producao (aproveita cache entre builds)
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# O Cloud Run informa a porta pela variavel PORT (padrao 8080);
# o server/index.js ja le process.env.PORT.
EXPOSE 8080
CMD ["node", "server/index.js"]

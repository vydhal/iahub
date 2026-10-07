FROM node:20-bookworm-slim

# openssl: engine do Prisma · ca-certificates: chamadas HTTPS das ferramentas dos agentes
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# WITH_BROWSER=true instala o Chromium do Playwright (camada RPA). Sem ele, a API sobe normalmente
# e agentes que usam browser.playwright falham com "intervenção necessária".
ARG WITH_BROWSER=false

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

RUN if [ "$WITH_BROWSER" = "true" ]; then npx playwright install --with-deps chromium; fi

COPY . .

RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "run", "dev"]

FROM --platform=linux/amd64 node:16-alpine
WORKDIR /app

# Instalar dependências primeiro para aproveitar o cache
COPY yarn.lock package.json ./
RUN yarn install --frozen-lockfile && yarn cache clean

# Copiar o resto do código (respeitando o .dockerignore)
COPY . .

ENV NODE_ENV production

# Gerar a build do projeto
RUN yarn build:prod

CMD ["yarn", "start:prod"]

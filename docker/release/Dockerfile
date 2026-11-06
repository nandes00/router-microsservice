FROM --platform=linux/amd64 node:16-alpine
WORKDIR /app

COPY yarn.lock package.json ./
RUN yarn install

COPY . .

ENV NODE_ENV production

RUN yarn build

CMD yarn start

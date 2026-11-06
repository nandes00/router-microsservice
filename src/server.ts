import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { NODE_ENV, SERVER_MODE, SERVER_PATH, SERVER_PORT } from './env';
import { init } from './sentry';

const app = express();

init(app);

app.use(express.json({ limit: '50mb' }));
app.use(cors({
  origin: ['https://roteirizador.track.track.com.br', 'http://localhost:8080'],
}));

const isIPC = SERVER_MODE === 'ipc';

console.log(`Running on "${NODE_ENV}" environment on "${SERVER_MODE}" mode`);

if (isIPC) {
  if (fs.existsSync(SERVER_PATH)) {
    fs.unlinkSync(SERVER_PATH);
  }

  app.listen(
    { path: SERVER_PATH, readableAll: true, writableAll: true },
    () => {
      console.info(`Listening on file "${SERVER_PATH}"`);
    },
  );
} else {
  app.listen(SERVER_PORT, () => {
    console.info(`Listening on port ${SERVER_PORT}`);
  });
}

export default app;

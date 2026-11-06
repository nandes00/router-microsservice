import { NODE_ENV } from '@env';
import * as Sentry from '@sentry/node';
import { Express } from 'express';

export const init = (app: Express) => {
  if (NODE_ENV === 'development') return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN || 'https://0accd3309fcc439081f3a46b899b08d0@o283173.ingest.sentry.io/4505444271259648',
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app }),
    ],

    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '1.0'),
  });

  app.use(Sentry.Handlers.requestHandler());
  app.use(Sentry.Handlers.tracingHandler());

  return Sentry;
};

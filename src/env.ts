import { expectDefined } from '@utils/expect';

export const NODE_ENV = process.env.NODE_ENV ?? 'development';
export const SERVER_MODE = process.env.SERVER_MODE ?? 'direct';
export const SERVER_PATH = process.env.SERVER_PATH ?? './tmp/node_app.sock';
export const SERVER_PORT = parseInt(process.env.SERVER_PORT ?? '3001');
export const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

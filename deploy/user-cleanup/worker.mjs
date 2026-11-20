import { cleanupUserDb } from './cleanup.mjs';

export default {
  fetch() { return new Response('Not found', { status: 404 }); },
  async scheduled(_event, env) { await cleanupUserDb(env.USER_DB); },
};

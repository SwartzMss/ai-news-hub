import { login, logout, me, register, verifyEmail } from '../../../auth/routes.js';
import { AuthError, type AuthContext, getConfig, json, requireOrigin } from '../../../auth/runtime.js';

export async function onRequest(ctx: AuthContext): Promise<Response> {
  try {
    const config = getConfig(ctx.env);
    requireOrigin(ctx, config);
    const action = new URL(ctx.request.url).pathname.replace(/\/$/, '').split('/').at(-1);
    if (action === 'register' && ctx.request.method === 'POST') return await register(ctx, config);
    if (action === 'verify-email' && ['GET', 'POST'].includes(ctx.request.method)) return await verifyEmail(ctx, config);
    if (action === 'login' && ctx.request.method === 'POST') return await login(ctx, config);
    if (action === 'logout' && ctx.request.method === 'POST') return await logout(ctx, config);
    if (action === 'me' && ctx.request.method === 'GET') return await me(ctx, config);
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    const safe = error instanceof AuthError ? error : new AuthError('auth_unavailable', 503);
    return json({ error: safe.code }, safe.status);
  }
}

import { changePassword, forgotPassword, login, logout, me, register, resetPassword, verifyEmail, verifyEmailCode } from '../../../auth/routes.js';
import { AuthError, type AuthContext, getConfig, json, requireOrigin } from '../../../auth/runtime.js';
import { exportData } from '../../../auth/user-data.js';

export async function onRequest(ctx: AuthContext): Promise<Response> {
  try {
    const config = getConfig(ctx.env);
    requireOrigin(ctx, config);
    const action = new URL(ctx.request.url).pathname.replace(/\/$/, '').split('/').at(-1);
    const site = ctx.request.headers.get('sec-fetch-site');
    const isEmailNavigation = ctx.request.method === 'GET' && ['verify-email', 'reset-password'].includes(action ?? '')
      && ctx.request.headers.get('sec-fetch-mode') === 'navigate'
      && ctx.request.headers.get('sec-fetch-dest') === 'document';
    if (site && !['same-origin', 'none'].includes(site) && !isEmailNavigation) throw new AuthError('invalid_origin', 403);
    if (action === 'config' && ctx.request.method === 'GET') {
      if (!config.turnstileSiteKey || !config.turnstileSecret) throw new AuthError('auth_unavailable', 503);
      return json({ turnstileSiteKey: config.turnstileSiteKey });
    }
    if (action === 'register' && ctx.request.method === 'POST') return await register(ctx, config);
    if (action === 'verify-email' && ['GET', 'POST'].includes(ctx.request.method)) return await verifyEmail(ctx, config);
    if (action === 'verify-email-code' && ctx.request.method === 'POST') return await verifyEmailCode(ctx, config);
    if (action === 'forgot-password' && ctx.request.method === 'POST') return await forgotPassword(ctx, config);
    if (action === 'reset-password' && ['GET', 'POST'].includes(ctx.request.method)) return await resetPassword(ctx, config);
    if (action === 'change-password' && ctx.request.method === 'POST') return await changePassword(ctx, config);
    if (action === 'login' && ctx.request.method === 'POST') return await login(ctx, config);
    if (action === 'logout' && ctx.request.method === 'POST') return await logout(ctx, config);
    if (action === 'me' && ctx.request.method === 'GET') return await me(ctx, config);
    if (action === 'export-data' && ctx.request.method === 'POST') return await exportData(ctx, config);
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    const safe = error instanceof AuthError ? error : new AuthError('auth_unavailable', 503);
    return json({ error: safe.code }, safe.status);
  }
}

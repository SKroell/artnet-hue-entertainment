import {v3} from 'node-hue-api';
import * as https from 'https';

export async function connectHueApi(opts: {host: string; username?: string; allowInsecureFallback?: boolean}) {
  const allowInsecureFallback = opts.allowInsecureFallback !== false;
  try {
    const api = await v3.api.createLocal(opts.host).connect(opts.username as any);
    return api;
  } catch (e: any) {
    if (!allowInsecureFallback) {
      throw e;
    }
    // Common cases:
    // - Hue Bridge now HTTPS-only
    // - TLS validation fails due to Hue bridge private CA
    const msg = e?.message ? String(e.message) : String(e);
    console.warn(`[hue-api] createLocal failed for ${opts.host} (${msg}). Retrying with createInsecureLocal...`);
    const api = await v3.api.createInsecureLocal(opts.host).connect(opts.username as any);
    return api;
  }
}

/**
 * Per Hue Entertainment guide: DTLS PSK identity should be the `hue-application-id`
 * returned as a response header from GET /auth/v1 with hue-application-key.
 *
 * We do a best-effort HTTPS request and fall back to `username` if not available.
 */
export async function getHueApplicationId(opts: {host: string; username: string}): Promise<string> {
  const {host, username} = opts;
  return await new Promise((resolve) => {
    const req = https.request(
      {
        host,
        port: 443,
        method: 'GET',
        path: '/auth/v1',
        headers: {
          'hue-application-key': username,
        },
        // Hue bridges use a private CA; for now we allow this so it works out of the box.
        // (If you want strict validation, we can add CA bundle support later.)
        rejectUnauthorized: false,
      } as any,
      (res) => {
        const appId = (res.headers['hue-application-id'] as any) ?? (res.headers['hue-application-id'.toLowerCase()] as any);
        // drain
        res.on('data', () => undefined);
        res.on('end', () => resolve(typeof appId === 'string' && appId.trim().length ? appId.trim() : username));
      },
    );
    req.on('error', () => resolve(username));
    req.end();
  });
}



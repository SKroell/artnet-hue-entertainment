import * as https from 'https';

function requestJson(opts: {host: string; method: string; path: string; appKey: string; body?: any}) {
  const payload = opts.body ? JSON.stringify(opts.body) : undefined;
  return new Promise<any>((resolve, reject) => {
    const req = https.request(
      {
        host: opts.host,
        port: 443,
        method: opts.method,
        path: opts.path,
        headers: {
          'hue-application-key': opts.appKey,
          ...(payload ? {'content-type': 'application/json', 'content-length': Buffer.byteLength(payload)} : {}),
        },
        rejectUnauthorized: false,
      } as any,
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(Buffer.from(d)));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          let json: any = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            // ignore
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`Hue v2 ${opts.method} ${opts.path} failed (${res.statusCode}): ${text || 'no body'}`));
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export type EntertainmentConfigurationSummary = {
  id: string;
  name?: string;
  channelIds: number[];
};

export async function listEntertainmentConfigurations(opts: {host: string; appKey: string}): Promise<EntertainmentConfigurationSummary[]> {
  const res = await requestJson({
    host: opts.host,
    method: 'GET',
    path: '/clip/v2/resource/entertainment_configuration',
    appKey: opts.appKey,
  });
  const data = Array.isArray(res?.data) ? res.data : [];
  return data.map((x: any) => ({
    id: String(x.id),
    name: x?.metadata?.name ? String(x.metadata.name) : undefined,
    channelIds: Array.isArray(x?.channels) ? x.channels.map((c: any) => Number(c.channel_id)).filter((n: any) => Number.isFinite(n)) : [],
  }));
}

export async function startEntertainmentConfiguration(opts: {host: string; appKey: string; id: string}) {
  return await requestJson({
    host: opts.host,
    method: 'PUT',
    path: `/clip/v2/resource/entertainment_configuration/${encodeURIComponent(opts.id)}`,
    appKey: opts.appKey,
    body: {action: 'start'},
  });
}

export async function stopEntertainmentConfiguration(opts: {host: string; appKey: string; id: string}) {
  return await requestJson({
    host: opts.host,
    method: 'PUT',
    path: `/clip/v2/resource/entertainment_configuration/${encodeURIComponent(opts.id)}`,
    appKey: opts.appKey,
    body: {action: 'stop'},
  });
}



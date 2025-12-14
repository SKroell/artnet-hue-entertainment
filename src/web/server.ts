import express = require('express');
import path = require('path');
import {discovery, v3, ApiError} from 'node-hue-api';
import {ConfigStore, AppConfigV2, HubConfig, getHubOrThrow, makeHubId} from '../config';

function isObject(x: unknown): x is Record<string, any> {
  return typeof x === 'object' && x !== null;
}

function normalizeConfig(input: unknown): AppConfigV2 {
  if (!isObject(input)) {
    throw new Error('Invalid config');
  }
  if (input.version !== 2) {
    throw new Error('Unsupported config version');
  }
  if (!isObject(input.artnet) || typeof input.artnet.bindIp !== 'string') {
    throw new Error('Invalid artnet config');
  }
  if (!Array.isArray(input.hubs)) {
    throw new Error('Invalid hubs list');
  }
  return input as AppConfigV2;
}

export async function startWebUi(opts: {port: number; configPath?: string}) {
  const store = new ConfigStore(opts.configPath);
  const app = express();
  app.use(express.json({limit: '1mb'}));

  const staticRoot = path.join(__dirname, 'public');
  app.use(express.static(staticRoot));

  app.get('/api/config', async (_req: express.Request, res: express.Response) => {
    try {
      const cfg = await store.load();
      res.json(cfg);
    } catch (e: any) {
      res.status(500).json({error: e?.message ?? 'Failed to load config'});
    }
  });

  // Optional runtime status (only available when started from `run --web`)
  const statusProvider = (opts as any).statusProvider as undefined | (() => any);
  if (statusProvider) {
    app.get('/api/status', (_req: express.Request, res: express.Response) => {
      try {
        res.json(statusProvider());
      } catch (e: any) {
        res.status(500).json({error: e?.message ?? 'Failed to read status'});
      }
    });
  }

  app.put('/api/config', async (req: express.Request, res: express.Response) => {
    try {
      const cfg = normalizeConfig(req.body);
      await store.save(cfg);
      res.json({ok: true});
    } catch (e: any) {
      res.status(400).json({error: e?.message ?? 'Invalid config'});
    }
  });

  app.get('/api/hubs/discover', async (_req: express.Request, res: express.Response) => {
    try {
      const results = await discovery.nupnpSearch();
      res.json(results.map(b => ({ip: b.ipaddress, name: b.config?.name})));
    } catch (e: any) {
      res.status(500).json({error: e?.message ?? 'Discovery failed'});
    }
  });

  app.post('/api/hubs/pair', async (req: express.Request, res: express.Response) => {
    const host = req.body?.host;
    const preferredName = req.body?.name;
    if (typeof host !== 'string' || host.trim().length === 0) {
      res.status(400).json({error: 'host is required'});
      return;
    }
    try {
      const unauthApi = await v3.api.createLocal(host).connect();
      const user = await unauthApi.users.createUser('artnet-hue-entertainment', 'web');
      if (!user.clientkey) {
        res.status(400).json({error: 'Pairing did not return a client key. Is your bridge updated for Entertainment streaming?'});
        return;
      }

      let bridgeName: string | undefined = preferredName;
      let bridgeId: string | undefined = undefined;
      try {
        const authApi = await v3.api.createLocal(host).connect(user.username);
        const cfg: any = await (authApi as any).configuration.getConfiguration();
        bridgeName = bridgeName ?? cfg?.name;
        bridgeId = cfg?.bridgeid;
      } catch {
        // ignore
      }

      const config = await store.load();
      const hubId = makeHubId({bridgeId, host, name: bridgeName});
      const hub: HubConfig = {
        id: hubId,
        name: bridgeName,
        host,
        username: user.username,
        clientKey: user.clientkey,
        entertainmentRoomId: undefined,
        artNetUniverse: (config.hubs?.[0]?.artNetUniverse ?? 11),
        lights: [],
      };

      const hubs = Array.isArray(config.hubs) ? config.hubs : [];
      const idx = hubs.findIndex(h => h.id === hubId);
      if (idx !== -1) {
        hubs[idx] = hub;
      } else {
        hubs.push(hub);
      }

      config.hubs = hubs;
      await store.save(config);
      res.json({ok: true, hub});
    } catch (e) {
      const error = e as ApiError;
      const hueError = (error as any).getHueError?.();
      if (hueError?.message) {
        res.status(400).json({error: hueError.message});
        return;
      }
      res.status(500).json({error: (e as any)?.message ?? 'Pairing failed'});
    }
  });

  app.get('/api/hubs/:hubId/rooms', async (req: express.Request, res: express.Response) => {
    try {
      const config = await store.load();
      const hub = getHubOrThrow(config, req.params.hubId);
      const hueApi = await v3.api.createLocal(hub.host).connect(hub.username);
      const rooms = await hueApi.groups.getEntertainment();
      res.json(rooms.map(r => ({id: String(r.id), name: r.name, lights: r.lights})));
    } catch (e: any) {
      res.status(500).json({error: e?.message ?? 'Failed to load rooms'});
    }
  });

  app.get('/api/hubs/:hubId/lights', async (req: express.Request, res: express.Response) => {
    try {
      const config = await store.load();
      const hub = getHubOrThrow(config, req.params.hubId);
      const hueApi = await v3.api.createLocal(hub.host).connect(hub.username);
      const lights = await hueApi.lights.getAll();
      res.json(lights.map(l => ({id: l.id, name: l.name})));
    } catch (e: any) {
      res.status(500).json({error: e?.message ?? 'Failed to load lights'});
    }
  });

  app.post('/api/hubs/:hubId/ping', async (req: express.Request, res: express.Response) => {
    const lightId = req.body?.lightId;
    if (typeof lightId !== 'string' && typeof lightId !== 'number') {
      res.status(400).json({error: 'lightId is required'});
      return;
    }
    try {
      const config = await store.load();
      const hub = getHubOrThrow(config, req.params.hubId);
      const hueApi = await v3.api.createLocal(hub.host).connect(hub.username);
      await hueApi.lights.setLightState(
        lightId,
        new (v3.lightStates.LightState)().alert().alertShort(),
      );
      res.json({ok: true});
    } catch (e: any) {
      res.status(500).json({error: e?.message ?? 'Failed to ping light'});
    }
  });

  return await new Promise<void>(resolve => {
    app.listen(opts.port, () => {
      console.log(`Web UI running on http://127.0.0.1:${opts.port}`);
      resolve();
    });
  });
}



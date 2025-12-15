import {open, stat, writeFile, readFile} from 'fs/promises';
import {ChannelModeType} from './const';

export const CONFIG_FILE_PATH = 'config.json';

export interface ChannelConfiguration {
  dmxStart: number;
  /** Entertainment channel id (0..). */
  channelId: number;
  channelMode: ChannelModeType;
}

export interface HubConfig {
  /** Stable identifier (prefer Hue bridgeid). */
  id: string;
  name?: string;
  host: string;
  username: string;
  clientKey: string;
  /** Hue Entertainment configuration UUID to stream to (one per hub). */
  entertainmentConfigurationId?: string;
  /** Art-Net universe to listen to for this hub. */
  artNetUniverse: number;
  channels: ChannelConfiguration[];
}

export interface AppConfigV3 {
  version: 3;
  artnet: {
    /** IP to bind the Art-Net listener to (UDP/6454). */
    bindIp: string;
  };
  hubs: HubConfig[];
}

type LegacyConfigV1 = {
  artnet?: {host?: string; universe?: number};
  hue?: {host?: string; username?: string; clientKey?: string; lights?: any[]};
};

type AppConfigV2Like = {
  version: 2;
  artnet: {bindIp: string};
  hubs: Array<{
    id: string;
    name?: string;
    host: string;
    username: string;
    clientKey: string;
    entertainmentRoomId?: string;
    artNetUniverse: number;
    lights: Array<{dmxStart: number; lightId: string; channelMode: ChannelModeType}>;
  }>;
};

const DEFAULT_CONFIG: AppConfigV3 = {
  version: 3,
  artnet: {bindIp: '0.0.0.0'},
  hubs: [],
};

function isObject(x: unknown): x is Record<string, any> {
  return typeof x === 'object' && x !== null;
}

function sanitizeIdPart(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function makeHubId(opts: {bridgeId?: string; host: string; name?: string}) {
  if (opts.bridgeId && typeof opts.bridgeId === 'string' && opts.bridgeId.trim().length > 0) {
    return sanitizeIdPart(opts.bridgeId.trim());
  }
  const base = opts.name?.trim() ? sanitizeIdPart(opts.name) : 'hue';
  return `${base}-${sanitizeIdPart(opts.host)}`.replace(/-+/g, '-');
}

export class ConfigStore {
  private readonly path: string;

  constructor(path = CONFIG_FILE_PATH) {
    this.path = path;
  }

  async ensureExists() {
    let exists = false;
    try {
      const fileInfo = await stat(this.path);
      exists = fileInfo.isFile();
    } catch {
      exists = false;
    }

    if (!exists) {
      const fd = await open(this.path, 'w');
      await fd.write(JSON.stringify(DEFAULT_CONFIG, null, 2));
      await fd.close();
    }
  }

  async load(): Promise<AppConfigV3> {
    await this.ensureExists();
    const raw = await readFile(this.path, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // If the file exists but is invalid JSON, don't destroy it.
      throw new Error(`Config file ${this.path} is not valid JSON`);
    }

    const migrated = this.migrateIfNeeded(parsed);
    if (migrated.didMigrate) {
      await this.backupLegacyConfig(raw);
      await this.save(migrated.config);
    }

    return migrated.config;
  }

  async save(config: AppConfigV3) {
    // Minimal validation/sanitization
    if (!config || (config as any).version !== 3) {
      throw new Error('Refusing to save invalid config (expected version 3)');
    }
    if (!config.artnet?.bindIp) {
      config.artnet = {bindIp: '0.0.0.0'};
    }
    if (!Array.isArray(config.hubs)) {
      config.hubs = [];
    }
    await writeFile(this.path, JSON.stringify(config, null, 2), 'utf-8');
  }

  private migrateIfNeeded(parsed: unknown): {didMigrate: boolean; config: AppConfigV3} {
    // Already v3?
    if (isObject(parsed) && parsed.version === 3 && isObject(parsed.artnet) && Array.isArray(parsed.hubs)) {
      return {didMigrate: false, config: parsed as AppConfigV3};
    }

    // v2 -> v3
    if (isObject(parsed) && parsed.version === 2 && isObject((parsed as any).artnet) && Array.isArray((parsed as any).hubs)) {
      const v2 = parsed as AppConfigV2Like;
      const hubs: HubConfig[] = (v2.hubs ?? []).map(h => {
        const ent = h.entertainmentRoomId;
        const looksLikeUuid = typeof ent === 'string' && ent.length === 36 && ent.includes('-');
        return {
          id: h.id,
          name: h.name,
          host: h.host,
          username: h.username,
          clientKey: h.clientKey,
          entertainmentConfigurationId: looksLikeUuid ? ent : undefined,
          artNetUniverse: h.artNetUniverse ?? 0,
          // Best-effort: map old numeric lightId -> channelId (may not match; user can re-map in UI).
          channels: (h.lights ?? []).map(l => ({
            dmxStart: l.dmxStart,
            channelId: Number.parseInt(String(l.lightId), 10),
            channelMode: l.channelMode,
          })).filter(c => Number.isFinite(c.channelId)),
        };
      });
      return {
        didMigrate: true,
        config: {version: 3, artnet: {bindIp: v2.artnet?.bindIp ?? DEFAULT_CONFIG.artnet.bindIp}, hubs},
      };
    }

    // Legacy v1?
    if (isObject(parsed) && (isObject((parsed as LegacyConfigV1).hue) || isObject((parsed as LegacyConfigV1).artnet))) {
      const legacy = parsed as LegacyConfigV1;
      const bindIp = legacy.artnet?.host ?? DEFAULT_CONFIG.artnet.bindIp;
      const universe = legacy.artnet?.universe ?? 0;
      const host = legacy.hue?.host;
      const username = legacy.hue?.username;
      const clientKey = legacy.hue?.clientKey;

      const hubs: HubConfig[] = [];
      if (host && username && clientKey) {
        hubs.push({
          id: makeHubId({host}),
          name: 'Hue Hub',
          host,
          username,
          clientKey,
          // Not present in legacy config. User must select in UI/CLI.
          entertainmentConfigurationId: undefined,
          artNetUniverse: universe,
          channels: [],
        });
      }

      return {
        didMigrate: true,
        config: {version: 3, artnet: {bindIp}, hubs},
      };
    }

    // Unknown shape: reset to default but do not migrate automatically.
    return {didMigrate: false, config: DEFAULT_CONFIG};
  }

  private async backupLegacyConfig(raw: string) {
    // Best-effort backup: config.json -> config.legacy.json (overwrites previous backup)
    const backupPath = this.path.replace(/\.json$/i, '.legacy.json');
    try {
      await writeFile(backupPath, raw, 'utf-8');
    } catch {
      // ignore
    }
  }
}

export function getHubOrThrow(config: AppConfigV3, hubId?: string): HubConfig {
  if (config.hubs.length === 0) {
    throw new Error('No Hue hubs configured. Pair a hub first (CLI: pair, or UI: web).');
  }
  if (!hubId) {
    return config.hubs[0];
  }
  const hub = config.hubs.find(h => h.id === hubId);
  if (!hub) {
    throw new Error(`Unknown hub id "${hubId}". Known hubs: ${config.hubs.map(h => h.id).join(', ')}`);
  }
  return hub;
}



import {open, stat, writeFile, readFile} from 'fs/promises';
import {ChannelModeType} from './const';

export const CONFIG_FILE_PATH = 'config.json';

export interface LightConfiguration {
  dmxStart: number;
  lightId: string;
  channelMode: ChannelModeType;
}

export interface HubConfig {
  /** Stable identifier (prefer Hue bridgeid). */
  id: string;
  name?: string;
  host: string;
  username: string;
  clientKey: string;
  /** Hue Entertainment group id to stream to (one per hub). */
  entertainmentRoomId?: string;
  /** Art-Net universe to listen to for this hub. */
  artNetUniverse: number;
  lights: LightConfiguration[];
}

export interface AppConfigV2 {
  version: 2;
  artnet: {
    /** IP to bind the Art-Net listener to (UDP/6454). */
    bindIp: string;
  };
  hubs: HubConfig[];
}

type LegacyConfigV1 = {
  artnet?: {host?: string; universe?: number};
  hue?: {host?: string; username?: string; clientKey?: string; lights?: LightConfiguration[]};
};

const DEFAULT_CONFIG: AppConfigV2 = {
  version: 2,
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

  async load(): Promise<AppConfigV2> {
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

  async save(config: AppConfigV2) {
    // Minimal validation/sanitization
    if (!config || config.version !== 2) {
      throw new Error('Refusing to save invalid config (expected version 2)');
    }
    if (!config.artnet?.bindIp) {
      config.artnet = {bindIp: '0.0.0.0'};
    }
    if (!Array.isArray(config.hubs)) {
      config.hubs = [];
    }
    await writeFile(this.path, JSON.stringify(config, null, 2), 'utf-8');
  }

  private migrateIfNeeded(parsed: unknown): {didMigrate: boolean; config: AppConfigV2} {
    // Already v2?
    if (isObject(parsed) && parsed.version === 2 && isObject(parsed.artnet) && Array.isArray(parsed.hubs)) {
      return {didMigrate: false, config: parsed as AppConfigV2};
    }

    // Legacy v1?
    if (isObject(parsed) && (isObject((parsed as LegacyConfigV1).hue) || isObject((parsed as LegacyConfigV1).artnet))) {
      const legacy = parsed as LegacyConfigV1;
      const bindIp = legacy.artnet?.host ?? DEFAULT_CONFIG.artnet.bindIp;
      const universe = legacy.artnet?.universe ?? 0;
      const host = legacy.hue?.host;
      const username = legacy.hue?.username;
      const clientKey = legacy.hue?.clientKey;
      const lights = legacy.hue?.lights ?? [];

      const hubs: HubConfig[] = [];
      if (host && username && clientKey) {
        hubs.push({
          id: makeHubId({host}),
          name: 'Hue Hub',
          host,
          username,
          clientKey,
          // Not present in legacy config. User must select in UI/CLI.
          entertainmentRoomId: undefined,
          artNetUniverse: universe,
          lights,
        });
      }

      return {
        didMigrate: true,
        config: {version: 2, artnet: {bindIp}, hubs},
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

export function getHubOrThrow(config: AppConfigV2, hubId?: string): HubConfig {
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



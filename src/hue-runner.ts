import {v3} from 'node-hue-api';
import {Api} from 'node-hue-api/dist/esm/api/Api';
import {HueDtlsController, ColorUpdate} from './hue-dtls';
import {DmxLight, LIGHT_MODES} from './DmxLight';
import {ArtDmx} from 'artnet-protocol/dist/protocol';
import {HubConfig, ChannelConfiguration} from './config';
import {RuntimeStatus} from './runtime-status';
import {connectHueApi, getHueApplicationId} from './hue-api';
import {listEntertainmentConfigurations, startEntertainmentConfiguration, stopEntertainmentConfiguration} from './hue-v2';

export class HueEntertainmentRunner {
  private readonly hub: HubConfig;
  private readonly status?: RuntimeStatus;
  private hueApi: Api | null = null;
  private lights: DmxLight[] = [];
  private dtlsController: HueDtlsController | null = null;

  constructor(hub: HubConfig, status?: RuntimeStatus) {
    this.hub = hub;
    this.status = status;
    this.status?.upsertHub({
      hubId: hub.id,
      hubName: hub.name,
      host: hub.host,
      universe: hub.artNetUniverse,
      entertainmentConfigurationId: hub.entertainmentConfigurationId,
    });
  }

  get id() {
    return this.hub.id;
  }

  get artNetUniverse() {
    return this.hub.artNetUniverse;
  }

  async start() {
    if (!this.hub.entertainmentConfigurationId) {
      throw new Error(`Hub "${this.hub.id}" has no entertainmentConfigurationId configured`);
    }
    this.status?.setHubStarted(this.hub.id, true);

    this.hueApi = await connectHueApi({host: this.hub.host, username: this.hub.username});

    const configs = await listEntertainmentConfigurations({host: this.hub.host, appKey: this.hub.username});
    const cfg = configs.find(c => c.id === this.hub.entertainmentConfigurationId);
    if (!cfg) {
      throw new Error(`Hub "${this.hub.id}" entertainment configuration ${this.hub.entertainmentConfigurationId} was not found`);
    }

    const configuredChannelIds = new Set((this.hub.channels ?? []).map(c => c.channelId));
    const missing = cfg.channelIds.filter(id => !configuredChannelIds.has(id));
    const extra = (this.hub.channels ?? []).map(c => c.channelId).filter(id => !cfg.channelIds.includes(id));
    if (missing.length || extra.length) {
      throw new Error(
        `Hub "${this.hub.id}" channel mapping mismatch. Missing: [${missing.join(', ')}] Extra: [${extra.join(', ')}]`,
      );
    }

    const lights: DmxLight[] = [];
    (this.hub.channels ?? []).forEach((ch: ChannelConfiguration) => {
      lights.push(new LIGHT_MODES[ch.channelMode](ch.dmxStart, ch.channelId));
    });
    this.lights = lights;

    const hueApplicationId = await getHueApplicationId({host: this.hub.host, username: this.hub.username});
    this.dtlsController = new HueDtlsController(this.hub.host, hueApplicationId, this.hub.clientKey, this.hub.entertainmentConfigurationId);

    console.log(`[${this.hub.id}] Starting entertainment configuration...`);
    const streamingResponse = await startEntertainmentConfiguration({host: this.hub.host, appKey: this.hub.username, id: this.hub.entertainmentConfigurationId});
    console.log(`[${this.hub.id}] Streaming enabled:`, streamingResponse);
    this.status?.setStreamingEnabled(this.hub.id, true);

    console.log(`[${this.hub.id}] Sleeping 1s to give the Hue bridge time to enable streaming mode`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log(`[${this.hub.id}] Performing streaming mode handshake...`);
    await this.dtlsController.connect();
    this.dtlsController.on('connected', () => this.onDtlsConnected());
    this.dtlsController.on('close', () => this.status?.setDtlsConnected(this.hub.id, false));
    this.dtlsController.on('error', (err: any) => {
      const msg = err?.message ? String(err.message) : String(err);
      this.status?.setHubError(this.hub.id, `DTLS error: ${msg}`);
    });
  }

  handleDmx(dmx: ArtDmx) {
    if (dmx.universe !== this.hub.artNetUniverse) {
      return;
    }
    this.status?.onHubDmxMatched(this.hub.id);
    if (!this.dtlsController) {
      return;
    }
    const colorUpdates: ColorUpdate[] = [];
    this.lights.forEach(light => {
      const dmxData = dmx.data.slice(light.dmxStart - 1, (light.dmxStart - 1) + light.channelWidth);
      const colors = light.getColorValue(dmxData);
      colorUpdates.push({channelId: light.lightId, color: colors});
      this.status?.onLightRgb(this.hub.id, light.lightId, colors);
    });
    const res = this.dtlsController.sendUpdate(colorUpdates);
    if (res.sent) {
      this.status?.onHubPacketSent(this.hub.id);
    } else if (res.reason === 'throttled') {
      this.status?.onHubPacketThrottled(this.hub.id);
    } else {
      this.status?.onHubPacketDropped(this.hub.id);
    }
  }

  async close() {
    const dtls = this.dtlsController;
    this.dtlsController = null;
    const api = this.hueApi;
    this.hueApi = null;

    await Promise.all([dtls ? dtls.close().catch(() => undefined) : Promise.resolve()]);
    if (api && this.hub.entertainmentConfigurationId) {
      await stopEntertainmentConfiguration({host: this.hub.host, appKey: this.hub.username, id: this.hub.entertainmentConfigurationId});
    }
  }

  /**
   * Sends a solid color to all configured lights (bypasses Art-Net).
   * Useful to validate DTLS streaming on a hub.
   */
  sendSolidColor(rgb16: [number, number, number]) {
    if (!this.dtlsController) {
      this.status?.onHubPacketDropped(this.hub.id);
      return {sent: false as const, reason: 'not_open' as const};
    }
    const colorUpdates: ColorUpdate[] = this.lights.map(light => ({channelId: light.lightId, color: rgb16}));
    for (const light of this.lights) {
      this.status?.onLightRgb(this.hub.id, light.lightId, rgb16);
    }
    const res = this.dtlsController.sendUpdate(colorUpdates);
    if (res.sent) {
      this.status?.onHubPacketSent(this.hub.id);
    } else if (res.reason === 'throttled') {
      this.status?.onHubPacketThrottled(this.hub.id);
    } else {
      this.status?.onHubPacketDropped(this.hub.id);
    }
    return res;
  }

  private onDtlsConnected() {
    console.log(`[${this.hub.id}] Connected to Hue Entertainment API`);
    this.status?.setDtlsConnected(this.hub.id, true);
    const colorUpdates: ColorUpdate[] = this.lights.map(light => ({channelId: light.lightId, color: [0, 0, 0]}));
    const res = this.dtlsController?.sendUpdate(colorUpdates);
    if (res?.sent) {
      this.status?.onHubPacketSent(this.hub.id);
    }
  }
}



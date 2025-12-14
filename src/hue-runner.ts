import {v3} from 'node-hue-api';
import {Api} from 'node-hue-api/dist/esm/api/Api';
import {HueDtlsController, ColorUpdate} from './hue-dtls';
import {DmxLight, LIGHT_MODES} from './DmxLight';
import {ArtDmx} from 'artnet-protocol/dist/protocol';
import {HubConfig, LightConfiguration} from './config';
import {RuntimeStatus} from './runtime-status';

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
      entertainmentRoomId: hub.entertainmentRoomId,
    });
  }

  get id() {
    return this.hub.id;
  }

  get artNetUniverse() {
    return this.hub.artNetUniverse;
  }

  async start() {
    if (!this.hub.entertainmentRoomId) {
      throw new Error(`Hub "${this.hub.id}" has no entertainmentRoomId configured`);
    }
    this.status?.setHubStarted(this.hub.id, true);

    this.hueApi = await v3.api.createLocal(this.hub.host).connect(this.hub.username);

    const entertainment = await this.hueApi.groups.getEntertainment();
    const roomId = String(this.hub.entertainmentRoomId);
    const rooms = entertainment.filter(ent => String(ent.id) === roomId);
    if (rooms.length !== 1) {
      throw new Error(`Hub "${this.hub.id}" entertainment room id ${this.hub.entertainmentRoomId} was not found`);
    }

    const room = rooms[0];
    const roomLightIds = [...room.lights];

    const lights: DmxLight[] = [];
    this.hub.lights.forEach((light: LightConfiguration) => {
      const idx = roomLightIds.indexOf(light.lightId);
      if (idx !== -1) {
        roomLightIds.splice(idx, 1);
      }
      lights.push(new LIGHT_MODES[light.channelMode](light.dmxStart, parseInt(light.lightId, 10)));
    });
    if (roomLightIds.length !== 0) {
      throw new Error(
        `Hub "${this.hub.id}" is missing light configuration for: ${roomLightIds.join(', ')}`,
      );
    }
    this.lights = lights;

    this.dtlsController = new HueDtlsController(this.hub.host, this.hub.username, this.hub.clientKey);

    console.log(`[${this.hub.id}] Requesting streaming mode...`);
    const streamingResponse = await this.hueApi.groups.enableStreaming(this.hub.entertainmentRoomId as any);
    console.log(`[${this.hub.id}] Streaming enabled:`, streamingResponse);
    this.status?.setStreamingEnabled(this.hub.id, true);

    console.log(`[${this.hub.id}] Sleeping 1s to give the Hue bridge time to enable streaming mode`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log(`[${this.hub.id}] Performing streaming mode handshake...`);
    await this.dtlsController.connect();
    this.dtlsController.on('connected', () => this.onDtlsConnected());
    this.dtlsController.on('close', () => this.status?.setDtlsConnected(this.hub.id, false));
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
      colorUpdates.push({lightId: light.lightId, color: colors});
    });
    this.dtlsController.sendUpdate(colorUpdates);
    this.status?.onHubPacketSent(this.hub.id);
  }

  async close() {
    const dtls = this.dtlsController;
    this.dtlsController = null;
    const api = this.hueApi;
    this.hueApi = null;

    await Promise.all([dtls ? dtls.close().catch(() => undefined) : Promise.resolve()]);
    if (api && this.hub.entertainmentRoomId) {
      await api.groups.disableStreaming(this.hub.entertainmentRoomId as any);
    }
  }

  private onDtlsConnected() {
    console.log(`[${this.hub.id}] Connected to Hue Entertainment API`);
    this.status?.setDtlsConnected(this.hub.id, true);
    const colorUpdates: ColorUpdate[] = this.lights.map(light => ({lightId: light.lightId, color: [0, 0, 0]}));
    this.dtlsController?.sendUpdate(colorUpdates);
    this.status?.onHubPacketSent(this.hub.id);
  }
}



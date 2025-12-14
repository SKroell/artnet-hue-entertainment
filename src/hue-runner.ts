import {v3} from 'node-hue-api';
import {Api} from 'node-hue-api/dist/esm/api/Api';
import {HueDtlsController, ColorUpdate} from './hue-dtls';
import {DmxLight, LIGHT_MODES} from './DmxLight';
import {ArtDmx} from 'artnet-protocol/dist/protocol';
import {HubConfig, LightConfiguration} from './config';

export class HueEntertainmentRunner {
  private readonly hub: HubConfig;
  private hueApi: Api | null = null;
  private lights: DmxLight[] = [];
  private dtlsController: HueDtlsController | null = null;

  constructor(hub: HubConfig) {
    this.hub = hub;
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

    console.log(`[${this.hub.id}] Sleeping 1s to give the Hue bridge time to enable streaming mode`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log(`[${this.hub.id}] Performing streaming mode handshake...`);
    await this.dtlsController.connect();
    this.dtlsController.on('connected', () => this.onDtlsConnected());
  }

  handleDmx(dmx: ArtDmx) {
    if (dmx.universe !== this.hub.artNetUniverse) {
      return;
    }
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
    const colorUpdates: ColorUpdate[] = this.lights.map(light => ({lightId: light.lightId, color: [0, 0, 0]}));
    this.dtlsController?.sendUpdate(colorUpdates);
  }
}



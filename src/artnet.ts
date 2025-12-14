import {EventEmitter} from 'events';
import {ArtNetController} from 'artnet-protocol/dist';
import {ArtDmx} from 'artnet-protocol/dist/protocol';
import {RuntimeStatus} from './runtime-status';

export class ArtNetDmxSource extends EventEmitter {
  private readonly bindIp: string;
  private controller: ArtNetController | null = null;
  private readonly status?: RuntimeStatus;

  constructor(bindIp: string, status?: RuntimeStatus) {
    super();
    this.bindIp = bindIp;
    this.status = status;
  }

  start() {
    if (this.controller) {
      return;
    }
    this.status?.initArtNet(this.bindIp);
    this.controller = new ArtNetController();
    this.controller.nameLong = 'ArtNet Hue';
    this.controller.nameShort = 'ArtNet Hue';
    this.controller.bind(this.bindIp);
    this.controller.on('dmx', (dmx: ArtDmx) => {
      this.status?.onDmxFrame(dmx.universe);
      this.emit('dmx', dmx);
    });
  }

  async close() {
    if (!this.controller) {
      return;
    }
    const c = this.controller;
    this.controller = null;
    await c.close();
  }
}



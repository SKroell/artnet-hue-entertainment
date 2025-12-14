import {EventEmitter} from 'events';
import {ArtNetController} from 'artnet-protocol/dist';
import {ArtDmx} from 'artnet-protocol/dist/protocol';

export class ArtNetDmxSource extends EventEmitter {
  private readonly bindIp: string;
  private controller: ArtNetController | null = null;

  constructor(bindIp: string) {
    super();
    this.bindIp = bindIp;
  }

  start() {
    if (this.controller) {
      return;
    }
    this.controller = new ArtNetController();
    this.controller.nameLong = 'ArtNet Hue';
    this.controller.nameShort = 'ArtNet Hue';
    this.controller.bind(this.bindIp);
    this.controller.on('dmx', (dmx: ArtDmx) => this.emit('dmx', dmx));
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



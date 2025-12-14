export type HubRuntimeStatus = {
  hubId: string;
  hubName?: string;
  host?: string;
  universe: number;
  entertainmentRoomId?: string;

  started: boolean;
  streamingEnabled: boolean;
  dtlsConnected: boolean;

  lastDmxAt?: number;
  lastSendAt?: number;

  dmxFramesMatched: number;
  updatePacketsSent: number;

  lastError?: string;
};

export type ArtNetRuntimeStatus = {
  bindIp: string;
  lastDmxAt?: number;
  framesTotal: number;
  framesByUniverse: Record<string, number>;
};

export class RuntimeStatus {
  private artnet: ArtNetRuntimeStatus | null = null;
  private hubs: Record<string, HubRuntimeStatus> = {};

  initArtNet(bindIp: string) {
    if (!this.artnet) {
      this.artnet = {bindIp, framesTotal: 0, framesByUniverse: {}};
    } else {
      this.artnet.bindIp = bindIp;
    }
  }

  onDmxFrame(universe: number) {
    if (!this.artnet) return;
    const now = Date.now();
    this.artnet.lastDmxAt = now;
    this.artnet.framesTotal += 1;
    const key = String(universe);
    this.artnet.framesByUniverse[key] = (this.artnet.framesByUniverse[key] ?? 0) + 1;
  }

  upsertHub(base: {hubId: string; hubName?: string; host?: string; universe: number; entertainmentRoomId?: string}) {
    const existing = this.hubs[base.hubId];
    if (existing) {
      existing.hubName = base.hubName;
      existing.host = base.host;
      existing.universe = base.universe;
      existing.entertainmentRoomId = base.entertainmentRoomId;
      return;
    }
    this.hubs[base.hubId] = {
      hubId: base.hubId,
      hubName: base.hubName,
      host: base.host,
      universe: base.universe,
      entertainmentRoomId: base.entertainmentRoomId,
      started: false,
      streamingEnabled: false,
      dtlsConnected: false,
      dmxFramesMatched: 0,
      updatePacketsSent: 0,
    };
  }

  setHubStarted(hubId: string, started: boolean) {
    if (this.hubs[hubId]) this.hubs[hubId].started = started;
  }

  setStreamingEnabled(hubId: string, enabled: boolean) {
    if (this.hubs[hubId]) this.hubs[hubId].streamingEnabled = enabled;
  }

  setDtlsConnected(hubId: string, connected: boolean) {
    if (this.hubs[hubId]) this.hubs[hubId].dtlsConnected = connected;
  }

  onHubDmxMatched(hubId: string) {
    const h = this.hubs[hubId];
    if (!h) return;
    h.lastDmxAt = Date.now();
    h.dmxFramesMatched += 1;
  }

  onHubPacketSent(hubId: string) {
    const h = this.hubs[hubId];
    if (!h) return;
    h.lastSendAt = Date.now();
    h.updatePacketsSent += 1;
  }

  setHubError(hubId: string, err: string) {
    const h = this.hubs[hubId];
    if (!h) return;
    h.lastError = err;
  }

  snapshot() {
    return {
      now: Date.now(),
      artnet: this.artnet,
      hubs: Object.values(this.hubs).sort((a, b) => a.hubId.localeCompare(b.hubId)),
    };
  }
}



import { connect } from '@nodertc/dtls';
import {EventEmitter} from 'events';
import Timeout = NodeJS.Timeout;
import { Socket } from 'net';

const PACKET_HEADER = Buffer.from([0x48, 0x75, 0x65, 0x53, 0x74, 0x72, 0x65, 0x61, 0x6d]);

function assertUuid36(id: string) {
    if (typeof id !== 'string' || id.length !== 36) {
        throw new Error(`entertainmentConfigurationId must be a 36-char UUID, got "${id}"`);
    }
}


export interface ColorUpdate {
    channelId: number;
    color: [number, number, number];
}


export class HueDtlsController extends EventEmitter {

    private readonly host: string;
    private readonly pskIdentity: string;
    private readonly clientKey: string;
    private readonly entertainmentConfigurationId: string;
    private readonly port = 2100;

    private socket: Socket | null = null;

    private opened = false;
    private skip = false;

    private lastUpdate: ColorUpdate[] | null = null;
    private lastUpdateTimestamp: Date | null = null;
    private updateKeepaliveTimeout: Timeout | null = null;
    private lastPacketSentAtMs: number = 0;
    private readonly minIntervalMs: number = 40;

    constructor(host: string, pskIdentity: string, clientKey: string, entertainmentConfigurationId: string) {
        super();
        this.host = host;
        this.pskIdentity = pskIdentity;
        this.clientKey = clientKey;
        assertUuid36(entertainmentConfigurationId);
        this.entertainmentConfigurationId = entertainmentConfigurationId;
    }

    async connect() {
        const dtlsConfig: any = {
            type: 'udp4',
            remotePort: this.port,
            remoteAddress: this.host,
            maxHandshakeRetransmissions: 4,
            pskIdentity: this.pskIdentity,
            pskSecret: Buffer.from(this.clientKey, 'hex'),
            cipherSuites: ['TLS_PSK_WITH_AES_128_GCM_SHA256'],
        };

        const socket = await connect(dtlsConfig);
        socket.once('connect', () => {
            this.opened = true;
            this.emit('connected');
        });
        socket.on('close', () => {
            console.log("UDP Stream closed, closing connection.");
            this.close();
        });

        socket.on('error', (err: any) => {
            console.log("UDP Stream interrupted, closing connection.\n", err);
            this.emit('error', err);
            this.close();
        });

        this.updateKeepaliveTimeout = setInterval(this.updateKeepalive.bind(this), 1000);

        this.socket = socket;
    }

    public async close() {
        if (!this.opened) {
            return;
        }
        this.opened = false;
        await new Promise(resolve => this.socket?.end(() => resolve(undefined)));
        this.emit('close');
    }

    public sendUpdate(updates: ColorUpdate[]) : {sent: true} | {sent: false; reason: 'not_open' | 'skipped' | 'throttled'} {
        if (this.socket === null || !this.opened) {
            return {sent: false, reason: 'not_open' as const};
        }
        if (this.skip) {
            this.skip = false;
            return {sent: false, reason: 'skipped' as const};
        }

        //Skip every other update to reduce the amount of data sent to the bridge, removed for now
        //this.skip = true;
        this.lastUpdate = updates;
        this.lastUpdateTimestamp = new Date();

        // TODO: Perhaps validate the input?
        const now = Date.now();
        if (this.lastPacketSentAtMs && now - this.lastPacketSentAtMs < this.minIntervalMs) {
            return {sent: false, reason: 'throttled' as const};
        }

        const ok = this.sendUpdatePacket(updates);
        if (ok) {
            this.lastPacketSentAtMs = now;
            return {sent: true as const};
        }
        return {sent: false, reason: 'not_open' as const};
    }

    private updateKeepalive() {
        if (this.lastUpdateTimestamp !== null && Date.now() - this.lastUpdateTimestamp.getTime() <= 2000) {
            return;
        }

        if (this.lastUpdate) {
            this.sendUpdatePacket(this.lastUpdate);
        }
    }

    private sendUpdatePacket(updates: ColorUpdate[]) {
        // Hue Entertainment v2 format:
        // 16-byte header + 36-byte entertainment_configuration UUID + N*(1-byte channel id + 3*2-byte RGB16)
        const message = Buffer.alloc(16 + 36 + (updates.length * 7), 0x00);
        PACKET_HEADER.copy(message, 0);
        message.writeUInt8(2, 9);  // Major version
        message.writeUInt8(0, 10);  // Minor version
        message.writeUInt8(0, 11);  // Sequence. This is currently ignored
        message.writeUInt16BE(0, 12);  // Reserved
        message.writeUInt8(0, 14);  // Color space RGB
        message.writeUInt8(0, 15);  // Reserved

        message.write(this.entertainmentConfigurationId, 16, 36, 'ascii');

        let offset = 16 + 36;
        updates.forEach(update => {
            message.writeUInt8(update.channelId & 0xff, offset);  // Channel ID
            message.writeUInt16BE(update.color[0], offset + 1);  // R
            message.writeUInt16BE(update.color[1], offset + 3);  // G
            message.writeUInt16BE(update.color[2], offset + 5);  // B
            offset += 7;
        });

        // console.log(message.toString('hex').match(/../g)!.join(' '));

        if (this.opened) {
            this.socket?.write(message);
            return true;
        }
        return false;
    }
}

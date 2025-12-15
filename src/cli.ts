#!/usr/bin/env node
import * as minimist from 'minimist';
import {v3, discovery, ApiError} from 'node-hue-api';
import {ConfigStore, getHubOrThrow, HubConfig, ChannelConfiguration, makeHubId} from './config';
import {ArtNetDmxSource} from './artnet';
import {HueEntertainmentRunner} from './hue-runner';
import {startWebUi} from './web/server';
import {RuntimeStatus} from './runtime-status';
import {connectHueApi} from './hue-api';
import {listEntertainmentConfigurations} from './hue-v2';
const LightState = v3.lightStates.LightState;

class ArtNetHueEntertainmentCliHandler {

    private readonly args: string[];
    private readonly store = new ConfigStore();

    constructor(args: string[]) {
        this.args = args;
    }

    async run() {
        const config = await this.store.load();

        if (this.args.length === 0) {
            this.printHelp();
            return;
        }

        if (this.args[0] === 'discover') {
            await this.discoverBridges();
        } else if (this.args[0] === 'pair') {
            await this.runPair(config, this.args.slice(1));
        } else if (this.args[0] === 'run') {
            await this.startProcess(config, this.args.slice(1));
        } else if (this.args[0] === 'list-rooms') {
            await this.listEntertainmentRooms(config, this.args.slice(1));
        } else if (this.args[0] === 'ping-light') {
            await this.pingLight(config, this.args.slice(1));
        } else if (this.args[0] === 'ping-lights') {
            await this.pingLight(config, ["--id", "all"]);
        } else if (this.args[0] === 'list-lights') {
            await this.listAllLights(config, this.args.slice(1));
        } else if(this.args[0] === 'rename-lights-after-id' ){
            await this.renameLightsAfterID(config, this.args.slice(1));
        } else if(this.args[0] === 'auto-setup') {
            await this.autoSetup(config, this.args.slice(1));
        } else if (this.args[0] === 'web') {
            const args = minimist(this.args.slice(1), {default: {port: 8787}});
            const port = Number(args.port) || 8787;
            await startWebUi({port});
        } else {
            this.printHelp();
            return;
        }
    }

    async autoSetup(config: any, argv: string[]) {
        const args = minimist(argv, {string: ['hub']});
        const hub = getHubOrThrow(config, args.hub);

        const configs = await listEntertainmentConfigurations({host: hub.host, appKey: hub.username});
        if (!configs.length) {
            console.error('No entertainment configurations found on this hub.');
            process.exit(1);
        }

        if (!hub.entertainmentConfigurationId) {
            hub.entertainmentConfigurationId = configs[0].id;
        }
        const cfg = configs.find(c => c.id === hub.entertainmentConfigurationId) ?? configs[0];
        hub.entertainmentConfigurationId = cfg.id;

        const sortedChannels = cfg.channelIds.map((channelId, index) => {
            return {
                channelId: Number(channelId),
                dmxStart: 3 * (index) + 1,
                channelMode: "8bit",
            }
        });

        console.log('Setting up lights...');
        console.log(sortedChannels);

        hub.channels = sortedChannels as any;
        await this.store.save(config);
    }

    printHelp() {
        console.log('Usage: artnet-hue-entertainment <discover|pair|run|list-rooms|list-lights|ping-light|ping-lights|auto-setup|rename-lights-after-id|web> [options]');
        console.log('');
        console.log('Control Philips/Signify Hue lights using ArtNet.');
        console.log('');
        console.log('Subcommands:');
        console.log('  discover                Discover all Hue bridges on your network. When you know the IP address of the bridge, run \'pair\' directly.');
        console.log('  pair                    Pair with a Hue bridge. Press the link button on the bridge before running');
        console.log('    --ip                  The IP address of the Hue bridge. Both IPv4 and IPv6 are supported.');
        console.log('    --name                Optional friendly name for this hub.');
        console.log('  ping-light              Indicated a light.');
        console.log('    --id                  The id of the light to indicate. If the is "all" then all lights will be indicated.');
        console.log('    --hub                 Hub id (defaults to first configured hub).');
        console.log('  list-rooms              List all available entertainment rooms.');
        console.log('  list-lights             List all available lights.');
        console.log('  rename-lights-after-id  Renames every light after it`s id.');
        console.log('  run                     Run the ArtNet to Hue bridge.');
        console.log('    --hub                 Hub id (defaults to all hubs).');
        console.log('    --web                 Also start the web UI in the same process.');
        console.log('    --web-port            Web UI port when used with run (default 8787).');
        console.log('  web                     Start a local web UI for configuring hubs.');
        console.log('    --port                Port for the web UI (default 8787).');
        process.exit(1);
    }

    async runPair(config: any, argv: string[]) {
        const args = minimist(argv, {
            string: ['ip', 'name'],
        });

        if (!('ip' in args) || args.ip.length === 0) {
            this.printHelp();
            process.exit(1);
            return;
        }

        try {
            const host: string = String(args.ip);
            const api = await connectHueApi({host});
            const user = await api.users.createUser('artnet-hue-entertainment', 'cli');
            if (!user.clientkey) {
                throw new Error('Pairing did not return a client key. Is your bridge updated for Entertainment streaming?');
            }

            let bridgeName: string | undefined = args.name;
            let bridgeId: string | undefined = undefined;
            try {
                const authApi = await connectHueApi({host, username: user.username});
                // node-hue-api exposes configuration on v3
                const cfg: any = await (authApi as any).configuration.getConfiguration();
                bridgeName = bridgeName ?? cfg?.name;
                bridgeId = cfg?.bridgeid;
            } catch {
                // ignore - pairing still succeeded
            }

            const hubId = makeHubId({bridgeId, host, name: bridgeName});
            const hub: HubConfig = {
                id: hubId,
                name: bridgeName,
                host,
                username: user.username,
                clientKey: user.clientkey,
                entertainmentConfigurationId: undefined,
                artNetUniverse: (config.hubs?.[0]?.artNetUniverse ?? 11),
                channels: [],
            };

            config.version = 3;
            config.artnet = config.artnet ?? {bindIp: '0.0.0.0'};
            config.hubs = Array.isArray(config.hubs) ? config.hubs : [];

            const existingIdx = config.hubs.findIndex((h: HubConfig) => h.id === hubId);
            if (existingIdx !== -1) {
                config.hubs[existingIdx] = hub;
            } else {
                config.hubs.push(hub);
            }
            await this.store.save(config);

            console.log(`Hue setup was successful! Added hub "${hubId}".`);
            console.log('Next: choose an entertainment configuration (list-rooms) and configure channels (auto-setup or web UI).');

        } catch (e) {
            const error = e as ApiError;
            let hue_error = error.getHueError();
            if (hue_error !== undefined) {
                console.error('Error while pairing:', hue_error.message);
                process.exit(1);
            }
            throw e;
        }
    }

    async discoverBridges() {
        console.log('Discovering bridges...');
        discovery.nupnpSearch().then(results => {
            if (results.length === 0) {
                console.log('No bridges found.');
                return;
            }
            console.log('Found bridges:');
            results.forEach(bridge => {
                console.log(` - ${bridge.ipaddress}: ${bridge.config?.name}`);
            });
            console.log('');
            console.log('To use any of these bridges, press the link button on the bridge and run:');
            console.log('$ artnet-hue-entertainment pair --ip <ip address>');
        });
    }

    async startProcess(config: any, argv: string[]) {
        const args = minimist(argv, {string: ['hub'], boolean: ['web'], default: {'web-port': 8787}});
        const startWeb = !!args.web;
        const webPort = Number(args['web-port']) || 8787;
        const hubs: HubConfig[] = Array.isArray(config.hubs) ? config.hubs : [];
        if (hubs.length === 0) {
            console.log('No Hue hub is paired yet. Please pair a hub first');
            return;
        }

        const selectedHubs = args.hub ? [getHubOrThrow(config, args.hub)] : hubs;

        selectedHubs.forEach(hub => {
            if (!hub.host || !hub.username || !hub.clientKey) {
                console.error(`Hub "${hub.id}" is missing credentials. Pair it again.`);
                process.exit(1);
            }
            if (!hub.entertainmentConfigurationId) {
                console.error(`Hub "${hub.id}" has no entertainment configuration configured. Run list-rooms and set entertainmentConfigurationId (or use the web UI).`);
                process.exit(1);
            }
            if (!Array.isArray(hub.channels) || hub.channels.length === 0) {
                console.error(`Hub "${hub.id}" has no channels configured. Run auto-setup (or use the web UI).`);
                process.exit(1);
            }
            if (hub.channels.some((ch: ChannelConfiguration) => ch.channelMode === undefined || (ch.channelMode !== "8bit" && ch.channelMode !== "8bit-dimmable" && ch.channelMode !== "16bit"))) {
                const ch = hub.channels.find((ch: ChannelConfiguration) => ch.channelMode === undefined || (ch.channelMode !== "8bit" && ch.channelMode !== "8bit-dimmable" && ch.channelMode !== "16bit"));
                console.error(`Invalid channel mode in configuration (hub ${hub.id}, channelId ${ch!.channelId}). Valid values are: 8bit, 8bit-dimmable, 16bit`);
                process.exit(1);
            }
        });

        const status = new RuntimeStatus();
        const bindIp = config.artnet?.bindIp ?? '0.0.0.0';
        const dmxSource = new ArtNetDmxSource(bindIp, status);
        dmxSource.start();

        const runners = selectedHubs.map(h => new HueEntertainmentRunner(h, status));
        await Promise.all(runners.map(r => r.start()));
        const runnersById: Record<string, HueEntertainmentRunner> = {};
        for (const r of runners) {
            runnersById[r.id] = r;
        }

        dmxSource.on('dmx', (dmx: any) => {
            for (const runner of runners) {
                runner.handleDmx(dmx);
            }
        });

        if (startWeb) {
            await startWebUi({
                port: webPort,
                statusProvider: () => status.snapshot(),
                runtimeCommands: {
                    sendSolidColor: (hubId: string, rgb16: [number, number, number]) => {
                        const runner = runnersById[hubId];
                        if (!runner) {
                            return {sent: false as const, reason: 'unknown_hub' as const};
                        }
                        return runner.sendSolidColor(rgb16 as any);
                    }
                }
            } as any);
        }

        const shutdownHandler = () => {
            process.off('SIGINT', shutdownHandler);
            console.log('Received shutdown signal. Closing Hue connections...');
            Promise.all([
                ...runners.map(r => r.close().catch(() => undefined)),
                dmxSource.close().catch(() => undefined),
            ]).then(() => process.exit(0));
        };
        process.on('SIGINT', shutdownHandler);
    }

    async listEntertainmentRooms(config: any, argv: string[]) {
        const args = minimist(argv, {string: ['hub']});
        const hub = getHubOrThrow(config, args.hub);
        const rooms = await listEntertainmentConfigurations({host: hub.host, appKey: hub.username});
        console.log(`Available entertainment configurations (hub ${hub.id}):`);
        rooms.forEach(r => {
            console.log(` - ${r.id}: ${r.name ?? '(no name)'} (Channels: ${r.channelIds.join(', ')})`);
        });
    }

    async listAllLights(config: any, argv: string[]) {
        const args = minimist(argv, {string: ['hub']});
        const hub = getHubOrThrow(config, args.hub);

        const hueApi = await connectHueApi({host: hub.host, username: hub.username});

        const rooms = await hueApi.lights.getAll();
        const lightsCleaned = rooms.map(r => {
            return " - Light " + r.id + ": " + r.name
        })
        console.log(`Available lights (hub ${hub.id}):`);
        lightsCleaned.forEach(light => {
            console.log(light);
        })
    }

    async renameLightsAfterID(config: any, argv: string[]) {
        const args = minimist(argv, {string: ['hub']});
        const hub = getHubOrThrow(config, args.hub);

        const hueApi = await connectHueApi({host: hub.host, username: hub.username});

        const allLights = await hueApi.lights.getAll();
        for (const lightType of allLights) {
            const newName = `Light ${lightType.id}`;

            if(lightType.name == newName){
                console.log(`Light ${lightType.id} already has the correct name.`);
                continue;
            }
            console.log(`Renaming light ${lightType.name} to Light ${lightType.id}`);
            lightType.name = "Light " + lightType.id;
            await hueApi.lights.renameLight(lightType as unknown as any);
        }
    }

    async pingLight(config: any, argv: string[]) {
        const args = minimist(argv, {
            string: ['id', 'hub'],
        });

        if (!('id' in args) || args.id.length === 0) {
            this.printHelp();
            process.exit(1);
            return;
        }

        const lightId: string | number = args.id;

        const hub = getHubOrThrow(config, args.hub);
        const hueApi = await connectHueApi({host: hub.host, username: hub.username});

        if(lightId === "all"){
            const timer = (ms: number | undefined) => new Promise(res => setTimeout(res, ms))
            const allLights = await hueApi.lights.getAll();

            for (const light of allLights) {
                try {
                    await hueApi.lights.setLightState(light.id,
                      new LightState()
                        .alert()
                        .alertShort()
                    );
                }catch (e: any){
                    console.error('Error while pinging light:', e.message);
                    process.exit(1);
                }

                console.log(`Light ${light.id} pinged.`);
                await timer(1500);
            }
        }else{
            try {
                await hueApi.lights.setLightState(lightId,
                  new LightState()
                    .alert()
                    .alertShort()
                );
            }catch (e: any){
                console.error('Error while pinging light:', e.message);
                process.exit(1);
            }

            console.log(`Light ${lightId} pinged.`);
        }
    }
}

const handler = new ArtNetHueEntertainmentCliHandler(process.argv.slice(2));
handler.run();

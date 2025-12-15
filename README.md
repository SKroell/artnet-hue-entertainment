# ArtNet Hue Entertainment

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.txt)

__Note: This package is still work in progress!__

In short: an ArtNet controller for the new Hue Entertainment API,
giving near-realtime control of Hue lights.

The well-known Philips/Signify Hue API only allows for about 10 updates per second.
If you want to update multiple lights multiple times per second this approach will not scale.
To make this practical, all color transitions will need to be done inside the Hue bulb.
This complicates light programming, as Hue bulbs can not be used as any other RGB DMX light.
As this is the only well-known Hue API, this is what most other Hue ArtNet bridges use.

Since the introduction of the Hue Sync Box, a new API is available allowing up to
25 updates per second for up to 10 lights. This gives us almost real-time control over
lights, even with perfect synchronization between the lights.
This is called the Hue Entertainment API.

To accomplish this, the Hue Bridge sends the entire update packet, which contains
color information for all bulbs in the Entertainment area, to a 'Proxy' bulb.
This is a bulb that is elected by the Hue bridge to be near all other bulbs in the
Entertainment area. It will receive the full color update for all bulbs and it will
broadcast the message so all bulbs receive it. Then every individual bulb will only
take it's own color from the update message and apply it.
This accomplishes near-perfect synchronization.

Please note that only original Philips/Signify Hue color bulbs are supported.
This means Ikea Tradfri bulbs can not be used, neither can Hue white bulbs.
This is a limitation in the protocol and can not be worked around.

If you need to support non-color or non-Hue bulbs as well, you should check out
another project which talks to the normal Hue API, such as [Dmx-Hue](https://github.com/sinedied/dmx-hue).

## Setting up

## Build

```bash
npm install
npm run build
```


## Configuration

Before configuring this project:
1. In the Philips Hue app, create an **Entertainment area** (`Settings > Entertainment rooms`).
2. Ensure the area has lights assigned (placement is ignored by this project).

### Configuration (Web UI)
1. Start the web UI:

```bash
npm run start:web
```

2. In the UI:
   - Use **Discover** to find hubs on your network
   - Use **Pair** to connect (press the link button on the hub first)

3. For each hub:
   - Select an **entertainment configuration UUID**
   - Map DMX to **channel ids** (auto-map buttons available)

4. Run:

```bash
npm run start
```

Optional: run + web dashboard (recommended while debugging):

```bash
npm run start:runweb
```

### Configuration (CLI-only)
1. Discover Hue bridges:

```bash
npm run start:discover
```

2. Pair one or more bridges (press the link button first):

```bash
node build/cli.js pair --ip <ip address of bridge>
```

3. List entertainment configurations (UUIDs) for a hub:

```bash
node build/cli.js list-rooms --hub <hub id>
```

4. Choose a configuration and map DMX channels:
   - Quick setup: run auto-setup (sequential RGB mapping):

```bash
node build/cli.js auto-setup --hub <hub id>
```

   - Or edit `config.json` manually:
     - Set `hubs[].entertainmentConfigurationId` to the chosen UUID
     - Configure `hubs[].channels[]` with `channelId`, `dmxStart`, `channelMode`

5. Run:

```bash
npm run start
```

## Multiple Hue hubs (multiple entertainment areas)

Hue only allows one active streaming entertainment session per hub. If you want to run multiple
entertainment areas at the same time, you need multiple hubs.

This project supports **multiple hubs at once**:
- One shared Art-Net listener (UDP/6454) is started.
- Each configured hub streams to its own entertainment configuration (UUID).
- You can assign each hub its own Art-Net universe (recommended) to keep mappings separate.

## Config format (v3)

This project uses Hue CLIP v2 entertainment configurations:
- `entertainmentConfigurationId`: the **UUID** of the entertainment configuration on the hub
- `channels[]`: DMX mapping by **entertainment channel id** (0..), not Hue light id

## Channel modes
DMX channel mode can be configured for every Hue light that is controlled.
The following 3 modes are supported:
1. `8bit` - 3 channels (R, G, B)
2. `8bit-dimmable` - 4 channels (Dim, R, G, B). This is the recommended mode,
   as Hue bulbs are controlled with 16 bit values. Color mixing is smooth even
   on the lowest dimmer setting.
3. `16bit` - 6 channels (R, R fine, G, G fine, B, B fine). As Hue bulbs are
   controlled with 16 bit values this gives full raw control over the bulbs.

## Protocol documentation
* Hue Entertainment: https://developers.meethue.com/develop/hue-entertainment/philips-hue-entertainment-api/
* ArtNet: https://artisticlicence.com/WebSiteMaster/User%20Guides/art-net.pdf

## Disclaimer
By using ArtNet-Hue-Entertainment you are in full control of the light that your bulbs output.
Some light combinations and/or frequencies, etc. could cause epileptic seizures, migraines etc.
to an end user, even if that person has no history of prior seizures or epilepsy etc.
By taking full control over the lights you are responsible for preventing such adverse
health effects. The maintainers of this repository are not responsible for any adverse health effects etc.

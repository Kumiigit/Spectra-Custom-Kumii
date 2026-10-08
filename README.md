# Custom Spectra Frontend

A custom broadcast overlay for VALORANT tournaments, built on the
[ValoSpectra frontend](https://github.com/ValoSpectra/Spectra-Frontend). This
version includes a redesigned match header, player cards, pause banners, buy
phase, sponsor area, and supporting broadcast states.

> **Modified software:** This repository contains substantial visual and layout
> modifications to the original ValoSpectra frontend. It is not the official
> ValoSpectra distribution.

## Requirements

- Node.js 20 or newer
- Corepack/Yarn 4
- A running [Spectra Server](https://github.com/ValoSpectra/Spectra-Server) for
  live match data

## Local development

```bash
corepack enable
yarn install
yarn start
```

Open `http://localhost:4200/testing` to preview the overlay with sample data.
The live overlay is available at `http://localhost:4200/overlay`.

Assets, fonts and language files are included. For HP preview use
`yarn start --port 3000 --host 127.0.0.1` and open `/hp-reader/dual.html`.
See [HP reader setup](public/hp-reader/README.md) for remote observer pairing.
Recordings and built installers are intentionally excluded from Git.

## Production build

```bash
yarn build
```

The compiled application is written to `dist/spectra-frontend`.

## Configuration

Runtime settings live in `public/assets/config/config.json`. Set
`serverEndpoint` to the address of your Spectra Server and replace the sample
sponsor assets and colours as needed.

Never commit private player-camera credentials, API keys, or production secrets.

## Main routes

| Route | Purpose |
| --- | --- |
| `/overlay` | Live match overlay |
| `/testing` | Match overlay with sample data |
| `/agent-select` | Agent-select overlay |
| `/timeout` | Timeout and technical-pause overlay |
| `/mapban` | Map-ban overlay |
| `/team-breakdown` | Team breakdown |
| `/map-breakdown` | Map breakdown |

## Upstream and licence

This project is derived from
[ValoSpectra/Spectra-Frontend](https://github.com/ValoSpectra/Spectra-Frontend)
and retains its Elastic License 2.0 terms. See [LICENSE.md](LICENSE.md).

Elastic License 2.0 is source-available but is not an OSI-approved open-source
licence. In particular, it restricts offering the software as a hosted or
managed service. Read the licence before redistributing or deploying it.

## Riot Games disclaimer

This project is not endorsed by Riot Games and does not reflect the views or
opinions of Riot Games or anyone officially involved in producing or managing
Riot Games properties. Riot Games, VALORANT, and all associated properties are
trademarks or registered trademarks of Riot Games, Inc.

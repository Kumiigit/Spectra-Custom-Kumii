# Experimental observer HP reader

Estimates ten players' HP from native VALORANT top bars. Requires a HUD-enabled
observer and centered 16:9 gameplay with a matching native HUD layout. Exact
player-name bindings are manual and must be verified after side swaps. Deaths
and round lifecycle come from Spectra, not missing pixels. No game memory or
private game API is used.

## Local setup

Run `yarn install`, then `yarn start --port 3000 --host 127.0.0.1`.
Open `/hp-reader/dual.html` in Chrome or Edge; select a game window, bind player
names and start readers. Use `/overlay?groupCode=YOUR_GROUP&hpReader=1` on the
host to enable HP overrides and publish Spectra lifecycle state.

The 5v5 preset reads ten fixed slots; the 1v1 preset reads two. For offline tests,
choose your own compatible H.264 video using **Other video**. The supplied replay
and demo buttons require a local recording under `replays/`, not included in Git.
The `HP-PREVIEW` demo uses sample names/agents with all players alive, not a full
match simulator. The older bottom-digit page is a separate experiment, not an
automatic fallback for this reader.

## Radmin VPN host

Both PCs join the same private Radmin network. Start the host receiver with:

```powershell
.\scripts\start-vpn-preview.ps1 -VpnIP YOUR_RADMIN_IPV4 -GroupCode YOUR_GROUP
```

The host listens locally on 5210 and on the supplied VPN IPv4 on 5211. The terminal
prints a new pairing key and receiver URL. The updated Spectra desktop client's
More / Overlay Preview panel displays them via local-only `/hp/pairing`.
Spectra desktop client source is maintained separately from this repository.

Allow inbound TCP 5211 only from the observer's VPN IP on the Radmin interface.
Do not disable your firewall or expose this HTTP receiver publicly. Share the
key privately; it is match-scoped, held in memory and changes on host restart.
Remote clients can submit HP and read their match lifecycle, not alter deaths
or rounds, list other matches, or retrieve pairing keys.

## Windows observer client

```sh
cd ocr-client
npm ci
npm run build
```

The unsigned experimental Windows installer is produced in
`public/hp-reader/downloads/desktop/`. It includes its own runtime, window,
capture picker and pairing screen. No separate browser, terminal or Node install
is needed by the observer. An automatically selected internal port avoids clashes.
Enter the host URL, group and pairing key, then select the HUD-enabled game
window and bind player names. Only numeric readings are sent, not video.

`node scripts/ocr-observer.cjs` provides a legacy localhost browser host on 5212.
`scripts/package-ocr-observer.ps1` packages that alternative with Node.

## Limitations and tests

HP is approximate, with several HP per pixel at common resolutions. The detector
uses bar shape, contrast and multi-row boundaries. Trackers require consecutive
confirmation, anchor a four-HP deadband, and require stronger confirmation for
increases. Unknown frames hold the last confirmed reading (amber = stale), which
can miss damage or healing. Spectra death/round changes reset held readings.
After reader disconnection, overrides expire after five seconds and the overlay
falls back to Spectra, not a verified visual reading. Stop competing readers.

```sh
node scripts/test-hp-reader.mjs
node scripts/test-observer-bars.mjs
node scripts/test-hp-bridge.cjs
node scripts/test-hp-vpn.cjs
```

Replay benchmarks: `node scripts/analyze-hp-replay.mjs <ffmpeg> <video> --phases`.
Known-HP assertions in replay regression scripts are specific to the local test
recording. Synthetic tests do not establish accuracy in every live game state.

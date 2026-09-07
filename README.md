# IPTV Player for TizenBrew

A clean, remote-first IPTV player designed as a TizenBrew application module.

## Features

- Xtream Codes / Xtream `player_api.php` live-TV login
- M3U/M3U8 playlist URL support
- Multiple saved playlists
- Favourites
- Playlist categories
- XMLTV EPG URL support
- Xtream short EPG support
- Manual playlist and EPG refresh
- Per-playlist automatic refresh intervals
- Samsung remote-first D-pad navigation
- Channel Up/Down
- Number-key channel selection
- Play/Pause/Stop/Rewind/Fast Forward keys
- Red = Favourite
- Green = Settings
- Yellow = Search
- Blue = Refresh
- Local persistence using `localStorage`
- No framework or external JavaScript dependencies

## Important TizenBrew limitation

This is deliberately a **TizenBrew web application**, not a native `.wgt`.

TizenBrew application modules are served as web pages. Native Samsung AVPlay is not assumed to be available in that environment. Playback therefore uses the TV's HTML5 media element. This avoids pretending that a TizenBrew module has native AVPlay access.

Samsung documents AVPlay as the preferred native Smart TV playback API for installed Tizen applications, while TizenBrew modules run as hosted web pages. If you require AVPlay-only formats/DRM, this module should instead be converted to a native Tizen WGT.

## TizenBrew key registration

The manifest intentionally registers only the Samsung media keys that are safe to
register through `TVInputDevice`. TizenBrew's `keys` field is passed to that API,
so normal navigation keys and Back/Return are handled by the page and are not
listed in the manifest.

This follows the structure used by current working TizenBrew application modules.

## Installation

TizenBrew application modules are npm packages.

1. Create a public GitHub repository and copy these files into it.
2. Publish the package to npm:
   `npm publish --access public`
3. In TizenBrew on the TV, use the module installer and add the npm package name.
4. Launch `IPTV Player`.

You can also test the web UI locally in a normal browser.

## Compatibility reality

No IPTV application can honestly guarantee that **every** IPTV stream will play. A TV's browser/firmware has a finite codec and container set, and IPTV providers can return malformed streams, unsupported codecs, expired tokens, geo-blocked streams, TLS failures, or streams that require custom headers.

This project is structured to maximise TizenBrew compatibility and to fail gracefully rather than claiming universal stream support.

## CORS

The browser must be allowed to fetch a playlist/EPG URL. If an IPTV provider blocks browser CORS requests, the TV cannot read that M3U/XMLTV document directly. The actual media URL can still sometimes play because media playback has different browser rules.

For providers that block CORS, the next production step is a small user-controlled proxy/relay. Do not use an unknown public proxy with IPTV credentials.

## GitHub

Suggested repository name:

`tizenbrew-iptv-player`

The repository itself does not contain any IPTV credentials or channels.

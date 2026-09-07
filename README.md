# TizenTivi

TizenBrew IPTV player module supporting Xtream Codes, M3U/M3U8 playlists, favourites and XMLTV/Xtream EPG.

This remains a TizenBrew web application module, not a native `.wgt`.

## Remote

Arrow keys, Enter and Back are handled by the page. TizenBrew registers only the extra media keys in `package.json`.

## Scale

The channel list uses windowed rendering: only a small number of channel cards are kept in the DOM while the selected index can move through tens of thousands of channels. This is important for Samsung TV browser performance.

## Notes

Playback is HTML5 video in TizenBrew. Codec/container, provider headers, CORS and DRM support depend on the TV/browser and stream.

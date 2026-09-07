# TizenTivi v1.7.0

TizenBrew IPTV application module.

## v1.7 fixes
- Main TV interface is locked to the viewport; the browser/page cannot scroll.
- Video player and category sidebar remain fixed.
- Channel grid is a fixed viewport with virtualized/windowed channel rendering.
- D-pad navigation advances through every channel row without moving the page.
- Removed `scrollIntoView()` from remote focus handling because it could scroll the parent TV layout.
- Preserves v1.6 streaming, Xtream Codes, M3U/M3U8, search, favourites and fullscreen functionality.

This is a TizenBrew module, not a native Samsung `.wgt` application.

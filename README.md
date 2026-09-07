# TizenTivi v1.4.0

TizenBrew IPTV application module. This is not a native WGT.

## Remote rebuild

Samsung mandatory keys are intentionally NOT registered in package.json:
ArrowLeft, ArrowUp, ArrowRight, ArrowDown, Enter and Back.

The module listens for `keydown` at window, document and body in capture mode. A visible diagnostic line reports every received key and keyCode. The selected control gets a bright outline.

The channel renderer only keeps a small window of channel cards in the DOM, so large playlists do not create tens of thousands of DOM nodes.

## First test

When the module launches, SETTINGS is selected. Press LEFT and RIGHT. The white outline must move and the diagnostic line must change. Press DOWN and continue with the D-pad. Press OK on SETTINGS to open the test settings screen.

Samsung documents Arrow/Enter/Back as automatically detected keys and recommends handling them from keydown; registered keys are only needed for additional keys. See Samsung Remote Control documentation.

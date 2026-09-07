(function () {
    'use strict';

    /*
     * ============================================================
     * TIZENBREW / SAMSUNG REMOTE DIAGNOSTIC
     * ============================================================
     *
     * This file intentionally does NOT load the IPTV application.
     *
     * Its only job is to determine whether the Samsung remote
     * events are reaching the TizenBrew web application.
     *
     * Test:
     *   UP
     *   DOWN
     *   LEFT
     *   RIGHT
     *   ENTER / OK
     *   BACK
     *   0-9
     *   CHANNEL UP / DOWN
     *   MEDIA buttons
     *   RED / GREEN / YELLOW / BLUE
     *
     * ============================================================
     */

    var lastEvent = {
        type: 'NONE',
        key: '-',
        keyCode: '-',
        which: '-',
        keyName: '-',
        time: '-'
    };

    var eventCount = 0;
    var keyDownCount = 0;
    var hardwareCount = 0;

    var registeredKeys = [];
    var tizenAvailable = false;
    var tvInputAvailable = false;

    var startTime = Date.now();

    /*
     * ------------------------------------------------------------
     * KEY CODE MAP
     * ------------------------------------------------------------
     */

    var KEY_CODES = {
        13: 'Enter',

        37: 'ArrowLeft',
        38: 'ArrowUp',
        39: 'ArrowRight',
        40: 'ArrowDown',

        27: 'Escape',
        10009: 'Back',
        10182: 'Exit',

        48: '0',
        49: '1',
        50: '2',
        51: '3',
        52: '4',
        53: '5',
        54: '6',
        55: '7',
        56: '8',
        57: '9',

        415: 'MediaPlay',
        19: 'MediaPause',
        10252: 'MediaPlayPause',
        413: 'MediaStop',

        412: 'MediaRewind',
        417: 'MediaFastForward',

        10232: 'MediaTrackPrevious',
        10233: 'MediaTrackNext',

        427: 'ChannelUp',
        428: 'ChannelDown',

        403: 'ColorF0Red',
        404: 'ColorF1Green',
        405: 'ColorF2Yellow',
        406: 'ColorF3Blue',

        18: 'Menu',
        457: 'Info',
        10072: 'Source',
        458: 'Guide',
        10225: 'Search',

        447: 'VolumeUp',
        448: 'VolumeDown',
        449: 'VolumeMute'
    };

    /*
     * ------------------------------------------------------------
     * HELPERS
     * ------------------------------------------------------------
     */

    function codeToName(code) {
        code = Number(code || 0);

        if (KEY_CODES[code]) {
            return KEY_CODES[code];
        }

        return '-';
    }

    function safeString(value) {
        if (value === null || typeof value === 'undefined') {
            return '-';
        }

        return String(value);
    }

    function nowTime() {
        var d = new Date();

        function pad(n) {
            return n < 10 ? '0' + n : String(n);
        }

        return (
            pad(d.getHours()) +
            ':' +
            pad(d.getMinutes()) +
            ':' +
            pad(d.getSeconds())
        );
    }

    /*
     * ------------------------------------------------------------
     * BUILD DIAGNOSTIC SCREEN
     * ------------------------------------------------------------
     */

    function createScreen() {
        document.body.innerHTML = '';

        document.body.style.margin = '0';
        document.body.style.padding = '0';
        document.body.style.background = '#050505';
        document.body.style.color = '#ffffff';
        document.body.style.fontFamily =
            'Arial, Helvetica, sans-serif';
        document.body.style.overflow = 'hidden';

        document.body.tabIndex = -1;

        var root = document.createElement('div');

        root.id = 'remoteDiagnostic';

        root.style.position = 'fixed';
        root.style.left = '0';
        root.style.top = '0';
        root.style.right = '0';
        root.style.bottom = '0';

        root.style.padding = '45px';
        root.style.boxSizing = 'border-box';

        root.style.background = '#050505';

        root.innerHTML =
            '<div style="font-size:42px;font-weight:bold;margin-bottom:8px;">' +
                'TIZEN REMOTE TEST' +
            '</div>' +

            '<div style="font-size:20px;color:#aaaaaa;margin-bottom:35px;">' +
                'TizenTivi remote diagnostic' +
            '</div>' +

            '<div id="statusBox" style="' +
                'border:3px solid #333;' +
                'padding:28px;' +
                'margin-bottom:25px;' +
                'background:#101010;' +
            '">' +

                '<div style="font-size:20px;color:#999;">LAST EVENT</div>' +

                '<div id="lastKey" style="' +
                    'font-size:48px;' +
                    'font-weight:bold;' +
                    'margin-top:10px;' +
                '">' +
                    'NONE' +
                '</div>' +

                '<div style="margin-top:25px;font-size:24px;">' +
                    '<div>Event type: <span id="eventType">-</span></div>' +
                    '<div>key: <span id="keyValue">-</span></div>' +
                    '<div>keyCode: <span id="keyCodeValue">-</span></div>' +
                    '<div>which: <span id="whichValue">-</span></div>' +
                    '<div>Mapped name: <span id="mappedValue">-</span></div>' +
                    '<div>Time: <span id="timeValue">-</span></div>' +
                '</div>' +

            '</div>' +

            '<div style="display:flex;gap:25px;margin-bottom:25px;">' +

                '<div style="flex:1;border:2px solid #333;padding:20px;background:#101010;">' +
                    '<div style="color:#999;">KEYDOWN EVENTS</div>' +
                    '<div id="keydownCount" style="font-size:36px;font-weight:bold;margin-top:8px;">0</div>' +
                '</div>' +

                '<div style="flex:1;border:2px solid #333;padding:20px;background:#101010;">' +
                    '<div style="color:#999;">TIZENHWKEY EVENTS</div>' +
                    '<div id="hardwareCount" style="font-size:36px;font-weight:bold;margin-top:8px;">0</div>' +
                '</div>' +

                '<div style="flex:1;border:2px solid #333;padding:20px;background:#101010;">' +
                    '<div style="color:#999;">TOTAL EVENTS</div>' +
                    '<div id="totalCount" style="font-size:36px;font-weight:bold;margin-top:8px;">0</div>' +
                '</div>' +

            '</div>' +

            '<div style="' +
                'border:2px solid #333;' +
                'padding:25px;' +
                'background:#101010;' +
                'font-size:23px;' +
                'line-height:1.7;' +
            '">' +

                '<div style="font-size:26px;font-weight:bold;margin-bottom:8px;">' +
                    'PRESS THESE BUTTONS' +
                '</div>' +

                '<div>' +
                    '↑ UP &nbsp;&nbsp; ↓ DOWN &nbsp;&nbsp; ← LEFT &nbsp;&nbsp; → RIGHT' +
                '</div>' +

                '<div>' +
                    'ENTER / OK &nbsp;&nbsp; BACK' +
                '</div>' +

                '<div>' +
                    '0 1 2 3 4 5 6 7 8 9' +
                '</div>' +

                '<div>' +
                    'CHANNEL UP / DOWN &nbsp;&nbsp; PLAY / PAUSE' +
                '</div>' +

                '<div>' +
                    'RED &nbsp;&nbsp; GREEN &nbsp;&nbsp; YELLOW &nbsp;&nbsp; BLUE' +
                '</div>' +

            '</div>' +

            '<div id="environment" style="' +
                'position:absolute;' +
                'left:45px;' +
                'right:45px;' +
                'bottom:25px;' +
                'font-size:17px;' +
                'color:#888;' +
            '"></div>';

        document.body.appendChild(root);

        updateEnvironment();
    }

    /*
     * ------------------------------------------------------------
     * ENVIRONMENT INFORMATION
     * ------------------------------------------------------------
     */

    function updateEnvironment() {
        var el = document.getElementById('environment');

        if (!el) {
            return;
        }

        var tizenText =
            tizenAvailable
                ? 'AVAILABLE'
                : 'NOT AVAILABLE';

        var tvText =
            tvInputAvailable
                ? 'AVAILABLE'
                : 'NOT AVAILABLE';

        el.innerHTML =
            'Tizen API: <b>' +
            tizenText +
            '</b>' +
            ' &nbsp;&nbsp; ' +
            'TV Input Device API: <b>' +
            tvText +
            '</b>' +
            ' &nbsp;&nbsp; ' +
            'Registered keys: <b>' +
            registeredKeys.length +
            '</b>';
    }

    /*
     * ------------------------------------------------------------
     * DISPLAY EVENT
     * ------------------------------------------------------------
     */

    function displayEvent(type, e, forcedName) {
        eventCount++;

        var code = 0;
        var which = 0;
        var key = '';

        try {
            code = Number(e && e.keyCode || 0);
        } catch (err) {
            code = 0;
        }

        try {
            which = Number(e && e.which || 0);
        } catch (err) {
            which = 0;
        }

        try {
            key = safeString(e && e.key);
        } catch (err) {
            key = '-';
        }

        var mapped =
            forcedName ||
            codeToName(code);

        if (
            mapped === '-' &&
            key &&
            key !== '-'
        ) {
            mapped = key;
        }

        lastEvent = {
            type: type,
            key: key,
            keyCode: code || '-',
            which: which || '-',
            keyName: mapped,
            time: nowTime()
        };

        var lastKey =
            document.getElementById('lastKey');

        var eventType =
            document.getElementById('eventType');

        var keyValue =
            document.getElementById('keyValue');

        var keyCodeValue =
            document.getElementById('keyCodeValue');

        var whichValue =
            document.getElementById('whichValue');

        var mappedValue =
            document.getElementById('mappedValue');

        var timeValue =
            document.getElementById('timeValue');

        var totalCount =
            document.getElementById('totalCount');

        var keydownCountEl =
            document.getElementById('keydownCount');

        var hardwareCountEl =
            document.getElementById('hardwareCount');

        if (lastKey) {
            lastKey.textContent =
                mapped === '-' ?
                    (key || 'UNKNOWN') :
                    mapped;
        }

        if (eventType) {
            eventType.textContent =
                safeString(type);
        }

        if (keyValue) {
            keyValue.textContent =
                key;
        }

        if (keyCodeValue) {
            keyCodeValue.textContent =
                safeString(code || '-');
        }

        if (whichValue) {
            whichValue.textContent =
                safeString(which || '-');
        }

        if (mappedValue) {
            mappedValue.textContent =
                mapped;
        }

        if (timeValue) {
            timeValue.textContent =
                nowTime();
        }

        if (totalCount) {
            totalCount.textContent =
                String(eventCount);
        }

        if (keydownCountEl) {
            keydownCountEl.textContent =
                String(keyDownCount);
        }

        if (hardwareCountEl) {
            hardwareCountEl.textContent =
                String(hardwareCount);
        }

        /*
         * Make the border visibly flash when an event arrives.
         */
        var box =
            document.getElementById('statusBox');

        if (box) {
            box.style.borderColor = '#ffffff';

            clearTimeout(box._flashTimer);

            box._flashTimer =
                setTimeout(function () {
                    box.style.borderColor = '#333333';
                }, 250);
        }
    }

    /*
     * ------------------------------------------------------------
     * STANDARD KEYDOWN
     * ------------------------------------------------------------
     */

    function onKeyDown(e) {
        keyDownCount++;

        displayEvent(
            'keydown',
            e
        );

        /*
         * IMPORTANT:
         * Do NOT preventDefault here.
         *
         * We want to observe exactly what Samsung/Tizen
         * is giving the application.
         */
    }

    /*
     * ------------------------------------------------------------
     * KEYUP
     * ------------------------------------------------------------
     */

    function onKeyUp(e) {
        displayEvent(
            'keyup',
            e
        );
    }

    /*
     * ------------------------------------------------------------
     * TIZEN HARDWARE KEY
     * ------------------------------------------------------------
     */

    function onTizenHardwareKey(e) {
        hardwareCount++;

        var name =
            e &&
            e.keyName
                ? String(e.keyName)
                : '-';

        displayEvent(
            'tizenhwkey',
            e || {},
            name
        );
    }

    /*
     * ------------------------------------------------------------
     * TIZEN API CHECK
     * ------------------------------------------------------------
     */

    function inspectTizen() {
        try {
            tizenAvailable =
                typeof window.tizen !== 'undefined';

            tvInputAvailable =
                tizenAvailable &&
                typeof tizen.tvinputdevice !== 'undefined';

        } catch (e) {
            tizenAvailable = false;
            tvInputAvailable = false;
        }

        updateEnvironment();
    }

    /*
     * ------------------------------------------------------------
     * DISCOVER TIZEN REMOTE KEYS
     * ------------------------------------------------------------
     */

    function inspectKeys() {
        if (!tvInputAvailable) {
            return;
        }

        var names = [
            'MediaPlay',
            'MediaPause',
            'MediaPlayPause',
            'MediaStop',
            'MediaFastForward',
            'MediaRewind',
            'MediaTrackPrevious',
            'MediaTrackNext',
            'ChannelUp',
            'ChannelDown',
            'ColorF0Red',
            'ColorF1Green',
            'ColorF2Yellow',
            'ColorF3Blue',
            'Menu',
            'Info',
            'Guide',
            'Search'
        ];

        names.forEach(function (name) {
            try {
                if (
                    tizen.tvinputdevice.getKey
                ) {
                    var key =
                        tizen.tvinputdevice.getKey(
                            name
                        );

                    if (key) {
                        registeredKeys.push(
                            name +
                            ':' +
                            safeString(key.code)
                        );
                    }
                }
            } catch (e) {
                /*
                 * Some keys may not be available on
                 * a particular Samsung TV.
                 */
            }
        });

        updateEnvironment();
    }

    /*
     * ------------------------------------------------------------
     * DO NOT REGISTER THE MANDATORY KEYS
     * ------------------------------------------------------------
     *
     * We intentionally do NOT register:
     *
     * ArrowLeft
     * ArrowRight
     * ArrowUp
     * ArrowDown
     * Enter
     * Back
     *
     * Samsung handles those automatically.
     *
     * We only attempt to register the extra media keys.
     * TizenBrew should already be doing this through
     * package.json, so failure here is harmless.
     */

    function registerExtraKeys() {
        if (!tvInputAvailable) {
            return;
        }

        if (
            !tizen.tvinputdevice.registerKey
        ) {
            return;
        }

        var keys = [
            'MediaPlay',
            'MediaPause',
            'MediaPlayPause',
            'MediaStop',
            'MediaFastForward',
            'MediaRewind',
            'MediaTrackPrevious',
            'MediaTrackNext'
        ];

        keys.forEach(function (name) {
            try {
                tizen.tvinputdevice.registerKey(
                    name
                );
            } catch (e) {
                /*
                 * Ignore registration errors.
                 *
                 * TizenBrew may have already registered
                 * these keys.
                 */
            }
        });
    }

    /*
     * ------------------------------------------------------------
     * INSTALL LISTENERS
     * ------------------------------------------------------------
     */

    function installListeners() {

        /*
         * Capture phase.
         */
        document.addEventListener(
            'keydown',
            onKeyDown,
            true
        );

        document.addEventListener(
            'keyup',
            onKeyUp,
            true
        );

        /*
         * Tizen-specific hardware key event.
         */
        document.addEventListener(
            'tizenhwkey',
            onTizenHardwareKey,
            true
        );

        /*
         * Window-level backup.
         */
        window.addEventListener(
            'keydown',
            onKeyDown,
            true
        );

        window.addEventListener(
            'keyup',
            onKeyUp,
            true
        );

        window.addEventListener(
            'tizenhwkey',
            onTizenHardwareKey,
            true
        );

        /*
         * Body-level backup.
         */
        if (document.body) {

            document.body.addEventListener(
                'keydown',
                onKeyDown,
                true
            );

            document.body.addEventListener(
                'keyup',
                onKeyUp,
                true
            );

            document.body.addEventListener(
                'tizenhwkey',
                onTizenHardwareKey,
                true
            );
        }

        /*
         * Give the document a focus target.
         */
        try {
            document.body.tabIndex = -1;
            document.body.focus();
        } catch (e) {}
    }

    /*
     * ------------------------------------------------------------
     * START
     * ------------------------------------------------------------
     */

    function start() {

        /*
         * Build the diagnostic screen FIRST.
         */
        createScreen();

        /*
         * Check Tizen.
         */
        inspectTizen();

        /*
         * Install listeners.
         */
        installListeners();

        /*
         * Give Tizen a moment to initialise.
         */
        setTimeout(
            function () {
                inspectTizen();
                inspectKeys();
                registerExtraKeys();
            },
            500
        );

        /*
         * Also show a startup event so we know the
         * JavaScript itself is running.
         */
        setTimeout(
            function () {

                var el =
                    document.getElementById(
                        'lastKey'
                    );

                if (el) {
                    el.textContent =
                        'READY — PRESS A BUTTON';
                }

            },
            1000
        );
    }

    /*
     * Wait for DOM if necessary.
     */
    if (
        document.readyState ===
        'loading'
    ) {
        document.addEventListener(
            'DOMContentLoaded',
            start,
            false
        );
    } else {
        start();
    }

})();

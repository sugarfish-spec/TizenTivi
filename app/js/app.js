(function () {

'use strict';


/* ============================================================
   STORAGE
   ============================================================ */

const STORE = 'iptv_tizenbrew_v1';

const DEFAULT = {
    playlists: [],
    favorites: [],
    selectedPlaylist: null,
    selectedGroup: '__all',
    autoPlaylistRefresh: 360,
    autoEpgRefresh: 360,
    settings: {
        autoplay: true
    }
};

let state = load();


/* ============================================================
   PLAYER STATE
   ============================================================ */

let channels = [];
let groups = [];
let filtered = [];

let focusIndex = 0;
let sidebarIndex = 0;

let sidebarOpen = true;

let currentChannel = null;

let epg = {
    byId: {},
    last: 0
};

let refreshTimer = null;
let epgTimer = null;


/* ============================================================
   REMOTE STATE
   ============================================================ */

let remoteArea = 'sidebar';

let lastRemoteKey = '';
let lastRemoteTime = 0;


/* ============================================================
   HELPERS
   ============================================================ */

function $(id) {
    return document.getElementById(id);
}


function load() {

    try {

        const saved =
            JSON.parse(
                localStorage.getItem(STORE) || 'null'
            );

        return Object.assign(
            {},
            DEFAULT,
            saved || {}
        );

    } catch (e) {

        return Object.assign(
            {},
            DEFAULT
        );
    }
}


function save() {

    localStorage.setItem(
        STORE,
        JSON.stringify(state)
    );
}


function esc(value) {

    return String(value || '')
        .replace(
            /[&<>"']/g,
            function (m) {

                return {
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;'
                }[m];

            }
        );
}


function toast(message) {

    const el = $('toast');

    if (!el) return;

    el.textContent = message;

    el.classList.add('show');

    clearTimeout(toast.timer);

    toast.timer =
        setTimeout(
            function () {
                el.classList.remove('show');
            },
            2800
        );
}


function normUrl(url) {

    return String(url || '')
        .trim()
        .replace(/&amp;/g, '&');
}


function favKey(channel) {

    return (
        channel.uid ||
        channel.url ||
        channel.name
    ).toString();
}


function isFav(channel) {

    return (
        state.favorites.indexOf(
            favKey(channel)
        ) >= 0
    );
}


function toggleFav(channel) {

    if (!channel) return;

    const key =
        favKey(channel);

    const index =
        state.favorites.indexOf(key);

    if (index < 0) {

        state.favorites.push(key);

        toast('Added to favourites');

    } else {

        state.favorites.splice(
            index,
            1
        );

        toast('Removed from favourites');
    }

    save();

    render();
}


/* ============================================================
   M3U
   ============================================================ */

function parseAttrs(line) {

    const result = {};

    const regex =
        /([\w-]+)="([^"]*)"/g;

    let match;

    while (
        (match = regex.exec(line))
    ) {

        result[
            match[1].toLowerCase()
        ] =
            match[2];
    }

    return result;
}


function parseM3U(text) {

    const result = [];

    const lines =
        text
            .replace(/^\uFEFF/, '')
            .split(/\r?\n/);

    let meta = null;

    let pendingOpt = {};


    for (
        let i = 0;
        i < lines.length;
        i++
    ) {

        const line =
            lines[i].trim();

        if (!line) continue;


        if (
            line.indexOf(
                '#EXTVLCOPT:'
            ) === 0
        ) {

            const parts =
                line
                    .slice(12)
                    .split('=');

            pendingOpt[
                parts.shift()
            ] =
                parts.join('=');

            continue;
        }


        if (
            line.indexOf(
                '#EXTINF:'
            ) === 0
        ) {

            const comma =
                line.indexOf(',');

            const head =
                comma >= 0
                    ? line.slice(
                        0,
                        comma
                    )
                    : line;

            const name =
                comma >= 0
                    ? line
                        .slice(
                            comma + 1
                        )
                        .trim()
                    : 'Channel';

            const attrs =
                parseAttrs(head);


            meta = {

                name,

                group:
                    attrs['group-title'] ||
                    attrs['group'] ||
                    'Uncategorised',

                logo:
                    attrs['tvg-logo'] ||
                    '',

                tvgId:
                    attrs['tvg-id'] ||
                    '',

                tvgName:
                    attrs['tvg-name'] ||
                    '',

                pending:
                    Object.assign(
                        {},
                        pendingOpt
                    )
            };


            pendingOpt = {};

            continue;
        }


        if (
            line.charAt(0) !== '#' &&
            meta
        ) {

            let url = line;

            let ua =
                meta.pending[
                    'http-user-agent'
                ] || '';


            if (
                url.indexOf('|') >= 0
            ) {

                const parts =
                    url.split('|');

                url =
                    parts.shift();

                const extra =
                    parts.join('|');

                const match =
                    extra.match(
                        /User-Agent=([^&]+)/i
                    );

                if (match) {

                    try {

                        ua =
                            decodeURIComponent(
                                match[1]
                            );

                    } catch (e) {

                        ua = match[1];
                    }
                }
            }


            result.push({

                uid:
                    (
                        meta.tvgId ||
                        meta.name
                    ) +
                    '|' +
                    url,

                name:
                    meta.name,

                group:
                    meta.group,

                logo:
                    meta.logo,

                tvgId:
                    meta.tvgId,

                tvgName:
                    meta.tvgName,

                url:
                    normUrl(url),

                ua
            });


            meta = null;
        }
    }


    return result;
}


/* ============================================================
   GROUPS
   ============================================================ */

function groupsFor(list) {

    const map =
        new Map();

    list.forEach(
        function (channel) {

            if (
                !map.has(
                    channel.group
                )
            ) {

                map.set(
                    channel.group,
                    0
                );
            }

            map.set(
                channel.group,
                map.get(
                    channel.group
                ) + 1
            );
        }
    );


    return Array.from(
        map.entries()
    ).sort(
        function (a, b) {

            return a[0]
                .localeCompare(
                    b[0]
                );
        }
    );
}


/* ============================================================
   HTTP
   ============================================================ */

async function fetchText(url) {

    const response =
        await fetch(
            url,
            {
                cache: 'no-store'
            }
        );

    if (!response.ok) {

        throw new Error(
            'HTTP ' +
            response.status
        );
    }

    return response.text();
}


async function fetchJson(url) {

    const response =
        await fetch(
            url,
            {
                cache: 'no-store'
            }
        );

    if (!response.ok) {

        throw new Error(
            'HTTP ' +
            response.status
        );
    }

    return response.json();
}


/* ============================================================
   XTREAM
   ============================================================ */

function xtreamBase(server) {

    return normUrl(server)
        .replace(/\/+$/, '');
}


function xtreamUrl(
    base,
    username,
    password,
    action,
    extra
) {

    return (
        xtreamBase(base) +
        '/player_api.php?username=' +
        encodeURIComponent(username) +
        '&password=' +
        encodeURIComponent(password) +
        '&action=' +
        action +
        (
            extra
                ? '&' + extra
                : ''
        )
    );
}


async function loadXtream(playlist) {

    const base =
        xtreamBase(
            playlist.server
        );


    const api =
        base +
        '/player_api.php?username=' +
        encodeURIComponent(
            playlist.username
        ) +
        '&password=' +
        encodeURIComponent(
            playlist.password
        );


    const info =
        await fetchJson(api);


    if (
        info.user_info &&
        String(
            info.user_info.auth
        ) === '0'
    ) {

        throw new Error(
            'Xtream login rejected'
        );
    }


    const categories =
        await fetchJson(
            xtreamUrl(
                base,
                playlist.username,
                playlist.password,
                'get_live_categories'
            )
        );


    const streams =
        await fetchJson(
            xtreamUrl(
                base,
                playlist.username,
                playlist.password,
                'get_live_streams'
            )
        );


    const categoryMap = {};


    (
        categories || []
    ).forEach(
        function (category) {

            categoryMap[
                String(
                    category.category_id
                )
            ] =
                category.category_name ||
                'Uncategorised';
        }
    );


    return (
        streams || []
    ).map(
        function (stream) {

            return {

                uid:
                    'xtream:' +
                    stream.stream_id,

                name:
                    stream.name ||
                    'Channel',

                group:
                    categoryMap[
                        String(
                            stream.category_id
                        )
                    ] ||
                    'Uncategorised',

                logo:
                    stream.stream_icon ||
                    '',

                tvgId:
                    stream.epg_channel_id ||
                    '',

                tvgName:
                    stream.epg_channel_id ||
                    '',

                url:
                    base +
                    '/live/' +
                    encodeURIComponent(
                        playlist.username
                    ) +
                    '/' +
                    encodeURIComponent(
                        playlist.password
                    ) +
                    '/' +
                    stream.stream_id +
                    '.ts',

                xtream: {

                    base,

                    user:
                        playlist.username,

                    pass:
                        playlist.password,

                    id:
                        stream.stream_id,

                    epg:
                        stream.epg_channel_id ||
                        ''
                }
            };
        }
    );
}


/* ============================================================
   LOAD PLAYLIST
   ============================================================ */

async function loadPlaylist(playlist) {

    if (
        playlist.type === 'xtream'
    ) {

        return loadXtream(
            playlist
        );
    }


    const text =
        await fetchText(
            playlist.url
        );


    return parseM3U(text);
}


/* ============================================================
   REFRESH
   ============================================================ */

async function refreshPlaylist(
    playlist,
    quiet
) {

    if (!playlist) return;


    try {

        channels =
            await loadPlaylist(
                playlist
            );


        playlist.lastRefresh =
            Date.now();


        save();


        groups =
            groupsFor(
                channels
            );


        if (
            state.selectedGroup !== '__all' &&
            state.selectedGroup !== '__fav' &&
            !groups.some(
                function (item) {
                    return (
                        item[0] ===
                        state.selectedGroup
                    );
                }
            )
        ) {

            state.selectedGroup =
                '__all';
        }


        applyFilter();

        render();


        if (!quiet) {

            toast(
                'Playlist refreshed · ' +
                channels.length +
                ' channels'
            );
        }


    } catch (error) {

        toast(
            'Playlist refresh failed: ' +
            error.message
        );
    }
}


/* ============================================================
   FILTERING
   ============================================================ */

function applyFilter() {

    if (
        state.selectedGroup ===
        '__fav'
    ) {

        filtered =
            channels.filter(
                isFav
            );

    } else if (
        state.selectedGroup ===
        '__all'
    ) {

        filtered =
            channels.slice();

    } else {

        filtered =
            channels.filter(
                function (channel) {

                    return (
                        channel.group ===
                        state.selectedGroup
                    );
                }
            );
    }


    filtered.sort(
        function (a, b) {

            return a.name
                .localeCompare(
                    b.name
                );
        }
    );


    if (
        filtered.length === 0
    ) {

        focusIndex = 0;

    } else {

        focusIndex =
            Math.max(
                0,
                Math.min(
                    focusIndex,
                    filtered.length - 1
                )
            );
    }
}


/* ============================================================
   RENDER SIDEBAR
   ============================================================ */

function renderSidebar() {

    const sidebar =
        $('sidebarList');


    let html = '';


    const allSelected =
        state.selectedGroup ===
        '__all';

    const favSelected =
        state.selectedGroup ===
        '__fav';


    html +=
        '<div class="side-item ' +
        (
            allSelected
                ? 'selected'
                : ''
        ) +
        '" data-side="__all">' +

        '<span>All Channels</span>' +

        '<span class="count">' +
        channels.length +
        '</span>' +

        '</div>';


    html +=
        '<div class="side-item ' +
        (
            favSelected
                ? 'selected'
                : ''
        ) +
        '" data-side="__fav">' +

        '<span>★ Favourites</span>' +

        '<span class="count">' +
        channels.filter(isFav).length +
        '</span>' +

        '</div>';


    groups.forEach(
        function (group) {

            html +=
                '<div class="side-item ' +
                (
                    state.selectedGroup ===
                    group[0]
                        ? 'selected'
                        : ''
                ) +
                '" data-side="' +
                esc(group[0]) +
                '">' +

                '<span>' +
                esc(group[0]) +
                '</span>' +

                '<span class="count">' +
                group[1] +
                '</span>' +

                '</div>';
        }
    );


    sidebar.innerHTML =
        html;


    updateSidebarFocus();
}


/* ============================================================
   RENDER CHANNELS
   ============================================================ */

function renderChannels() {

    const grid =
        $('channelGrid');


    grid.innerHTML = '';


    if (
        filtered.length === 0
    ) {

        grid.innerHTML =
            '<div class="empty-state">' +

            '<div class="empty-state-title">' +
            (
                channels.length
                    ? 'No channels here'
                    : 'No playlist loaded'
            ) +
            '</div>' +

            '<div class="empty-state-text">' +
            (
                channels.length
                    ? 'Choose another category'
                    : 'Open Settings to add your IPTV playlist'
            ) +
            '</div>' +

            '</div>';

        return;
    }


    /*
     * Only render what can actually fit on screen.
     * This keeps Tizen from trying to maintain hundreds
     * of DOM elements.
     */
    const visible =
        filtered.slice(
            0,
            40
        );


    visible.forEach(
        function (channel, index) {

            const element =
                document.createElement(
                    'div'
                );


            element.className =
                'channel';


            if (
                index === focusIndex &&
                remoteArea === 'channels'
            ) {

                element.classList.add(
                    'focused'
                );
            }


            const logo =
                channel.logo

                    ? '<img class="channel-logo" src="' +
                      esc(channel.logo) +
                      '" onerror="this.style.display=\'none\'">'

                    : '<div class="channel-logo fallback">TV</div>';


            element.innerHTML =

                logo +

                '<div class="channel-meta">' +

                '<div class="channel-title">' +
                esc(channel.name) +
                '</div>' +

                '<div class="channel-sub">' +
                esc(channel.group) +
                '</div>' +

                '</div>' +

                '<div class="channel-star ' +
                (
                    isFav(channel)
                        ? 'on'
                        : ''
                ) +
                '">' +

                '★' +

                '</div>';


            element.onclick =
                function () {

                    focusIndex =
                        index;

                    playCurrent();
                };


            grid.appendChild(
                element
            );
        }
    );
}


/* ============================================================
   RENDER
   ============================================================ */

function render() {

    applyFilter();


    const playlist =
        state.playlists.find(
            function (item) {

                return (
                    item.id ===
                    state.selectedPlaylist
                );
            }
        );


    $('playlistName')
        .textContent =
            playlist
                ? playlist.name
                : 'No playlist';


    $('categoryTitle')
        .textContent =
            state.selectedGroup ===
            '__fav'

                ? 'Favourites'

                : state.selectedGroup ===
                  '__all'

                    ? 'All Channels'

                    : state.selectedGroup;


    $('channelCount')
        .textContent =
            filtered.length +
            (
                filtered.length === 1
                    ? ' channel'
                    : ' channels'
            );


    renderSidebar();

    renderChannels();


    updateSidebarFocus();

    updateChannelFocus();
}


/* ============================================================
   FOCUS
   ============================================================ */

function updateSidebarFocus() {

    const items =
        $('sidebarList')
            .children;


    Array.from(items)
        .forEach(
            function (item, index) {

                item.classList.toggle(
                    'focused',
                    remoteArea ===
                    'sidebar' &&
                    index ===
                    sidebarIndex
                );
            }
        );
}


function updateChannelFocus() {

    const items =
        $('channelGrid')
            .children;


    Array.from(items)
        .forEach(
            function (item, index) {

                item.classList.toggle(
                    'focused',
                    remoteArea ===
                    'channels' &&
                    index ===
                    focusIndex
                );
            }
        );
}


function focusSidebar() {

    remoteArea =
        'sidebar';

    updateSidebarFocus();
}


function focusChannels() {

    remoteArea =
        'channels';

    updateChannelFocus();
}


/* ============================================================
   SIDEBAR NAVIGATION
   ============================================================ */

function selectSidebar() {

    const item =
        $('sidebarList')
            .children[
                sidebarIndex
            ];


    if (!item) return;


    const group =
        item.dataset.side;


    state.selectedGroup =
        group;


    focusIndex = 0;


    save();

    render();


    toast(
        group === '__all'
            ? 'All Channels'
            : group === '__fav'
                ? 'Favourites'
                : group
    );
}


function moveSidebar(delta) {

    const count =
        $('sidebarList')
            .children.length;


    if (!count) return;


    sidebarIndex =
        Math.max(
            0,
            Math.min(
                sidebarIndex + delta,
                count - 1
            )
        );


    updateSidebarFocus();
}


/* ============================================================
   CHANNEL NAVIGATION
   ============================================================ */

function moveChannel(delta) {

    if (
        filtered.length === 0
    ) return;


    const columns = 4;


    let next =
        focusIndex +
        delta;


    /*
     * Horizontal movement.
     */
    if (
        delta === 1 ||
        delta === -1
    ) {

        next =
            focusIndex +
            delta;
    }


    /*
     * Vertical movement.
     */
    if (
        delta === columns ||
        delta === -columns
    ) {

        next =
            focusIndex +
            delta;
    }


    next =
        Math.max(
            0,
            Math.min(
                next,
                filtered.length - 1
            )
        );


    focusIndex =
        next;


    updateChannelFocus();
}


/* ============================================================
   CURRENT CHANNEL
   ============================================================ */

function current() {

    return filtered[
        focusIndex
    ];
}


function playCurrent() {

    const channel =
        current();

    if (!channel) return;

    playChannel(
        channel
    );
}


function playChannel(channel) {

    if (!channel) return;


    currentChannel =
        channel;


    $('nowTitle')
        .textContent =
            channel.name;


    $('nowProgram')
        .textContent =
            channel.group;


    $('playerStatus')
        .textContent =
            'Loading…';


    const logo =
        $('nowLogo');


    if (channel.logo) {

        logo.style.backgroundImage =
            'url("' +
            channel.logo.replace(
                /"/g,
                '\\"'
            ) +
            '")';

    } else {

        logo.style.backgroundImage =
            'none';
    }


    const video =
        $('video');


    try {

        video.pause();

        video.removeAttribute(
            'src'
        );

        video.load();


        video.src =
            channel.url;


        const promise =
            video.play();


        if (
            promise &&
            promise.catch
        ) {

            promise.catch(
                function (error) {

                    $('playerStatus')
                        .textContent =
                            'Playback error';

                    toast(
                        'Cannot play channel: ' +
                        error.message
                    );
                }
            );
        }


        loadChannelEpg(
            channel
        );


    } catch (error) {

        $('playerStatus')
            .textContent =
                'Playback error';

        toast(
            error.message
        );
    }
}


/* ============================================================
   STOP
   ============================================================ */

function stop() {

    const video =
        $('video');


    try {

        video.pause();

        video.removeAttribute(
            'src'
        );

        video.load();

    } catch (e) {}


    currentChannel =
        null;


    $('playerStatus')
        .textContent =
            'Stopped';


    $('nowTitle')
        .textContent =
            'Select a channel';


    $('nowProgram')
        .textContent =
            'Choose a channel to start watching';


    $('nowLogo')
        .style
        .backgroundImage =
            'none';
}


/* ============================================================
   EPG
   ============================================================ */

function fmtXmlDate(value) {

    if (!value) return '';


    const match =
        value.match(
            /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)/
        );


    if (!match) {

        return value;
    }


    return (
        match[3] +
        '/' +
        match[2] +
        ' ' +
        match[4] +
        ':' +
        match[5]
    );
}


function parseXmltv(text) {

    const xml =
        new DOMParser()
            .parseFromString(
                text,
                'application/xml'
            );


    const output = {};


    Array.from(
        xml.querySelectorAll(
            'programme'
        )
    ).forEach(
        function (node) {

            const id =
                node.getAttribute(
                    'channel'
                ) ||
                '';


            if (!id) return;


            const programme = {

                title:
                    node.querySelector(
                        'title'
                    )?.textContent ||
                    '',

                desc:
                    node.querySelector(
                        'desc'
                    )?.textContent ||
                    '',

                start:
                    fmtXmlDate(
                        node.getAttribute(
                            'start'
                        )
                    ),

                end:
                    fmtXmlDate(
                        node.getAttribute(
                            'stop'
                        )
                    )
            };


            if (!output[id]) {

                output[id] = [];
            }


            output[id].push(
                programme
            );
        }
    );


    return output;
}


function showEpg(programme) {

    $('epgTitle')
        .textContent =
            programme.title ||
            'Programme';


    $('epgTimes')
        .textContent =
            (
                programme.start ||
                ''
            ) +
            (
                programme.end
                    ? ' – ' +
                      programme.end
                    : ''
            );


    $('epgDesc')
        .textContent =
            programme.desc ||
            '';


    $('epgBar')
        .classList
        .remove(
            'hidden'
        );
}


async function loadChannelEpg(channel) {

    $('epgBar')
        .classList
        .add(
            'hidden'
        );


    if (
        channel.xtream
    ) {

        try {

            const x =
                channel.xtream;


            const data =
                await fetchJson(
                    xtreamUrl(
                        x.base,
                        x.user,
                        x.pass,
                        'get_short_epg',
                        'stream_id=' +
                        encodeURIComponent(
                            x.id
                        ) +
                        '&limit=2'
                    )
                );


            const list =
                data.epg_list ||
                [];


            if (list[0]) {

                showEpg({

                    title:
                        list[0].title,

                    start:
                        list[0].start,

                    end:
                        list[0].end,

                    desc:
                        list[0].description
                });
            }


            return;

        } catch (e) {}
    }


    const id =
        channel.tvgId ||
        channel.tvgName;


    if (
        id &&
        epg.byId[id] &&
        epg.byId[id][0]
    ) {

        showEpg(
            epg.byId[id][0]
        );
    }
}


async function refreshEpg(
    quiet
) {

    const playlist =
        state.playlists.find(
            function (item) {

                return (
                    item.id ===
                    state.selectedPlaylist
                );
            }
        );


    if (!playlist) return;


    const url =
        playlist.epgUrl;


    if (!url) {

        if (!quiet) {

            toast(
                'No EPG URL configured'
            );
        }

        return;
    }


    try {

        epg.byId =
            parseXmltv(
                await fetchText(
                    url
                )
            );


        epg.last =
            Date.now();


        if (!quiet) {

            toast(
                'EPG refreshed'
            );
        }


        if (currentChannel) {

            loadChannelEpg(
                currentChannel
            );
        }


    } catch (error) {

        if (!quiet) {

            toast(
                'EPG refresh failed: ' +
                error.message
            );
        }
    }
}


/* ============================================================
   AUTO REFRESH
   ============================================================ */

function schedule() {

    clearInterval(
        refreshTimer
    );

    clearInterval(
        epgTimer
    );


    const playlist =
        state.playlists.find(
            function (item) {

                return (
                    item.id ===
                    state.selectedPlaylist
                );
            }
        );


    if (!playlist) return;


    const playlistMinutes =
        Number(
            playlist.refreshMinutes ||
            state.autoPlaylistRefresh ||
            0
        );


    if (
        playlistMinutes > 0
    ) {

        refreshTimer =
            setInterval(
                function () {

                    refreshPlaylist(
                        playlist,
                        true
                    );
                },
                playlistMinutes *
                60000
            );
    }


    const epgMinutes =
        Number(
            playlist.epgRefreshMinutes ||
            state.autoEpgRefresh ||
            0
        );


    if (
        epgMinutes > 0
    ) {

        epgTimer =
            setInterval(
                function () {

                    refreshEpg(
                        true
                    );
                },
                epgMinutes *
                60000
            );
    }
}


/* ============================================================
   MODAL
   ============================================================ */

function openModal(
    title,
    body,
    actions
) {

    const root =
        $('modalRoot');


    root.innerHTML =

        '<div class="modal">' +

        '<h2>' +
        title +
        '</h2>' +

        body +

        '<div class="modal-actions">' +
        (actions || '') +
        '</div>' +

        '</div>';


    root.classList.remove(
        'hidden'
    );
}


function closeModal() {

    $('modalRoot')
        .classList
        .add(
            'hidden'
        );


    $('modalRoot')
        .innerHTML =
            '';
}


/* ============================================================
   SETTINGS
   ============================================================ */

function settingsModal() {

    let rows =
        '<div class="form-row">' +
        '<label>Saved playlists</label>' +
        '<div id="plistRows">';


    state.playlists.forEach(
        function (playlist) {

            rows +=

                '<div class="list-row">' +

                '<div class="grow">' +

                '<b>' +
                esc(
                    playlist.name
                ) +
                '</b>' +

                '<div class="muted">' +
                esc(
                    playlist.type ===
                    'xtream'
                        ? playlist.server
                        : playlist.url
                ) +
                '</div>' +

                '</div>' +

                '<button class="btn" data-edit="' +
                playlist.id +
                '">Edit</button>' +

                '<button class="btn danger" data-del="' +
                playlist.id +
                '">Delete</button>' +

                '</div>';
        }
    );


    rows +=
        '</div>' +
        '</div>' +


        '<div class="form-row">' +

        '<label>' +
        'Global playlist refresh minutes (0 = off)' +
        '</label>' +

        '<input id="autoRefresh" class="input" type="number" min="0" value="' +
        Number(
            state.autoPlaylistRefresh ||
            0
        ) +
        '">' +

        '</div>' +


        '<div class="form-row">' +

        '<label>' +
        'Global EPG refresh minutes (0 = off)' +
        '</label>' +

        '<input id="autoEpg" class="input" type="number" min="0" value="' +
        Number(
            state.autoEpgRefresh ||
            0
        ) +
        '">' +

        '</div>';


    openModal(
        'Settings',
        rows,

        '<button class="btn" id="addPlaylist">' +
        'Add Playlist' +
        '</button>' +

        '<button class="btn" id="refreshNow">' +
        'Refresh Now' +
        '</button>' +

        '<button class="btn primary" id="closeSettings">' +
        'Done' +
        '</button>'
    );


    $('addPlaylist').onclick =
        function () {

            playlistModal();
        };


    $('refreshNow').onclick =
        async function () {

            const playlist =
                state.playlists.find(
                    function (item) {

                        return (
                            item.id ===
                            state.selectedPlaylist
                        );
                    }
                );


            await refreshPlaylist(
                playlist
            );

            await refreshEpg();

            schedule();
        };


    $('closeSettings').onclick =
        function () {

            state.autoPlaylistRefresh =
                Number(
                    $('autoRefresh')
                        .value
                ) || 0;


            state.autoEpgRefresh =
                Number(
                    $('autoEpg')
                        .value
                ) || 0;


            save();

            schedule();

            closeModal();
        };


    Array.from(
        document.querySelectorAll(
            '[data-del]'
        )
    ).forEach(
        function (button) {

            button.onclick =
                function () {

                    const id =
                        button.dataset.del;


                    state.playlists =
                        state.playlists.filter(
                            function (playlist) {

                                return (
                                    playlist.id !==
                                    id
                                );
                            }
                        );


                    if (
                        state.selectedPlaylist ===
                        id
                    ) {

                        state.selectedPlaylist =
                            state.playlists[0]
                                ?.id ||
                            null;
                    }


                    save();

                    closeModal();

                    init();
                };
        }
    );


    Array.from(
        document.querySelectorAll(
            '[data-edit]'
        )
    ).forEach(
        function (button) {

            button.onclick =
                function () {

                    playlistModal(
                        state.playlists.find(
                            function (playlist) {

                                return (
                                    playlist.id ===
                                    button.dataset.edit
                                );
                            }
                        )
                    );
                };
        }
    );
}


/* ============================================================
   PLAYLIST MODAL
   ============================================================ */

function playlistModal(
    existing
) {

    const playlist =
        existing ||
        {

            id:
                'p' +
                Date.now(),

            name:
                'My Playlist',

            type:
                'xtream',

            server:
                '',

            username:
                '',

            password:
                '',

            url:
                '',

            epgUrl:
                '',

            refreshMinutes:
                360,

            epgRefreshMinutes:
                360
        };


    const body =

        '<div class="form-row">' +

        '<label>Name</label>' +

        '<input id="pn" class="input" value="' +
        esc(
            playlist.name
        ) +
        '">' +

        '</div>' +


        '<div class="form-row">' +

        '<label>Type</label>' +

        '<select id="pt" class="select">' +

        '<option value="xtream" ' +
        (
            playlist.type ===
            'xtream'
                ? 'selected'
                : ''
        ) +
        '>Xtream Codes</option>' +

        '<option value="m3u" ' +
        (
            playlist.type ===
            'm3u'
                ? 'selected'
                : ''
        ) +
        '>M3U / M3U8 URL</option>' +

        '</select>' +

        '</div>' +


        '<div id="xtFields">' +

        '<div class="form-row">' +

        '<label>Server URL</label>' +

        '<input id="server" class="input" placeholder="https://example.com:8080" value="' +
        esc(
            playlist.server
        ) +
        '">' +

        '</div>' +


        '<div class="form-row">' +

        '<label>Username</label>' +

        '<input id="user" class="input" value="' +
        esc(
            playlist.username
        ) +
        '">' +

        '</div>' +


        '<div class="form-row">' +

        '<label>Password</label>' +

        '<input id="pass" class="input" type="password" value="' +
        esc(
            playlist.password
        ) +
        '">' +

        '</div>' +

        '</div>' +


        '<div id="m3uFields">' +

        '<div class="form-row">' +

        '<label>M3U / M3U8 URL</label>' +

        '<input id="url" class="input" value="' +
        esc(
            playlist.url
        ) +
        '">' +

        '</div>' +

        '</div>' +


        '<div class="form-row">' +

        '<label>XMLTV EPG URL (optional)</label>' +

        '<input id="epg" class="input" value="' +
        esc(
            playlist.epgUrl
        ) +
        '">' +

        '</div>' +


        '<div class="form-row">' +

        '<label>Playlist auto-refresh minutes (0 = off)</label>' +

        '<input id="rm" class="input" type="number" min="0" value="' +
        Number(
            playlist.refreshMinutes ||
            0
        ) +
        '">' +

        '</div>' +


        '<div class="form-row">' +

        '<label>EPG auto-refresh minutes (0 = off)</label>' +

        '<input id="erm" class="input" type="number" min="0" value="' +
        Number(
            playlist.epgRefreshMinutes ||
            0
        ) +
        '">' +

        '</div>';


    openModal(
        existing
            ? 'Edit Playlist'
            : 'Add Playlist',

        body,

        '<button class="btn" id="cancelP">' +
        'Cancel' +
        '</button>' +

        '<button class="btn primary" id="saveP">' +
        'Save & Load' +
        '</button>'
    );


    function toggleFields() {

        const xtream =
            $('pt').value ===
            'xtream';


        $('xtFields')
            .style
            .display =
                xtream
                    ? 'block'
                    : 'none';


        $('m3uFields')
            .style
            .display =
                xtream
                    ? 'none'
                    : 'block';
    }


    $('pt').onchange =
        toggleFields;


    toggleFields();


    $('cancelP').onclick =
        closeModal;


    $('saveP').onclick =
        async function () {

            playlist.name =
                $('pn')
                    .value
                    .trim() ||
                'Playlist';


            playlist.type =
                $('pt')
                    .value;


            playlist.server =
                $('server')
                    ? $('server')
                        .value
                        .trim()
                    : '';


            playlist.username =
                $('user')
                    ? $('user')
                        .value
                        .trim()
                    : '';


            playlist.password =
                $('pass')
                    ? $('pass')
                        .value
                    : '';


            playlist.url =
                $('url')
                    ? $('url')
                        .value
                        .trim()
                    : '';


            playlist.epgUrl =
                $('epg')
                    .value
                    .trim();


            playlist.refreshMinutes =
                Number(
                    $('rm')
                        .value
                ) || 0;


            playlist.epgRefreshMinutes =
                Number(
                    $('erm')
                        .value
                ) || 0;


            const index =
                state.playlists.findIndex(
                    function (item) {

                        return (
                            item.id ===
                            playlist.id
                        );
                    }
                );


            if (index >= 0) {

                state.playlists[
                    index
                ] =
                    playlist;

            } else {

                state.playlists.push(
                    playlist
                );
            }


            state.selectedPlaylist =
                playlist.id;


            save();

            closeModal();

            await init();
        };
}


/* ============================================================
   SEARCH
   ============================================================ */

function searchModal() {

    const body =

        '<div class="form-row">' +

        '<label>Search channels</label>' +

        '<input id="searchInput" class="input" placeholder="Type a channel name...">' +

        '</div>' +

        '<div id="searchList" class="search-list"></div>';


    openModal(
        'Search',
        body,

        '<button class="btn primary" id="closeSearch">' +
        'Close' +
        '</button>'
    );


    $('closeSearch').onclick =
        closeModal;


    const input =
        $('searchInput');


    input.focus();


    input.oninput =
        function () {

            const query =
                input.value
                    .toLowerCase()
                    .trim();


            const results =
                channels
                    .filter(
                        function (channel) {

                            return (
                                channel.name
                                    .toLowerCase()
                                    .indexOf(
                                        query
                                    ) >= 0
                            );
                        }
                    )
                    .slice(
                        0,
                        60
                    );


            $('searchList')
                .innerHTML =
                    results.map(
                        function (
                            channel,
                            index
                        ) {

                            return (

                                '<div class="search-result" data-search="' +
                                index +
                                '">' +

                                esc(
                                    channel.name
                                ) +

                                ' <span class="muted">' +
                                esc(
                                    channel.group
                                ) +
                                '</span>' +

                                '</div>'
                            );
                        }
                    )
                    .join('');


            Array.from(
                document.querySelectorAll(
                    '[data-search]'
                )
            ).forEach(
                function (item) {

                    item.onclick =
                        function () {

                            const channel =
                                results[
                                    Number(
                                        item.dataset.search
                                    )
                                ];


                            const index =
                                filtered.indexOf(
                                    channel
                                );


                            closeModal();


                            if (
                                index >= 0
                            ) {

                                focusIndex =
                                    index;

                                focusChannels();

                                render();

                                playCurrent();

                            } else {

                                playChannel(
                                    channel
                                );
                            }
                        };
                }
            );
        };
}


/* ============================================================
   REMOTE KEY MAP
   ============================================================ */

const REMOTE_CODES = {

    Enter: 13,

    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,

    Back: 10009,
    Escape: 27,

    MediaPlay: 415,
    MediaPause: 19,
    MediaPlayPause: 10252,
    MediaStop: 413,

    MediaRewind: 412,
    MediaFastForward: 417,

    MediaTrackPrevious: 10232,
    MediaTrackNext: 10233,

    ColorF0Red: 403,
    ColorF1Green: 404,
    ColorF2Yellow: 405,
    ColorF3Blue: 406
};


function keyName(event) {

    const code =
        Number(
            event &&
            (
                event.keyCode ||
                event.which ||
                0
            )
        );


    for (
        const name in REMOTE_CODES
    ) {

        if (
            REMOTE_CODES[name] ===
            code
        ) {

            return name;
        }
    }


    if (
        event &&
        event.key
    ) {

        if (
            event.key ===
            'Return'
        ) {

            return 'Back';
        }


        return String(
            event.key
        );
    }


    return '';
}


/* ============================================================
   DUPLICATE EVENT PROTECTION
   ============================================================ */

function duplicateRemote(
    key
) {

    const now =
        Date.now();


    /*
     * Samsung can expose the same physical press
     * through more than one event path.
     */
    if (
        key ===
        lastRemoteKey &&
        now -
        lastRemoteTime <
        70
    ) {

        return true;
    }


    lastRemoteKey =
        key;

    lastRemoteTime =
        now;


    return false;
}


function stopRemoteEvent(
    event
) {

    try {

        if (
            event.preventDefault
        ) {

            event.preventDefault();
        }

    } catch (e) {}


    try {

        if (
            event.stopImmediatePropagation
        ) {

            event.stopImmediatePropagation();

        } else if (
            event.stopPropagation
        ) {

            event.stopPropagation();
        }

    } catch (e) {}
}


/* ============================================================
   SIDEBAR OPEN / CLOSE
   ============================================================ */

function openSidebar() {

    sidebarOpen =
        true;


    $('sidebar')
        .style
        .display =
            'flex';


    focusSidebar();
}


function closeSidebar() {

    sidebarOpen =
        false;


    $('sidebar')
        .style
        .display =
            'flex';


    focusChannels();
}


/* ============================================================
   MODAL REMOTE NAVIGATION
   ============================================================ */

function modalButtons() {

    if (
        $('modalRoot')
            .classList
            .contains(
                'hidden'
            )
    ) {

        return [];
    }


    return Array.from(
        $('modalRoot')
            .querySelectorAll(
                'button,input,select'
            )
    );
}


let modalFocusIndex = 0;


function moveModalFocus(
    delta
) {

    const items =
        modalButtons();


    if (!items.length)
        return;


    modalFocusIndex =
        Math.max(
            0,
            Math.min(
                modalFocusIndex +
                delta,
                items.length - 1
            )
        );


    items.forEach(
        function (
            item,
            index
        ) {

            item.classList.toggle(
                'focused',
                index ===
                modalFocusIndex
            );
        }
    );


    try {

        items[
            modalFocusIndex
        ].focus();

    } catch (e) {}
}


function modalEnter() {

    const items =
        modalButtons();


    if (
        !items.length
    ) return;


    const item =
        items[
            modalFocusIndex
        ];


    if (
        item.tagName ===
        'INPUT'
    ) {

        item.focus();

        return;
    }


    try {

        item.click();

    } catch (e) {}
}


/* ============================================================
   REMOTE HANDLER
   ============================================================ */

function handleKey(
    event
) {

    const key =
        keyName(event);


    if (!key) return;


    if (
        duplicateRemote(
            key
        )
    ) {

        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * MODAL
     */
    if (
        !$('modalRoot')
            .classList
            .contains(
                'hidden'
            )
    ) {

        if (
            key === 'Back' ||
            key === 'Escape'
        ) {

            closeModal();

            stopRemoteEvent(
                event
            );

            return;
        }


        if (
            key === 'ArrowUp'
        ) {

            moveModalFocus(
                -1
            );

            stopRemoteEvent(
                event
            );

            return;
        }


        if (
            key === 'ArrowDown'
        ) {

            moveModalFocus(
                1
            );

            stopRemoteEvent(
                event
            );

            return;
        }


        if (
            key === 'Enter'
        ) {

            modalEnter();

            stopRemoteEvent(
                event
            );

            return;
        }


        return;
    }


    /*
     * BACK
     */
    if (
        key === 'Back' ||
        key === 'Escape'
    ) {

        if (
            sidebarOpen
        ) {

            closeSidebar();

        } else {

            openSidebar();
        }


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * LEFT
     */
    if (
        key === 'ArrowLeft'
    ) {

        if (
            remoteArea ===
            'channels'
        ) {

            /*
             * Four-column channel grid.
             */
            if (
                focusIndex %
                4 ===
                0
            ) {

                openSidebar();

            } else {

                moveChannel(
                    -1
                );
            }

        } else {

            moveSidebar(
                0
            );
        }


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * RIGHT
     */
    if (
        key === 'ArrowRight'
    ) {

        if (
            remoteArea ===
            'sidebar'
        ) {

            focusChannels();

        } else {

            moveChannel(
                1
            );
        }


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * UP
     */
    if (
        key === 'ArrowUp'
    ) {

        if (
            remoteArea ===
            'sidebar'
        ) {

            moveSidebar(
                -1
            );

        } else {

            moveChannel(
                -4
            );
        }


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * DOWN
     */
    if (
        key === 'ArrowDown'
    ) {

        if (
            remoteArea ===
            'sidebar'
        ) {

            moveSidebar(
                1
            );

        } else {

            moveChannel(
                4
            );
        }


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * OK
     */
    if (
        key === 'Enter'
    ) {

        if (
            remoteArea ===
            'sidebar'
        ) {

            selectSidebar();

        } else {

            playCurrent();
        }


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * PLAY / PAUSE
     */
    if (
        key ===
        'MediaPlayPause'
    ) {

        const video =
            $('video');


        if (
            video.paused
        ) {

            video.play()
                .catch(
                    function () {}
                );

        } else {

            video.pause();
        }


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * PLAY
     */
    if (
        key ===
        'MediaPlay'
    ) {

        $('video')
            .play()
            .catch(
                function () {}
            );


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * PAUSE
     */
    if (
        key ===
        'MediaPause'
    ) {

        $('video')
            .pause();


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * STOP
     */
    if (
        key ===
        'MediaStop'
    ) {

        stop();


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * REWIND
     */
    if (
        key ===
        'MediaRewind'
    ) {

        try {

            $('video')
                .currentTime =
                Math.max(
                    0,
                    $('video')
                        .currentTime -
                    10
                );

        } catch (e) {}


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * FAST FORWARD
     */
    if (
        key ===
        'MediaFastForward'
    ) {

        try {

            $('video')
                .currentTime +=
                10;

        } catch (e) {}


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * PREVIOUS
     */
    if (
        key ===
        'MediaTrackPrevious'
    ) {

        if (
            filtered.length
        ) {

            focusIndex =
                Math.max(
                    0,
                    focusIndex - 1
                );

            focusChannels();

            updateChannelFocus();
        }


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * NEXT
     */
    if (
        key ===
        'MediaTrackNext'
    ) {

        if (
            filtered.length
        ) {

            focusIndex =
                Math.min(
                    filtered.length - 1,
                    focusIndex + 1
                );

            focusChannels();

            updateChannelFocus();
        }


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * RED
     */
    if (
        key ===
        'ColorF0Red'
    ) {

        if (
            currentChannel
        ) {

            toggleFav(
                currentChannel
            );
        }


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * GREEN
     */
    if (
        key ===
        'ColorF1Green'
    ) {

        modalFocusIndex =
            0;

        settingsModal();


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * YELLOW
     */
    if (
        key ===
        'ColorF2Yellow'
    ) {

        modalFocusIndex =
            0;

        searchModal();


        stopRemoteEvent(
            event
        );

        return;
    }


    /*
     * BLUE
     */
    if (
        key ===
        'ColorF3Blue'
    ) {

        const playlist =
            state.playlists.find(
                function (item) {

                    return (
                        item.id ===
                        state.selectedPlaylist
                    );
                }
            );


        refreshPlaylist(
            playlist
        );

        refreshEpg();


        stopRemoteEvent(
            event
        );

        return;
    }
}


/* ============================================================
   TIZEN BACK
   ============================================================ */

function handleTizenHardwareKey(
    event
) {

    if (!event)
        return;


    const name =
        String(
            event.keyName ||
            ''
        ).toLowerCase();


    if (
        name === 'back' ||
        name === 'return'
    ) {

        /*
         * Do not call window.history or
         * tizen.application.exit().
         *
         * Back is an application navigation
         * command in this player.
         */

        handleKey({

            key: 'Back',

            keyCode: 10009,

            which: 10009,

            preventDefault:
                function () {

                    try {

                        event.preventDefault();

                    } catch (e) {}
                },

            stopPropagation:
                function () {

                    try {

                        event.stopPropagation();

                    } catch (e) {}
                },

            stopImmediatePropagation:
                function () {

                    try {

                        event.stopImmediatePropagation();

                    } catch (e) {}
                }
        });
    }
}


/* ============================================================
   EVENT INSTALLATION
   ============================================================ */

function installRemoteLayer() {

    /*
     * This is the event path that the diagnostic
     * proved works on your TV.
     */
    document.addEventListener(
        'keydown',
        handleKey,
        true
    );


    /*
     * Samsung/Tizen hardware Back.
     */
    document.addEventListener(
        'tizenhwkey',
        handleTizenHardwareKey,
        true
    );


    /*
     * Do not register Arrow/Enter/Back here.
     *
     * Tizen provides those mandatory keys.
     *
     * The TizenBrew package handles the additional
     * media keys.
     */


    try {

        document.body.tabIndex =
            -1;

        document.body.focus();

    } catch (e) {}
}


/* ============================================================
   VIDEO EVENTS
   ============================================================ */

$('video')
    .addEventListener(
        'playing',
        function () {

            $('playerStatus')
                .textContent =
                'Playing';
        }
    );


$('video')
    .addEventListener(
        'waiting',
        function () {

            $('playerStatus')
                .textContent =
                'Buffering…';
        }
    );


$('video')
    .addEventListener(
        'pause',
        function () {

            if (
                currentChannel
            ) {

                $('playerStatus')
                    .textContent =
                    'Paused';
            }
        }
    );


$('video')
    .addEventListener(
        'error',
        function () {

            $('playerStatus')
                .textContent =
                'Stream error';


            toast(
                'The stream could not be played'
            );
        }
    );


/* ============================================================
   BUTTONS
   ============================================================ */

$('settingsBtn').onclick =
    function () {

        modalFocusIndex =
            0;

        settingsModal();
    };


$('searchBtn').onclick =
    function () {

        modalFocusIndex =
            0;

        searchModal();
    };


/* ============================================================
   INITIALISE
   ============================================================ */

async function init() {

    const playlist =
        state.playlists.find(
            function (item) {

                return (
                    item.id ===
                    state.selectedPlaylist
                );
            }
        );


    if (!playlist) {

        channels = [];

        groups = [];

        filtered = [];

        render();


        toast(
            'Open Settings to add your IPTV playlist'
        );


        return;
    }


    await refreshPlaylist(
        playlist,
        true
    );


    await refreshEpg(
        true
    );


    schedule();


    /*
     * Start the user in the category
     * sidebar, ready for the D-pad.
     */
    remoteArea =
        'sidebar';


    sidebarIndex =
        0;


    focusIndex =
        0;


    updateSidebarFocus();

    updateChannelFocus();
}


/* ============================================================
   START
   ============================================================ */

installRemoteLayer();

init();

})();

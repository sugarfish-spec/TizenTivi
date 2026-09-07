(function(){
'use strict';

const STORE='tizentivi_v2';
const DEFAULT={playlists:[],favorites:[],selectedPlaylist:null,selectedGroup:'__all',settings:{autoplay:true,autoPlaylistRefresh:360,autoEpgRefresh:360}};
let state=loadState(), channels=[], filtered=[], groups=[], focusIndex=0, sidebarIndex=0, currentChannel=null, epg={byId:{},last:0};
let area='sidebar', sidebarOpen=true, modalIndex=0, modalMode='', refreshTimer=null, epgTimer=null, lastKey='',lastKeyAt=0;

const $=id=>document.getElementById(id);
function loadState(){try{return Object.assign({},DEFAULT,JSON.parse(localStorage.getItem(STORE)||'null')||{})}catch(e){return Object.assign({},DEFAULT)}}
function save(){try{localStorage.setItem(STORE,JSON.stringify(state))}catch(e){}}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function toast(s){const e=$('toast');e.textContent=s;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2400)}
function normUrl(u){return String(u||'').trim().replace(/&amp;/g,'&').replace(/\/+$/,'')}
function playlist(){return state.playlists.find(p=>p.id===state.selectedPlaylist)||null}
function favKey(c){return String(c.uid||c.url||c.name)}
function isFav(c){return state.favorites.indexOf(favKey(c))>=0}
function toggleFav(c){if(!c)return;const k=favKey(c),i=state.favorites.indexOf(k);if(i<0){state.favorites.push(k);toast('Added to favourites')}else{state.favorites.splice(i,1);toast('Removed from favourites')}save();render()}

function parseAttrs(line){
 const o={},re=/([\w:-]+)="([^"]*)"/g;let m;
 while((m=re.exec(line)))o[m[1].toLowerCase()]=m[2];
 return o;
}
function parseM3U(text){
 const out=[],lines=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/);let meta=null,pending={};
 for(let i=0;i<lines.length;i++){
  const line=lines[i].trim(); if(!line)continue;
  if(line.indexOf('#EXTVLCOPT:')===0){const p=line.slice(12).split('=');pending[p.shift()]=p.join('=');continue}
  if(line.indexOf('#EXTINF:')===0){
   const comma=line.indexOf(','),head=comma>=0?line.slice(0,comma):line,name=comma>=0?line.slice(comma+1).trim():'Channel',a=parseAttrs(head);
   meta={name:name||'Channel',group:a['group-title']||a.group||'Uncategorised',logo:a['tvg-logo']||'',tvgId:a['tvg-id']||'',tvgName:a['tvg-name']||'',pending:Object.assign({},pending)};pending={};continue;
  }
  if(line[0]!=='#'&&meta){
   let url=line,ua=meta.pending['http-user-agent']||'';
   if(line.indexOf('|')>=0){const p=line.split('|');url=p.shift();const m=p.join('|').match(/User-Agent=([^&]+)/i);if(m)try{ua=decodeURIComponent(m[1])}catch(e){ua=m[1]}}
   out.push({uid:(meta.tvgId||meta.name)+'|'+url,name:meta.name,group:meta.group,logo:meta.logo,tvgId:meta.tvgId,tvgName:meta.tvgName,url:url.trim(),ua});
   meta=null;
  }
 }
 return out;
}
function groupList(list){
 const map=new Map();for(const c of list){const g=c.group||'Uncategorised';map.set(g,(map.get(g)||0)+1)}
 return Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
}
async function fetchText(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return r.text()}
async function fetchJson(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);return r.json()}
function xtreamUrl(p,action,extra){return normUrl(p.server)+'/player_api.php?username='+encodeURIComponent(p.username)+'&password='+encodeURIComponent(p.password)+'&action='+action+(extra?'&'+extra:'')}
async function loadXtream(p){
 const base=normUrl(p.server);
 const info=await fetchJson(base+'/player_api.php?username='+encodeURIComponent(p.username)+'&password='+encodeURIComponent(p.password));
 if(info.user_info&&String(info.user_info.auth)==='0')throw Error('Xtream login rejected');
 const cats=await fetchJson(xtreamUrl(p,'get_live_categories')), streams=await fetchJson(xtreamUrl(p,'get_live_streams'));
 const cm={};(cats||[]).forEach(c=>cm[String(c.category_id)]=c.category_name||'Uncategorised');
 return (streams||[]).map(s=>({uid:'xtream:'+s.stream_id,name:s.name||'Channel',group:cm[String(s.category_id)]||'Uncategorised',logo:s.stream_icon||'',tvgId:s.epg_channel_id||'',tvgName:s.epg_channel_id||'',url:base+'/live/'+encodeURIComponent(p.username)+'/'+encodeURIComponent(p.password)+'/'+s.stream_id+'.ts',xtream:{base,user:p.username,pass:p.password,id:s.stream_id,epg:s.epg_channel_id||''}}));
}
async function loadPlaylist(p){return p.type==='xtream'?loadXtream(p):parseM3U(await fetchText(p.url))}
async function refreshPlaylist(p,quiet){
 if(!p)return;
 try{
  toast(quiet?'Refreshing…':'Loading playlist…'); const list=await loadPlaylist(p);
  channels=list;groups=groupList(channels);p.lastRefresh=Date.now();save();
  if(state.selectedGroup!=='__all'&&state.selectedGroup!=='__fav'&&!groups.some(x=>x[0]===state.selectedGroup))state.selectedGroup='__all';
  focusIndex=Math.min(focusIndex,Math.max(0,filtered.length-1));render();toast(channels.length.toLocaleString()+' channels loaded');
 }catch(e){toast('Playlist error: '+e.message)}
}
function applyFilter(){
 if(state.selectedGroup==='__fav')filtered=channels.filter(isFav);
 else if(state.selectedGroup==='__all')filtered=channels;
 else filtered=channels.filter(c=>(c.group||'Uncategorised')===state.selectedGroup);
 if(focusIndex>=filtered.length)focusIndex=Math.max(0,filtered.length-1);
}
function renderSidebar(){
 const el=$('sidebar');let html='';
 html+='<div class="side-item '+(state.selectedGroup==='__all'?'selected ':'')+(area==='sidebar'&&sidebarIndex===0?'remote-focused':'')+'" data-side="__all"><span>All Channels</span><span class="count">'+channels.length.toLocaleString()+'</span></div>';
 html+='<div class="side-item '+(state.selectedGroup==='__fav'?'selected ':'')+(area==='sidebar'&&sidebarIndex===1?'remote-focused':'')+'" data-side="__fav"><span>Favourites</span><span class="count">'+state.favorites.length.toLocaleString()+'</span></div>';
 groups.forEach((g,i)=>{const idx=i+2;html+='<div class="side-item '+(state.selectedGroup===g[0]?'selected ':'')+(area==='sidebar'&&sidebarIndex===idx?'remote-focused':'')+'" data-side="'+esc(g[0])+'"><span>'+esc(g[0])+'</span><span class="count">'+g[1].toLocaleString()+'</span></div>'});
 el.innerHTML=html;
}
const COLS=4,WINDOW_ROWS=5,WINDOW=COLS*WINDOW_ROWS;
function renderChannels(){
 const grid=$('channelGrid');grid.innerHTML='';
 if(!filtered.length){grid.innerHTML='<div class="empty-state">'+(channels.length?'No channels in this category':'Add a playlist in Settings')+'</div>';return}
 const row=Math.floor(focusIndex/COLS),start=Math.max(0,(row-2)*COLS),end=Math.min(filtered.length,start+WINDOW);
 const topRows=Math.floor(start/COLS),bottomRows=Math.ceil((filtered.length-end)/COLS);
 if(topRows)grid.appendChild(Object.assign(document.createElement('div'),{className:'virtual-spacer',style:'grid-column:1/-1;height:'+(topRows*108)+'px'}));
 for(let i=start;i<end;i++){
  const c=filtered[i],d=document.createElement('div');d.className='channel'+(area==='channels'&&i===focusIndex?' remote-focused':'');
  const logo=c.logo?'<img class="channel-logo" src="'+esc(c.logo)+'" onerror="this.style.display=&quot;none&quot;">':'<div class="channel-logo fallback">TV</div>';
  d.innerHTML=logo+'<div class="channel-meta"><div class="channel-title">'+esc(c.name)+'</div><div class="channel-sub">'+esc(c.group)+'</div></div><div class="channel-star '+(isFav(c)?'on':'')+'">★</div>';
  d.onclick=()=>{focusIndex=i;area='channels';playCurrent()};grid.appendChild(d);
 }
 if(bottomRows)grid.appendChild(Object.assign(document.createElement('div'),{className:'virtual-spacer',style:'grid-column:1/-1;height:'+(bottomRows*108)+'px'}));
}
function render(){
 applyFilter();const p=playlist();$('playlistName').textContent=p?p.name:'No playlist';
 $('categoryTitle').textContent=state.selectedGroup==='__fav'?'Favourites':state.selectedGroup==='__all'?'All Channels':state.selectedGroup;
 $('channelCount').textContent=filtered.length.toLocaleString()+' channel'+(filtered.length===1?'':'s');
 renderSidebar();renderChannels();updateNow();
}
function updateNow(){
 const c=currentChannel;
 $('nowSideTitle').textContent=c?c.name:'No channel';$('nowSideGroup').textContent=c?c.group:'—';
 $('nowTitle').textContent=c?c.name:'No channel selected';
 $('videoEmpty').style.display=($('video').src||!c)?'flex':'none';
}
function updateGridAfterMove(){renderChannels();const el=$('channelGrid').querySelector('.remote-focused');if(el)el.scrollIntoView({block:'center',inline:'nearest'})}
function selectSidebar(){
 const items=['__all','__fav'].concat(groups.map(x=>x[0]));state.selectedGroup=items[Math.max(0,Math.min(sidebarIndex,items.length-1))];focusIndex=0;area='channels';sidebarOpen=false;render()
}
function moveSidebar(d){const max=1+groups.length;sidebarIndex=Math.max(0,Math.min(max,sidebarIndex+d));area='sidebar';renderSidebar()}
function moveChannel(d){
 if(!filtered.length)return;
 const old=focusIndex;let next=old+d;
 if(d===1&&old%COLS===COLS-1)next=old+1;
 if(d===-1&&old%COLS===0)next=old-1;
 next=Math.max(0,Math.min(filtered.length-1,next));
 focusIndex=next;area='channels';if(next!==old)updateGridAfterMove();
}
function openSidebar(){sidebarOpen=true;area='sidebar';renderSidebar();$('sidebar').style.display='block'}
function closeSidebar(){sidebarOpen=false;area='channels';$('sidebar').style.display='block';updateGridAfterMove()}
function playChannel(c){
 if(!c)return;currentChannel=c;const v=$('video');$('videoEmpty').style.display='none';$('playerBadge').textContent='LOADING';
 try{v.pause()}catch(e){}
 v.removeAttribute('src');v.load();v.src=c.url;v.play().then(()=>{$('playerBadge').textContent='LIVE';$('playerStatus').textContent='Playing'}).catch(()=>{$('playerBadge').textContent='READY';$('playerStatus').textContent='Playback unavailable';toast('Stream could not be played')});
 updateNow();
}
function playCurrent(){if(filtered[focusIndex])playChannel(filtered[focusIndex])}
function stop(){const v=$('video');try{v.pause();v.removeAttribute('src');v.load()}catch(e){}$('playerBadge').textContent='STOPPED';if(currentChannel)$('playerStatus').textContent='Stopped'}
function channelNext(delta){if(!filtered.length)return;focusIndex=(focusIndex+delta+filtered.length)%filtered.length;area='channels';updateGridAfterMove();playCurrent()}
function epgLookup(c){
 if(!c)return null;return epg.byId[c.tvgId||c.tvgName||'']||null
}
function updateEpg(){
 const p=playlist();if(!p)return;
 if(p.type==='xtream')return refreshXtreamEpg(p);
 if(!p.epgUrl)return;
 fetchText(p.epgUrl).then(parseXMLTV).then(()=>updateEpgDisplay()).catch(()=>{});
}
function parseXMLTV(text){
 const xml=new DOMParser().parseFromString(text,'text/xml'),map={};
 Array.from(xml.getElementsByTagName('programme')).forEach(n=>{
  const id=n.getAttribute('channel')||'',title=n.getElementsByTagName('title')[0]?.textContent||'',desc=n.getElementsByTagName('desc')[0]?.textContent||'',start=n.getAttribute('start')||'',stop=n.getAttribute('stop')||'';
  if(!map[id])map[id]=[];map[id].push({title,desc,start,stop})
 });epg.byId=map;epg.last=Date.now();updateEpgDisplay()
}
async function refreshXtreamEpg(p){
 const c=currentChannel;if(!c?.xtream?.id)return;
 try{const d=await fetchJson(xtreamUrl(p,'get_short_epg','stream_id='+encodeURIComponent(c.xtream.id)+'&limit=10'));epg.byId[c.tvgId||c.xtream.id]=(d.epg_list||[]).map(x=>({title:x.title||'',desc:x.description||'',start:x.start||'',stop:x.end||''}));updateEpgDisplay()}catch(e){}
}
function updateEpgDisplay(){
 const c=currentChannel,x=epgLookup(c);let item=null;
 if(Array.isArray(x)&&x.length){const now=Date.now();item=x.find(a=>{const t=Date.parse(a.start),z=Date.parse(a.stop);return !isNaN(t)&&!isNaN(z)&&now>=t&&now<z})||x[0]}
 $('epgTitle').textContent=item?item.title:'EPG';$('epgDesc').textContent=item?(item.desc||'No programme description'):'No programme information';
}
function schedule(){
 clearInterval(refreshTimer);clearInterval(epgTimer);const p=playlist();if(!p)return;
 const mins=Number(state.settings.autoPlaylistRefresh)||0;if(mins>0)refreshTimer=setInterval(()=>refreshPlaylist(p,true),mins*60000);
 const em=Number(state.settings.autoEpgRefresh)||0;if(em>0)epgTimer=setInterval(updateEpg,em*60000)
}

function showModal(title,body,actions,mode){
 modalMode=mode||'';modalIndex=0;$('modalRoot').innerHTML='<div class="modal"><h2>'+title+'</h2>'+body+'<div class="modal-actions">'+(actions||'')+'</div></div>';$('modalRoot').classList.remove('hidden');applyModalFocus()
}
function closeModal(){ $('modalRoot').classList.add('hidden');$('modalRoot').innerHTML='';modalMode='';modalIndex=0;area=sidebarOpen?'sidebar':'channels';render() }
function modalItems(){return Array.from($('modalRoot').querySelectorAll('[data-remote],button,input,select')).filter(e=>!e.disabled)}
function applyModalFocus(){const items=modalItems();items.forEach((e,i)=>e.classList.toggle('remote-focused',i===modalIndex));const e=items[modalIndex];if(e&&!['INPUT','SELECT'].includes(e.tagName))e.scrollIntoView({block:'nearest'});else if(e)e.scrollIntoView({block:'nearest'})}
function modalMove(d){const items=modalItems();if(!items.length)return;modalIndex=Math.max(0,Math.min(items.length-1,modalIndex+d));applyModalFocus()}
function modalEnter(){
 const items=modalItems(),e=items[modalIndex];if(!e)return;
 if(e.tagName==='INPUT'||e.tagName==='SELECT'){e.focus();return}
 e.click()
}
function settingsModal(){
 const p=playlist();
 const body='<div class="modal-grid">'+
 '<div class="field"><label>Playlist name</label><input id="setName" value="'+esc(p?.name||'My IPTV')+'" data-remote></div>'+
 '<div class="field"><label>Type</label><select id="setType" data-remote><option value="xtream" '+(p?.type==='xtream'?'selected':'')+'>Xtream Codes</option><option value="m3u" '+(p?.type==='m3u'?'selected':'')+'>M3U / M3U8</option></select></div>'+
 '<div id="xtreamFields" class="field full"><div class="modal-grid"><div class="field"><label>Server URL</label><input id="setServer" value="'+esc(p?.server||'')+'" data-remote></div><div class="field"><label>Username</label><input id="setUser" value="'+esc(p?.username||'')+'" data-remote></div><div class="field"><label>Password</label><input id="setPass" type="password" value="'+esc(p?.password||'')+'" data-remote></div></div></div>'+
 '<div id="m3uFields" class="field full"><label>M3U URL</label><input id="setUrl" value="'+esc(p?.url||'')+'" data-remote><label>XMLTV EPG URL (optional)</label><input id="setEpg" value="'+esc(p?.epgUrl||'')+'" data-remote></div>'+
 '<div class="field"><label>Automatic playlist refresh minutes (0 = off)</label><input id="setRefresh" type="number" value="'+esc(state.settings.autoPlaylistRefresh)+'" data-remote></div>'+
 '<div class="field"><label>Automatic EPG refresh minutes (0 = off)</label><input id="setEpgRefresh" type="number" value="'+esc(state.settings.autoEpgRefresh)+'" data-remote></div>'+
 '</div>'+
 '<div class="hint">Enter on a text field opens the TV keyboard. Save then Load to download the playlist.</div>'+
 '<div class="hint">Saved playlists: '+state.playlists.length+'</div>';
 const actions='<button class="modal-btn" data-remote id="loadBtn">SAVE & LOAD</button><button class="modal-btn" data-remote id="deleteBtn">DELETE</button><button class="modal-btn" data-remote id="cancelBtn">CANCEL</button>';
 showModal('IPTV Settings',body,actions,'settings');
 const type=$('setType');const sync=()=>{const x=type.value==='xtream';$('xtreamFields').style.display=x?'block':'none';$('m3uFields').style.display=x?'none':'block'};type.onchange=sync;sync();
 $('loadBtn').onclick=savePlaylistFromModal;$('deleteBtn').onclick=deletePlaylistFromModal;$('cancelBtn').onclick=closeModal;
}
function savePlaylistFromModal(){
 const type=$('setType').value,name=$('setName').value.trim()||'My IPTV';
 let p=playlist();if(!p){p={id:'p_'+Date.now(),name,type};state.playlists.push(p);state.selectedPlaylist=p.id}else{p.name=name;p.type=type}
 p.name=name;p.type=type;p.server=$('setServer')?.value.trim()||'';p.username=$('setUser')?.value.trim()||'';p.password=$('setPass')?.value||'';p.url=$('setUrl')?.value.trim()||'';p.epgUrl=$('setEpg')?.value.trim()||'';
 state.settings.autoPlaylistRefresh=Math.max(0,Number($('setRefresh').value)||0);state.settings.autoEpgRefresh=Math.max(0,Number($('setEpgRefresh').value)||0);save();closeModal();refreshPlaylist(p,false).then(schedule)
}
function deletePlaylistFromModal(){const p=playlist();if(!p){closeModal();return}state.playlists=state.playlists.filter(x=>x.id!==p.id);state.selectedPlaylist=state.playlists[0]?.id||null;channels=[];groups=[];currentChannel=null;focusIndex=0;state.selectedGroup='__all';save();closeModal();toast('Playlist deleted')}
function searchModal(){
 const body='<input id="searchInput" data-remote placeholder="Search channels…" autocomplete="off"><div class="hint">Type a channel name, then use ▲▼ and OK. BACK closes search.</div><div id="searchResults" class="search-results"></div>';
 showModal('Search',body,'','search');const inp=$('searchInput');inp.oninput=renderSearchResults;renderSearchResults()
}
function renderSearchResults(){
 const q=($('searchInput')?.value||'').trim().toLowerCase(),box=$('searchResults');if(!box)return;
 const res=q?channels.filter(c=>c.name.toLowerCase().indexOf(q)>=0).slice(0,100):[];
 box.innerHTML=res.length?res.map((c,i)=>'<div class="search-result" data-remote data-search-index="'+i+'"><span>'+esc(c.name)+'</span><span class="rgroup">'+esc(c.group)+'</span></div>').join(''):'<div class="search-result"><span>'+ (q?'No matches':'Start typing…')+'</span></div>';
 Array.from(box.querySelectorAll('[data-search-index]')).forEach(e=>e.onclick=()=>{const c=res[Number(e.dataset.searchIndex)];const idx=filtered.indexOf(c);if(idx>=0)focusIndex=idx;closeModal();playChannel(c)})
 modalIndex=0;applyModalFocus()
}

const KEY={Enter:13,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Back:10009,Escape:27,MediaPlay:415,MediaPause:19,MediaPlayPause:10252,MediaStop:413,MediaRewind:412,MediaFastForward:417,MediaTrackPrevious:10232,MediaTrackNext:10233,ColorF0Red:403,ColorF1Green:404,ColorF2Yellow:405,ColorF3Blue:406};
function keyName(e){const code=Number(e?.keyCode||e?.which||0);for(const k in KEY)if(KEY[k]===code)return k;const s=e?.key||'';if(s==='Return')return 'Back';return s}
function swallow(e){try{e.preventDefault();e.stopPropagation();e.stopImmediatePropagation()}catch(x){}}
function dup(k){const n=Date.now();if(k===lastKey&&n-lastKeyAt<60)return true;lastKey=k;lastKeyAt=n;return false}
function handleKey(e){
 const k=keyName(e);if(!k)return;if(dup(k)){swallow(e);return}
 if(!$('modalRoot').classList.contains('hidden')){
  if(k==='Back'||k==='Escape'){closeModal();swallow(e);return}
  if(k==='ArrowUp'){modalMove(-1);swallow(e);return}
  if(k==='ArrowDown'){modalMove(1);swallow(e);return}
  if(k==='ArrowLeft'||k==='ArrowRight'){return}
  if(k==='Enter'){modalEnter();swallow(e);return}
  return
 }
 if(k==='Back'||k==='Escape'){sidebarOpen?closeSidebar():openSidebar();swallow(e);return}
 if(k==='ArrowLeft'){if(area==='channels'){if(focusIndex%COLS===0)openSidebar();else moveChannel(-1)}else moveSidebar(0);swallow(e);return}
 if(k==='ArrowRight'){if(area==='sidebar')closeSidebar();else moveChannel(1);swallow(e);return}
 if(k==='ArrowUp'){if(area==='sidebar')moveSidebar(-1);else moveChannel(-COLS);swallow(e);return}
 if(k==='ArrowDown'){if(area==='sidebar')moveSidebar(1);else moveChannel(COLS);swallow(e);return}
 if(k==='Enter'){if(area==='sidebar')selectSidebar();else playCurrent();swallow(e);return}
 if(k==='MediaPlayPause'){const v=$('video');v.paused?v.play().catch(()=>{}):v.pause();swallow(e);return}
 if(k==='MediaPlay'){$('video').play().catch(()=>{});swallow(e);return}
 if(k==='MediaPause'){$('video').pause();swallow(e);return}
 if(k==='MediaStop'){stop();swallow(e);return}
 if(k==='MediaRewind'){try{$('video').currentTime=Math.max(0,$('video').currentTime-10)}catch(x){}swallow(e);return}
 if(k==='MediaFastForward'){try{$('video').currentTime+=10}catch(x){}swallow(e);return}
 if(k==='MediaTrackPrevious'){channelNext(-1);swallow(e);return}
 if(k==='MediaTrackNext'){channelNext(1);swallow(e);return}
 if(k==='ColorF0Red'){toggleFav(currentChannel||filtered[focusIndex]);swallow(e);return}
 if(k==='ColorF1Green'){settingsModal();swallow(e);return}
 if(k==='ColorF2Yellow'){searchModal();swallow(e);return}
 if(k==='ColorF3Blue'){const p=playlist();if(p)refreshPlaylist(p,false);updateEpg();swallow(e);return}
}
function handleTizen(e){const n=String(e?.keyName||'').toLowerCase();if(n==='back'||n==='return')handleKey({key:'Back',keyCode:10009,preventDefault:()=>{try{e.preventDefault()}catch(x){}},stopPropagation:()=>{},stopImmediatePropagation:()=>{}})}

$('searchBtn').onclick=searchModal;$('settingsBtn').onclick=settingsModal;
$('video').addEventListener('playing',()=>{$('playerBadge').textContent='LIVE';$('playerStatus').textContent='Playing';$('videoEmpty').style.display='none'});
$('video').addEventListener('waiting',()=>{$('playerBadge').textContent='BUFFERING'});
$('video').addEventListener('error',()=>{$('playerBadge').textContent='ERROR';$('playerStatus').textContent='Playback error'});
$('video').addEventListener('pause',()=>{if(currentChannel)$('playerBadge').textContent='PAUSED'});
document.addEventListener('keydown',handleKey,true);
document.addEventListener('tizenhwkey',handleTizen,true);
document.addEventListener('click',e=>{const s=e.target.closest('.side-item');if(s){state.selectedGroup=s.dataset.side;focusIndex=0;area='channels';sidebarOpen=false;render()}});
render();schedule();
if(state.selectedPlaylist){const p=playlist();if(p)refreshPlaylist(p,true)}
})();

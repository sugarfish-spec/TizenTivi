
(function(){
'use strict';

const STORE='iptv_tizenbrew_v1';
const DEFAULT={playlists:[],favorites:[],selectedPlaylist:null,selectedGroup:'__all__',
  autoPlaylistRefresh:360,autoEpgRefresh:360,settings:{autoplay:true}};
let state=load();
let channels=[], groups=[], filtered=[], focusIndex=0, sidebarIndex=0, sidebarOpen=true;
let epg={byId:{},last:0}, currentChannel=null, refreshTimer=null, epgTimer=null, searchResults=[];
function $(id){return document.getElementById(id)}

function load(){try{var saved=JSON.parse(localStorage.getItem(STORE)||'null');return Object.assign({},DEFAULT,saved||{})}catch(e){return Object.assign({},DEFAULT)}}
function save(){localStorage.setItem(STORE,JSON.stringify(state))}
function toast(s){const t=$('toast');t.textContent=s;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2600)}
function esc(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function normUrl(u){return String(u||'').trim().replace(/&amp;/g,'&')}
function favKey(c){return (c.uid||c.url||c.name).toString()}
function isFav(c){return state.favorites.indexOf(favKey(c))>=0}
function toggleFav(c){const k=favKey(c);const i=state.favorites.indexOf(k);if(i<0)state.favorites.push(k);else state.favorites.splice(i,1);save();render()}
function parseAttrs(line){
  const o={}; const re=/([\w-]+)="([^"]*)"/g; let m;
  while((m=re.exec(line)))o[m[1].toLowerCase()]=m[2];
  return o;
}
function parseM3U(text,base){
  const out=[]; const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/); let meta=null, pendingOpt={};
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim(); if(!line)continue;
    if(line.startsWith('#EXTVLCOPT:')){const p=line.slice(12).split('=');pendingOpt[p.shift()]=p.join('=');continue}
    if(line.startsWith('#EXTINF:')){
      const comma=line.indexOf(','); const head=comma>=0?line.slice(0,comma):line; const name=comma>=0?line.slice(comma+1).trim():'Channel';
      const attrs=parseAttrs(head); meta={name,group:attrs['group-title']||attrs['group']||'Uncategorised',
        logo:attrs['tvg-logo']||'',tvgId:attrs['tvg-id']||'',tvgName:attrs['tvg-name']||'',
        lang:attrs['tvg-language']||'',country:attrs['tvg-country']||'',pending:{...pendingOpt}}; pendingOpt={}; continue;
    }
    if(!line.startsWith('#') && meta){
      let url=line, ua=meta.pending['http-user-agent']||'';
      if(url.indexOf('|')>=0){const p=url.split('|');url=p.shift();const q=p.join('|');const mm=q.match(/User-Agent=([^&]+)/i);if(mm)ua=decodeURIComponent(mm[1])}
      out.push({uid:(meta.tvgId||meta.name)+'|'+url,name:meta.name,group:meta.group,logo:meta.logo,tvgId:meta.tvgId,tvgName:meta.tvgName,url:normUrl(url),ua});
      meta=null;
    }
  }
  return out;
}
function groupsFor(list){
  const m=new Map(); list.forEach(c=>{if(!m.has(c.group))m.set(c.group,0);m.set(c.group,m.get(c.group)+1)});
  return [...m.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
}
async function fetchText(url){
  const r=await fetch(url,{cache:'no-store'}); if(!r.ok)throw new Error('HTTP '+r.status); return r.text();
}
async function fetchJson(url){
  const r=await fetch(url,{cache:'no-store'}); if(!r.ok)throw new Error('HTTP '+r.status); return r.json();
}
function xtreamBase(s){return normUrl(s).replace(/\/+$/,'')}
function xtreamUrl(base,user,pass,action,extra=''){
  return xtreamBase(base)+'/player_api.php?username='+encodeURIComponent(user)+'&password='+encodeURIComponent(pass)+'&action='+action+(extra?'&'+extra:'');
}
async function loadXtream(p){
  const base=xtreamBase(p.server), u=encodeURIComponent(p.username), pw=encodeURIComponent(p.password);
  const api=base+'/player_api.php?username='+u+'&password='+pw;
  const info=await fetchJson(api);
  if(info.user_info && String(info.user_info.auth)==='0')throw new Error('Xtream login rejected');
  const cats=await fetchJson(xtreamUrl(base,p.username,p.password,'get_live_categories'));
  const streams=await fetchJson(xtreamUrl(base,p.username,p.password,'get_live_streams'));
  const catMap={}; (cats||[]).forEach(c=>catMap[String(c.category_id)]=c.category_name||'Uncategorised');
  return (streams||[]).map(x=>({uid:'xtream:'+x.stream_id,name:x.name||'Channel',group:catMap[String(x.category_id)]||'Uncategorised',
    logo:x.stream_icon||'',tvgId:x.epg_channel_id||'',tvgName:x.epg_channel_id||'',
    url:base+'/live/'+encodeURIComponent(p.username)+'/'+encodeURIComponent(p.password)+'/'+x.stream_id+'.ts',
    xtream:{base,user:p.username,pass:p.password,id:x.stream_id,epg:x.epg_channel_id||''}}));
}
async function loadPlaylist(p){
  if(p.type==='xtream') return loadXtream(p);
  const text=await fetchText(p.url); return parseM3U(text,p.url);
}
async function refreshPlaylist(p,quiet){
  if(!p)return;
  try{
    channels=await loadPlaylist(p);
    p.lastRefresh=Date.now(); save();
    groups=groupsFor(channels);
    if(state.selectedGroup==='__all' || state.selectedGroup==='__fav' || !groups.some(x=>x[0]===state.selectedGroup))state.selectedGroup='__all';
    render();
    if(!quiet)toast('Playlist refreshed · '+channels.length+' channels');
  }catch(e){toast('Playlist refresh failed: '+e.message)}
}
function applyFilter(){
  if(state.selectedGroup==='__fav')filtered=channels.filter(isFav);
  else if(state.selectedGroup==='__all')filtered=channels;
  else filtered=channels.filter(c=>c.group===state.selectedGroup);
  filtered=filtered.slice().sort((a,b)=>a.name.localeCompare(b.name));
  focusIndex=Math.max(0,Math.min(focusIndex,Math.max(0,filtered.length-1)));
}
function renderSidebar(){
  const favCount=channels.filter(isFav).length;
  let h='<div class="side-item '+(state.selectedGroup==='__all'?'active':'')+'" data-side="__all">All Channels <span class="count">'+channels.length+'</span></div>';
  h+='<div class="side-item '+(state.selectedGroup==='__fav'?'active':'')+'" data-side="__fav">★ Favourites <span class="count">'+favCount+'</span></div>';
  groups.forEach(([g,n])=>h+='<div class="side-item '+(state.selectedGroup===g?'active':'')+'" data-side="'+esc(g)+'">'+esc(g)+' <span class="count">'+n+'</span></div>');
  $('sidebar').innerHTML=h;
  [...$('sidebar').querySelectorAll('.side-item')].forEach((el,i)=>{el.tabIndex=0;el.onclick=()=>{state.selectedGroup=el.dataset.side;sidebarIndex=i;focusIndex=0;save();render()}})
}
function render(){
  applyFilter(); renderSidebar();
  $('playlistName').textContent=state.playlists.find(p=>p.id===state.selectedPlaylist)?.name||'No playlist';
  $('categoryTitle').textContent=state.selectedGroup==='__fav'?'Favourites':state.selectedGroup==='__all'?'All Channels':state.selectedGroup;
  $('channelCount').textContent=filtered.length+' channels';
  const g=$('channelGrid'); g.innerHTML='';
  filtered.slice(0,180).forEach((c,i)=>{
    const d=document.createElement('div');d.className='channel '+(i===focusIndex?'focused':'');d.dataset.i=i;d.tabIndex=0;
    const logo=c.logo?'<img class="channel-logo" src="'+esc(c.logo)+'" onerror="this.style.display=\'none\'">':'<div class="channel-logo fallback">TV</div>';
    d.innerHTML=logo+'<div class="channel-meta"><div class="channel-title">'+esc(c.name)+'</div><div class="channel-sub">'+esc(c.group)+'</div></div><div class="star '+(isFav(c)?'on':'')+'">★</div>';
    d.onclick=()=>playIndex(i); d.onmouseenter=()=>setFocus(i); g.appendChild(d);
  });
}
function setFocus(i){focusIndex=Math.max(0,Math.min(i,filtered.length-1));[...$('channelGrid').children].forEach((x,n)=>x.classList.toggle('focused',n===focusIndex))}
function moveChannel(delta){
  if(!filtered.length)return;
  const cols=2; let n=focusIndex+delta;
  if(n<0)n=0;if(n>=filtered.length)n=filtered.length-1;setFocus(n);
}
function current(){return filtered[focusIndex]}
function playIndex(i){setFocus(i);playChannel(filtered[i])}
async function playChannel(c){
  if(!c)return; currentChannel=c;
  $('nowTitle').textContent=c.name;$('nowProgram').textContent='';$('playerStatus').textContent='Loading…';
  const logo=$('nowLogo');logo.style.backgroundImage=c.logo?'url("'+c.logo.replace(/"/g,'\\"')+'")':'none';
  let url=c.url;
  try{
    if(c.xtream){
      const ext=c.url.split('?')[0].split('.').pop().toLowerCase();
      url=c.url;
    }
    const v=$('video');v.pause();v.removeAttribute('src');v.load();
    if(c.ua && v.setAttribute) { /* Samsung HTML5 video does not expose custom UA; retained for metadata compatibility. */ }
    v.src=url; await v.play();
    $('playerStatus').textContent='Playing';
    loadChannelEpg(c);
  }catch(e){$('playerStatus').textContent='Playback error';toast('Cannot play channel: '+e.message)}
}
function stop(){const v=$('video');v.pause();v.removeAttribute('src');v.load();currentChannel=null;$('playerStatus').textContent='Stopped'}
async function loadChannelEpg(c){
  $('epgBar').classList.add('hidden');
  if(c.xtream){
    try{
      const x=c.xtream; const data=await fetchJson(xtreamUrl(x.base,x.user,x.pass,'get_short_epg','stream_id='+encodeURIComponent(x.id)+'&limit=2'));
      const items=data.epg_list||[]; if(items[0])showEpg({title:items[0].title,start:items[0].start,end:items[0].end,desc:items[0].description});
      return;
    }catch(e){}
  }
  const id=c.tvgId||c.tvgName;if(id && epg.byId[id] && epg.byId[id][0])showEpg(epg.byId[id][0]);
}
function showEpg(p){
  $('epgTitle').textContent=p.title||'Programme';
  $('epgTimes').textContent=(p.start||'')+(p.end?' – '+p.end:'');
  $('epgDesc').textContent=p.desc||'';
  $('epgBar').classList.remove('hidden');
}
function parseXmltv(text){
  const xml=new DOMParser().parseFromString(text,'application/xml');const out={};
  [...xml.querySelectorAll('programme')].forEach(n=>{
    const id=n.getAttribute('channel')||''; if(!id)return;
    const title=n.querySelector('title')?.textContent||''; const desc=n.querySelector('desc')?.textContent||'';
    const start=n.getAttribute('start')||'', end=n.getAttribute('stop')||'';
    const p={title,start:fmtXmlDate(start),end:fmtXmlDate(end),desc};
    (out[id]||(out[id]=[])).push(p);
  });
  return out;
}
function fmtXmlDate(s){if(!s)return '';const m=s.match(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?/);return m?m[3]+'/'+m[2]+' '+m[4]+':'+m[5]:s}
async function refreshEpg(quiet){
  const p=state.playlists.find(function(x){return x.id===state.selectedPlaylist});if(!p)return;
  let url=p.epgUrl;
  if(!url && p.type==='m3u' && p.lastEpgUrl)url=p.lastEpgUrl;
  if(!url){if(!quiet)toast('No EPG URL configured');return}
  try{epg.byId=parseXmltv(await fetchText(url));epg.last=Date.now();if(!quiet)toast('EPG refreshed');if(currentChannel)loadChannelEpg(currentChannel)}
  catch(e){if(!quiet)toast('EPG refresh failed: '+e.message)}
}
function schedule(){
  clearInterval(refreshTimer);clearInterval(epgTimer);
  const p=state.playlists.find(function(x){return x.id===state.selectedPlaylist});if(!p)return;
  const mins=Number(p.refreshMinutes||state.autoPlaylistRefresh||0);if(mins>0)refreshTimer=setInterval(()=>refreshPlaylist(p,true),mins*60000);
  const emins=Number(p.epgRefreshMinutes||state.autoEpgRefresh||0);if(emins>0)epgTimer=setInterval(()=>refreshEpg(true),emins*60000);
}
function openModal(title,body,actions=''){
  const r=$('modalRoot');r.classList.remove('hidden');r.innerHTML='<div class="modal"><h2>'+title+'</h2>'+body+'<div class="modal-actions">'+actions+'</div></div>';
  r.querySelectorAll('button,input,select').forEach(x=>x.tabIndex=0);
}
function closeModal(){$('modalRoot').classList.add('hidden');$('modalRoot').innerHTML=''}
function settingsModal(){
  let rows='<div class="form-row"><label>Saved playlists</label><div id="plistRows">';
  state.playlists.forEach(p=>rows+='<div class="list-row"><div class="grow"><b>'+esc(p.name)+'</b><div class="muted">'+esc(p.type==='xtream'?p.server:p.url)+'</div></div><button class="btn" data-edit="'+p.id+'">Edit</button><button class="btn danger" data-del="'+p.id+'">Delete</button></div>');
  rows+='</div></div><div class="form-row"><label>Global automatic refresh minutes (0 = off)</label><input id="autoRefresh" class="input" type="number" min="0" value="'+Number(state.autoPlaylistRefresh||0)+'"></div><div class="form-row"><label>Global EPG refresh minutes (0 = off)</label><input id="autoEpg" class="input" type="number" min="0" value="'+Number(state.autoEpgRefresh||0)+'"></div>';
  openModal('Settings',rows,'<button class="btn" id="addPlaylist">Add playlist</button><button class="btn" id="refreshNow">Refresh now</button><button class="btn primary" id="closeSettings">Done</button>');
  $('addPlaylist').onclick=()=>playlistModal();
  $('refreshNow').onclick=async()=>{const p=state.playlists.find(function(x){return x.id===state.selectedPlaylist});await refreshPlaylist(p);await refreshEpg();schedule()};
  $('closeSettings').onclick=()=>{state.autoPlaylistRefresh=Number($('autoRefresh').value)||0;state.autoEpgRefresh=Number($('autoEpg').value)||0;save();schedule();closeModal()};
  $('modalRoot').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{const id=b.dataset.del;state.playlists=state.playlists.filter(p=>p.id!==id);if(state.selectedPlaylist===id)state.selectedPlaylist=state.playlists[0]?.id||null;save();closeModal();init()});
  $('modalRoot').querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>playlistModal(state.playlists.find(p=>p.id===b.dataset.edit)));
}
function playlistModal(p){
  const x=p||{id:'p'+Date.now(),name:'My Playlist',type:'xtream',server:'',username:'',password:'',url:'',epgUrl:'',refreshMinutes:360,epgRefreshMinutes:360};
  const body='<div class="form-row"><label>Name</label><input id="pn" class="input" value="'+esc(x.name)+'"></div>'+
  '<div class="form-row"><label>Type</label><select id="pt" class="select"><option value="xtream" '+(x.type==='xtream'?'selected':'')+'>Xtream Codes</option><option value="m3u" '+(x.type==='m3u'?'selected':'')+'>M3U / M3U8 URL</option></select></div>'+
  '<div id="xtFields"><div class="form-row"><label>Server URL</label><input id="server" class="input" placeholder="https://example.com:8080" value="'+esc(x.server)+'"></div><div class="form-row"><label>Username</label><input id="user" class="input" value="'+esc(x.username)+'"></div><div class="form-row"><label>Password</label><input id="pass" class="input" type="password" value="'+esc(x.password)+'"></div></div>'+
  '<div id="m3uFields"><div class="form-row"><label>M3U / M3U8 URL</label><input id="url" class="input" value="'+esc(x.url)+'"></div></div>'+
  '<div class="form-row"><label>XMLTV EPG URL (optional)</label><input id="epg" class="input" value="'+esc(x.epgUrl)+'"></div>'+
  '<div class="form-row"><label>Playlist auto-refresh minutes (0 = off)</label><input id="rm" class="input" type="number" min="0" value="'+Number(x.refreshMinutes||0)+'"></div>'+
  '<div class="form-row"><label>EPG auto-refresh minutes (0 = off)</label><input id="erm" class="input" type="number" min="0" value="'+Number(x.epgRefreshMinutes||0)+'"></div>';
  openModal(p?'Edit playlist':'Add playlist',body,'<button class="btn" id="cancelP">Cancel</button><button class="btn primary" id="saveP">Save & Load</button>');
  function toggle(){const is=$('pt').value==='xtream';$('xtFields').style.display=is?'block':'none';$('m3uFields').style.display=is?'none':'block'}
  $('pt').onchange=toggle;toggle();$('cancelP').onclick=closeModal;
  $('saveP').onclick=async()=>{
    x.name=$('pn').value.trim()||'Playlist';x.type=$('pt').value;x.server=$('server') ? $('server').value.trim() : ''||'';x.username=$('user') ? $('user').value.trim() : ''||'';x.password=$('pass') ? $('pass').value : ''||'';x.url=$('url') ? $('url').value.trim() : ''||'';x.epgUrl=$('epg').value.trim();x.refreshMinutes=Number($('rm').value)||0;x.epgRefreshMinutes=Number($('erm').value)||0;
    const i=state.playlists.findIndex(q=>q.id===x.id);if(i>=0)state.playlists[i]=x;else state.playlists.push(x);state.selectedPlaylist=x.id;save();closeModal();await init()
  };
}
function searchModal(){
  const body='<div class="form-row"><label>Search channels</label><input id="searchInput" class="input" autofocus placeholder="Type channel name..."></div><div id="searchList" class="search-list"></div>';
  openModal('Search',body,'<button class="btn primary" id="closeSearch">Close</button>');$('closeSearch').onclick=closeModal;
  const input=$('searchInput');input.oninput=()=>{searchResults=channels.filter(c=>c.name.toLowerCase().includes(input.value.toLowerCase())).slice(0,80);$('searchList').innerHTML=searchResults.map((c,i)=>'<div class="search-result" data-s="'+i+'">'+esc(c.name)+' <span class="muted">· '+esc(c.group)+'</span></div>').join('');$('searchList').querySelectorAll('[data-s]').forEach(el=>el.onclick=()=>{const c=searchResults[Number(el.dataset.s)];var idx=filtered.indexOf(c);closeModal();if(idx>=0)playIndex(idx);else playChannel(c)})};
  input.focus()
}
function keyName(e){
  // Samsung TV sends the most reliable remote information in keyCode.
  // Prefer keyCode first, then fall back to KeyboardEvent.key for browsers.
  var code = Number(e && e.keyCode || e && e.which || 0);
  var m = {
    13:'Enter', 27:'Escape', 37:'ArrowLeft', 38:'ArrowUp', 39:'ArrowRight', 40:'ArrowDown',
    10009:'Back', 10182:'Exit',
    48:'0',49:'1',50:'2',51:'3',52:'4',53:'5',54:'6',55:'7',56:'8',57:'9',
    415:'MediaPlay', 19:'MediaPause', 10252:'MediaPlayPause', 413:'MediaStop',
    412:'MediaRewind', 417:'MediaFastForward', 10232:'MediaTrackPrevious', 10233:'MediaTrackNext',
    427:'ChannelUp', 428:'ChannelDown',
    403:'ColorF0Red', 404:'ColorF1Green', 405:'ColorF2Yellow', 406:'ColorF3Blue',
    18:'Menu', 457:'Info', 10072:'Source', 458:'Guide', 10225:'Search',
    447:'VolumeUp', 448:'VolumeDown', 449:'VolumeMute'
  };
  if(m[code]) return m[code];
  return String(e && e.key || '');
}
function preventRemoteDefault(e){
  if(e && e.preventDefault)e.preventDefault();
  if(e && e.stopPropagation)e.stopPropagation();
}
function handleKey(e){
  const k=keyName(e);
  if(!$('modalRoot').classList.contains('hidden')){
    if(k==='Escape'||k==='Back'||k==='Return'){
      closeModal();
      preventRemoteDefault(e);
    }
    return;
  }
  if(k==='Escape'||k==='Back'||k==='Return'){
    if(sidebarOpen){
      sidebarOpen=false;
      $('sidebar').style.display='none';
    }else{
      sidebarOpen=true;
      $('sidebar').style.display='block';
      focusSidebar();
    }
    preventRemoteDefault(e);
    return;
  }
  if(k==='ArrowLeft'){
    if(!sidebarOpen){
      sidebarOpen=true;
      $('sidebar').style.display='block';
      focusSidebar();
    }else if(document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('channel')){
      sidebarIndex=0;
      focusSidebar();
    }
    preventRemoteDefault(e);
    return;
  }
  if(k==='ArrowRight'){
    if(sidebarOpen){
      sidebarOpen=false;
      $('sidebar').style.display='none';
    }else{
      moveChannel(1);
    }
    preventRemoteDefault(e);
    return;
  }
  if(k==='ArrowUp'){
    if(sidebarOpen){
      sidebarIndex=Math.max(0,sidebarIndex-1);
      focusSidebar();
    }else{
      moveChannel(-2);
    }
    preventRemoteDefault(e);
    return;
  }
  if(k==='ArrowDown'){
    if(sidebarOpen){
      sidebarIndex=Math.min(Math.max(0,$('sidebar').children.length-1),sidebarIndex+1);
      focusSidebar();
    }else{
      moveChannel(2);
    }
    preventRemoteDefault(e);
    return;
  }
  if(k==='Enter'){
    if(sidebarOpen){
      var el=$('sidebar').children[sidebarIndex];
      if(el)el.click();
    }else{
      playChannel(current());
    }
    preventRemoteDefault(e);
    return;
  }
  if(k==='MediaPlayPause'){
    var v=$('video');
    if(v.paused){v.play().catch(function(){});}else{v.pause();}
    preventRemoteDefault(e);
    return;
  }
  if(k==='ChannelUp'){
    moveChannel(-1);
    playChannel(current());
    preventRemoteDefault(e);
    return;
  }
  if(k==='ChannelDown'){
    moveChannel(1);
    playChannel(current());
    preventRemoteDefault(e);
    return;
  }
  if(k==='MediaPlay'){
    $('video').play().catch(function(){});
    preventRemoteDefault(e);
    return;
  }
  if(k==='MediaPause'){
    $('video').pause();
    preventRemoteDefault(e);
    return;
  }
  if(k==='MediaStop'){
    stop();
    preventRemoteDefault(e);
    return;
  }
  if(k==='MediaRewind'){
    try{$('video').currentTime=Math.max(0,$('video').currentTime-10);}catch(err){}
    preventRemoteDefault(e);
    return;
  }
  if(k==='MediaFastForward'){
    try{$('video').currentTime=$('video').currentTime+10;}catch(err){}
    preventRemoteDefault(e);
    return;
  }
  if(k==='MediaTrackPrevious'){
    moveChannel(-1);
    playChannel(current());
    preventRemoteDefault(e);
    return;
  }
  if(k==='MediaTrackNext'){
    moveChannel(1);
    playChannel(current());
    preventRemoteDefault(e);
    return;
  }
  if(k==='ColorF0Red'){
    if(currentChannel)toggleFav(currentChannel);
    preventRemoteDefault(e);
    return;
  }
  if(k==='ColorF1Green'){
    settingsModal();
    preventRemoteDefault(e);
    return;
  }
  if(k==='ColorF2Yellow'){
    searchModal();
    preventRemoteDefault(e);
    return;
  }
  if(k==='ColorF3Blue'){
    refreshPlaylist(state.playlists.find(function(p){return p.id===state.selectedPlaylist}));
    refreshEpg();
    preventRemoteDefault(e);
    return;
  }
  if(/^[0-9]$/.test(k)){
    var n=Number(k);
    if(n>0){
      var idx=n-1;
      if(filtered[idx])playIndex(idx);
    }
    preventRemoteDefault(e);
  }
}

function focusSidebar(){const els=$('sidebar').children;[...els].forEach((x,i)=>x.classList.toggle('active',i===sidebarIndex));if(els[sidebarIndex]&&els[sidebarIndex].scrollIntoView)els[sidebarIndex].scrollIntoView({block:'nearest'})}
async function init(){
  const p=state.playlists.find(function(x){return x.id===state.selectedPlaylist});
  if(!p){render();toast('Add an Xtream or M3U playlist in Settings');return}
  await refreshPlaylist(p,true);await refreshEpg(true);schedule();
}
document.addEventListener('keydown',handleKey,true);
if(document.body)document.body.addEventListener('keydown',handleKey,false);
window.addEventListener('keydown',handleKey,false);
$('settingsBtn').onclick=settingsModal;$('searchBtn').onclick=searchModal; $('settingsBtn').tabIndex=0;$('searchBtn').tabIndex=0;
$('video').addEventListener('error',()=>{$('playerStatus').textContent='Stream error';toast('The stream could not be decoded or is unavailable')});
$('video').addEventListener('playing',()=>{$('playerStatus').textContent='Playing'});
$('video').addEventListener('waiting',()=>{$('playerStatus').textContent='Buffering…'});
if(document.body){document.body.tabIndex=-1;try{document.body.focus();}catch(e){}}
init();
})();

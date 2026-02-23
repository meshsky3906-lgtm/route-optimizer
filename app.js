/* ============================================================
   Route Optimizer – app.js  v8.0
   ✅ TSP 座標排序（多起點 NN + 2-opt + Or-opt）
   ✅ 分類篩選：藥局 / 診所 / 醫院
   ✅ 內建 30 個測試地址（含店名、GPS 座標）
   ✅ 多主題切換
   起點 = 終點 = 仁武區興昌巷10號（固定）
   ============================================================ */

'use strict';

const FIXED_HOME = '高雄市仁武區興昌巷10號';
const FIXED_HOME_LABEL = '仁武區興昌巷10號';
const FIXED_HOME_COORD = { lat: 22.7124, lng: 120.3395 };

const LS_STOPS = 'routeopt_stops_v3';
const LS_FAVORITES = 'routeopt_favorites_v2';
const LS_GEOCACHE = 'routeopt_geocache_v1';
const LS_THEME = 'routeopt_theme';
const LS_INIT = 'routeopt_initialized'; // 初始化標記

const THEMES = [
  { id: '', label: '🌑 暗夜' },
  { id: 'ocean', label: '🌊 海洋' },
  { id: 'sunset', label: '🌅 日落' },
  { id: 'mint', label: '🍃 薄荷' },
];

// ── 醫院測試地址（僅保留 10 筆醫院）─────────────
const TEST_ADDRESSES = [
  { address: '高雄市左營區大中一路386號', name: '高雄榮民總醫院', type: '醫院', lat: 22.6818, lng: 120.2917 },
  { address: '高雄市鳥松區大埤路123號', name: '高雄長庚紀念醫院', type: '醫院', lat: 22.6494, lng: 120.3540 },
  { address: '高雄市三民區自由一路100號', name: '高雄醫學大學附設醫院', type: '醫院', lat: 22.6508, lng: 120.3111 },
  { address: '高雄市燕巢區角宿里義大路1號', name: '義大醫院', type: '醫院', lat: 22.7530, lng: 120.3647 },
  { address: '高雄市苓雅區中正一路2號', name: '國軍高雄總醫院', type: '醫院', lat: 22.6198, lng: 120.3073 },
  { address: '高雄市前金區中華三路68號', name: '高雄市立大同醫院', type: '醫院', lat: 22.6292, lng: 120.2960 },
  { address: '高雄市小港區山明路482號', name: '高雄市立小港醫院', type: '醫院', lat: 22.5651, lng: 120.3528 },
  { address: '高雄市鳳山區經武路42號', name: '高雄市立鳳山醫院', type: '醫院', lat: 22.6265, lng: 120.3547 },
  { address: '高雄市苓雅區成功一路162號', name: '阮綜合醫院', type: '醫院', lat: 22.6215, lng: 120.3095 },
  { address: '高雄市前鎮區中華五路2號', name: '高雄市立聯合醫院', type: '醫院', lat: 22.5960, lng: 120.3060 },
];

const DISTRICT_ORDER = [
  '仁武區', '鳥松區', '大社區', '燕巢區', '岡山區', '橋頭區',
  '楠梓區', '左營區', '三民區', '新興區', '前金區', '苓雅區',
  '鼓山區', '鹽埕區', '旗津區', '前鎮區', '小港區', '鳳山區',
  '大寮區', '大樹區', '林園區', '路竹區', '湖內區', '茄萣區',
  '阿蓮區', '田寮區', '旗山區', '美濃區', '杉林區', '甲仙區',
  '內門區', '六龜區', '茂林區', '桃源區', '那瑪夏區',
];

const CATEGORY_LABELS = { all: '全部', '藥局': '💊 藥局', '診所': '🏥 診所', '醫院': '🏨 醫院', '私人公司': '🏢 私人公司' };

// ── 狀態 ─────────────────────────────────────────────────────
let stops = [];
let favorites = [];
let geoCache = {};
let mapsUrls = [];
let dragSrcIdx = null;
let activeFilter = 'all';
let selectedFavs = new Set();

// ── 初始化 ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadFromStorage();
  restoreTheme();

  // 強化持久化邏輯：僅在「未初始化過」時載入測試醫院
  const hasInited = localStorage.getItem(LS_INIT);
  if (!hasInited) {
    loadTestAddresses();
    localStorage.setItem(LS_INIT, 'true');
  }

  const lbl = $('origin-label');
  if (lbl) lbl.textContent = FIXED_HOME_LABEL;
  renderStops();
  renderFavorites();
  renderFilterTabs();
  bindEvents();
  initAddressAutocomplete();
  updateActionButtons();
});

function loadTestAddresses() {
  stops = TEST_ADDRESSES.map(t => ({
    id: uid(), address: t.address, name: t.name, type: t.type,
    district: extractDistrict(t.address),
  }));
  TEST_ADDRESSES.forEach(t => { geoCache[t.address] = { lat: t.lat, lng: t.lng }; });
  saveStops(); saveGeoCache();
  toast('已載入 10 個核心醫院測試地址', 'success', 3000);
}

// ── 主題 ─────────────────────────────────────────────────────
function restoreTheme() {
  const s = localStorage.getItem(LS_THEME) || '';
  if (s) document.documentElement.setAttribute('data-theme', s);
  else document.documentElement.removeAttribute('data-theme');
}
function cycleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || '';
  const i = THEMES.findIndex(t => t.id === cur);
  const next = THEMES[(i + 1) % THEMES.length];
  if (next.id) document.documentElement.setAttribute('data-theme', next.id);
  else document.documentElement.removeAttribute('data-theme');
  localStorage.setItem(LS_THEME, next.id);
  toast(`主題：${next.label}`, 'success', 1500);
}

// ── 事件 ─────────────────────────────────────────────────────
function bindEvents() {
  $('btn-sort').addEventListener('click', startSort);
  $('btn-open-maps').addEventListener('click', openMaps);
  $('btn-theme').addEventListener('click', cycleTheme);

  $('btn-clear-all').addEventListener('click', () => {
    if (stops.length === 0) return;
    if (!confirm('確定要清除所有站點嗎？')) return;
    stops = []; mapsUrls = [];
    saveStops(); renderStops(); renderFilterTabs(); updateActionButtons(); hideSortStatus(); hideSegmentButtons();
    toast('已清除所有站點', 'info');
  });

  $('btn-favorites-toggle').addEventListener('click', openDrawer);
  $('btn-favorites-close').addEventListener('click', closeDrawer);
  $('favorites-overlay').addEventListener('click', closeDrawer);
  $('btn-fav-add').addEventListener('click', addFavorite);

  const btnFavConfirm = $('btn-fav-confirm');
  if (btnFavConfirm) btnFavConfirm.addEventListener('click', confirmFavSelection);

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
}

// ── Storage ──────────────────────────────────────────────────
function loadFromStorage() {
  try { stops = JSON.parse(localStorage.getItem(LS_STOPS)); if (!Array.isArray(stops)) stops = []; } catch { stops = []; }
  try { favorites = JSON.parse(localStorage.getItem(LS_FAVORITES)); if (!Array.isArray(favorites)) favorites = []; } catch { favorites = []; }
  try { geoCache = JSON.parse(localStorage.getItem(LS_GEOCACHE)); if (typeof geoCache !== 'object' || geoCache === null) geoCache = {}; } catch { geoCache = {}; }

  stops = stops.map(s => ({
    id: s.id || uid(), address: s.address || '', name: s.name || '',
    type: s.type || detectType(s.name || s.address || ''),
    district: s.district || extractDistrict(s.address || ''),
  }));
}

function saveStops() {
  try { localStorage.setItem(LS_STOPS, JSON.stringify(stops)); }
  catch (e) { console.error('Save stops error:', e); }
}

function saveFavorites() {
  try { localStorage.setItem(LS_FAVORITES, JSON.stringify(favorites)); }
  catch (e) {
    console.error('Save favorites error:', e);
    toast('常用地址儲存失敗，可能因無痕模式或空間不足', 'error');
  }
}

function saveGeoCache() {
  try { localStorage.setItem(LS_GEOCACHE, JSON.stringify(geoCache)); }
  catch (e) { console.error('Save geoCache error:', e); }
}

// ── 工具 ─────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toast(msg, type = 'info', dur = 2800) {
  const el = document.createElement('div');
  el.className = `toast toast--${type}`; el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('toast-out'); el.addEventListener('animationend', () => el.remove(), { once: true }); }, dur);
}

// ── 分類偵測 ─────────────────────────────────────────────────
function detectType(text) {
  if (text.includes('醫院')) return '醫院';
  if (text.includes('診所')) return '診所';
  if (text.includes('藥局') || text.includes('藥房') || text.includes('藥妝')) return '藥局';
  if (text.includes('公司') || text.includes('企業') || text.includes('工廠') || text.includes('工作室')) return '私人公司';
  return '';
}

// ── 行政區 ───────────────────────────────────────────────────
function extractDistrict(addr) {
  if (!addr) return null;
  const m = addr.match(/[\u4e00-\u9fff]{2,4}(?:區|鄉|鎮)/);
  if (m) return m[0];
  const f = [['左營', '左營區'], ['楠梓', '楠梓區'], ['岡山', '岡山區'], ['鳳山', '鳳山區'],
  ['三民', '三民區'], ['苓雅', '苓雅區'], ['前鎮', '前鎮區'], ['小港', '小港區'],
  ['旗山', '旗山區'], ['美濃', '美濃區'], ['仁武', '仁武區'], ['大社', '大社區'],
  ['燕巢', '燕巢區'], ['橋頭', '橋頭區'], ['鳥松', '鳥松區'], ['大寮', '大寮區'],
  ['林園', '林園區'], ['旗津', '旗津區'], ['鹽埕', '鹽埕區'], ['鼓山', '鼓山區'],
  ['新興', '新興區'], ['前金', '前金區'], ['大樹', '大樹區']];
  for (const [k, v] of f) if (addr.includes(k)) return v;
  return null;
}

function sortByDistrict(arr) {
  return [...arr].sort((a, b) => {
    const ai = DISTRICT_ORDER.indexOf(a.district) ?? 9999;
    const bi = DISTRICT_ORDER.indexOf(b.district) ?? 9999;
    return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
  });
}

// ══════════════════════════════════════════════════════════════
//  🏷️ 分類篩選
// ══════════════════════════════════════════════════════════════

function getFilteredStops() {
  if (activeFilter === 'all') return stops;
  return stops.filter(s => s.type === activeFilter);
}

function getFilteredIndices() {
  if (activeFilter === 'all') return stops.map((_, i) => i);
  return stops.reduce((acc, s, i) => { if (s.type === activeFilter) acc.push(i); return acc; }, []);
}

function renderFilterTabs() {
  const c = $('filter-tabs');
  if (!c) return;
  c.innerHTML = '';

  const counts = { all: stops.length, '藥局': 0, '診所': 0, '醫院': 0, '私人公司': 0 };
  stops.forEach(s => { if (counts[s.type] !== undefined) counts[s.type]++; });

  for (const key of ['all', '藥局', '診所', '醫院', '私人公司']) {
    const btn = document.createElement('button');
    btn.className = 'filter-tab' + (activeFilter === key ? ' filter-tab--active' : '');
    btn.innerHTML = `${CATEGORY_LABELS[key]} <span class="filter-tab__count">${counts[key]}</span>`;
    btn.addEventListener('click', () => {
      activeFilter = key;
      mapsUrls = [];
      renderFilterTabs();
      renderStops();
      updateActionButtons();
      hideSortStatus();
      hideSegmentButtons();
    });
    c.appendChild(btn);
  }
}

// ══════════════════════════════════════════════════════════════
//  🌍 Geocoding（快取 → Nominatim → Photon）
// ══════════════════════════════════════════════════════════════

async function geocodeAddress(addr) {
  if (geoCache[addr]) return geoCache[addr];
  let c = await tryNominatim(addr);
  if (!c) c = await tryPhoton(addr);
  if (c) { geoCache[addr] = c; saveGeoCache(); }
  return c;
}
async function tryNominatim(addr) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(addr)}&limit=1&countrycodes=tw`,
      {
        mode: 'cors',
        headers: {
          'Accept-Language': 'zh-TW',
          'User-Agent': 'RouteOptimizer/8.0 (contact@example.com)'
        },
        signal: AbortSignal.timeout(8000)
      });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.length ? { lat: +d[0].lat, lng: +d[0].lon } : null;
  } catch { return null; }
}
async function tryPhoton(addr) {
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(addr)}&lang=en&limit=1&lat=22.63&lon=120.33`,
      { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    const f = d?.features?.[0];
    return f ? { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] } : null;
  } catch { return null; }
}

async function geocodeAllStops(stopsArr) {
  const coords = new Map(), failed = [];
  let api = 0;
  for (let i = 0; i < stopsArr.length; i++) {
    if (geoCache[stopsArr[i].address]) { coords.set(i, geoCache[stopsArr[i].address]); continue; }
    if (api > 0) await sleep(1100);
    showSpinner(`🌍 定位座標中… (${i + 1}/${stopsArr.length}) ${stopsArr[i].name || ''}`);
    const c = await geocodeAddress(stopsArr[i].address);
    api++;
    if (c) coords.set(i, c); else failed.push(i);
  }
  return { coords, failed };
}

// ══════════════════════════════════════════════════════════════
//  📐 Haversine + TSP
// ══════════════════════════════════════════════════════════════

function haversine(a1, n1, a2, n2) {
  const R = 6371, dLat = (a2 - a1) * Math.PI / 180, dLng = (n2 - n1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(a1 * Math.PI / 180) * Math.cos(a2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildDist(pts) {
  const n = pts.length, d = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const v = haversine(pts[i].lat, pts[i].lng, pts[j].lat, pts[j].lng); d[i][j] = v; d[j][i] = v; }
  return d;
}

function calcDist(r, d) { if (!r.length) return 0; let t = d[0][r[0]]; for (let i = 0; i < r.length - 1; i++)t += d[r[i]][r[i + 1]]; t += d[r[r.length - 1]][0]; return t; }

function nnFrom(s, n, d) { const v = new Set([0, s]), r = [s]; let c = s; while (v.size < n) { let b = -1, bd = Infinity; for (let j = 1; j < n; j++) { if (v.has(j)) continue; if (d[c][j] < bd) { bd = d[c][j]; b = j; } } if (b === -1) break; v.add(b); r.push(b); c = b; } return r; }

function twoOpt(route, d) {
  const n = route.length; if (n < 3) return { route: [...route], dist: calcDist(route, d) }; let best = [...route], bd = calcDist(best, d), imp = true;
  while (imp) {
    imp = false; for (let i = 0; i < n - 1; i++)for (let j = i + 1; j < n; j++) {
      const pi = i === 0 ? 0 : best[i - 1], nj = j === n - 1 ? 0 : best[j + 1];
      const oc = d[pi][best[i]] + d[best[j]][nj], nc = d[pi][best[j]] + d[best[i]][nj];
      if (nc < oc - 0.0001) { let l = i, r = j; while (l < r) { [best[l], best[r]] = [best[r], best[l]]; l++; r--; } bd -= (oc - nc); imp = true; }
    }
  }
  return { route: best, dist: bd };
}

function orOpt(route, d) {
  const n = route.length; if (n < 4) return { route: [...route], dist: calcDist(route, d) }; let best = [...route], bd = calcDist(best, d), imp = true;
  while (imp) {
    imp = false; for (const sl of [1, 2, 3]) for (let i = 0; i < n - sl + 1; i++)for (let j = 0; j < n; j++) {
      if (j >= i - 1 && j <= i + sl) continue; const t = [...best], seg = t.splice(i, sl), ins = j > i ? j - sl : j; t.splice(ins, 0, ...seg);
      const td = calcDist(t, d); if (td < bd - 0.0001) { best = t; bd = td; imp = true; }
    }
  } return { route: best, dist: bd };
}

function solveTSP(stopsArr, coordsMap) {
  const pts = [FIXED_HOME_COORD], vi = [];
  for (let i = 0; i < stopsArr.length; i++) if (coordsMap.has(i)) { pts.push(coordsMap.get(i)); vi.push(i); }
  const noC = stopsArr.filter((_, i) => !coordsMap.has(i));
  const n = pts.length, d = buildDist(pts);
  const starts = new Set(); for (let j = 1; j < n; j++)starts.add(j);
  let gBest = null, gDist = Infinity;
  for (const s of starts) {
    const nn = nnFrom(s, n, d); const a = twoOpt(nn, d); const b = orOpt(a.route, d); const c = twoOpt(b.route, d);
    if (c.dist < gDist) { gDist = c.dist; gBest = c.route; }
  }
  console.log(`[TSP] ${starts.size} 起點，最佳距離: ${gDist.toFixed(2)} km`);
  const sorted = gBest.map(p => stopsArr[vi[p - 1]]); sorted.push(...noC);
  return { sorted, totalKm: gDist };
}

// ── Google Sheets Import 移除 ─────────────────────────────────
// 功能已依需求移除

// ── 新增站點 (已遷移至常用地址簿) ─────────────────────────

function deleteStop(id) {
  stops = stops.filter(s => s.id !== id);
  mapsUrls = [];
  saveStops(); renderStops(); renderFilterTabs(); updateActionButtons(); hideSortStatus(); hideSegmentButtons();
}

// ══════════════════════════════════════════════════════════════
//  🚀 排序（僅對篩選結果排序）
// ══════════════════════════════════════════════════════════════

async function startSort() {
  const filtered = getFilteredStops();
  if (filtered.length === 0) return;
  $('btn-sort').disabled = true;
  hideSegmentButtons();

  try {
    const label = activeFilter === 'all' ? '全部' : activeFilter;

    // geocode
    showSpinner(`🌍 取得 ${label} GPS 座標中…`);
    const { coords, failed } = await geocodeAllStops(filtered);
    let sorted = null;

    if (coords.size >= 2) {
      showSpinner(`🧮 TSP 計算 ${label} 最短路線…`);
      await sleep(30);
      const r = solveTSP(filtered, coords);
      sorted = r.sorted;
      let msg = `📍 ${label} TSP 完成！${sorted.length} 站 · ${r.totalKm.toFixed(1)} km`;
      if (failed.length) msg += ` · ${failed.length} 站無座標`;
      const seg = Math.ceil(sorted.length / 10);
      if (seg > 1) msg += ` · 分 ${seg} 段`;
      showSortResult(msg);
      toast(`${label} 路線優化完成！`, 'success');
    }

    if (!sorted) {
      sorted = sortByDistrict(filtered);
      showSortResult(`⚠️ ${label} 座標不足，已用行政區排序`);
    }

    // 將排序結果寫回 stops 陣列（僅替換對應的子集）
    if (activeFilter === 'all') {
      stops = sorted;
    } else {
      const indices = getFilteredIndices();
      indices.forEach((origIdx, i) => { stops[origIdx] = sorted[i]; });
      // 重新排列：將已排序的項目放到對應位置
      const nonFiltered = stops.filter(s => s.type !== activeFilter);
      const newStops = [];
      // 排序後的放前面，其他放後面
      newStops.push(...sorted, ...nonFiltered);
      stops = newStops;
    }

    mapsUrls = buildMapsUrls(activeFilter === 'all' ? stops : sorted);
    saveStops(); renderStops(); renderFilterTabs(); updateActionButtons();
  } catch (err) {
    console.error('[startSort]', err);
    showSortError('排序發生錯誤，請重試');
  }
  $('btn-sort').disabled = false;
}

// ── 狀態 UI ──────────────────────────────────────────────────
function showSpinner(t) { $('sort-status').style.display = ''; $('sort-spinner').style.display = ''; $('sort-result').style.display = 'none'; $('sort-error').style.display = 'none'; $('sort-status-text').textContent = t; }
function showSortResult(t) { $('sort-status').style.display = ''; $('sort-spinner').style.display = 'none'; $('sort-result').style.display = ''; $('sort-error').style.display = 'none'; $('sort-result-text').textContent = t; $('btn-sort').disabled = false; }
function showSortError(t) { $('sort-status').style.display = ''; $('sort-spinner').style.display = 'none'; $('sort-result').style.display = 'none'; $('sort-error').style.display = ''; $('sort-error-text').textContent = t; $('btn-sort').disabled = false; }
function hideSortStatus() { $('sort-status').style.display = 'none'; }

// ── Google Maps ──────────────────────────────────────────────
function buildMapsUrls(arr) {
  if (!arr.length) return [];
  const enc = s => encodeURIComponent(s), S = 10, addrs = arr.map(s => s.address), urls = [];
  for (let i = 0; i < addrs.length; i += S) {
    const ck = addrs.slice(i, i + S);
    const o = i === 0 ? FIXED_HOME : addrs[i - 1], last = (i + S) >= addrs.length, dest = last ? FIXED_HOME : ck[ck.length - 1];
    let w = ck; if (!last) w = ck.slice(0, -1);
    urls.push(`https://www.google.com/maps/dir/?api=1&origin=${enc(o)}&destination=${enc(dest)}&waypoints=${enc(w.join('|'))}&travelmode=driving`);
  }
  return urls;
}

function openMaps() {
  const filtered = getFilteredStops();
  if (filtered.length === 0) { toast('目前篩選無站點', 'info'); return; }
  const urls = mapsUrls.length > 0 ? mapsUrls : buildMapsUrls(filtered);
  window.open(urls[0], '_blank', 'noopener,noreferrer');
  if (urls.length > 1) {
    showSegmentButtons(urls);
    toast(`📍 共 ${urls.length} 段，第 1 段已開啟`, 'info', 3500);
  }
}

function showSegmentButtons(urls) {
  const c = $('segment-buttons'); if (!c) return; c.innerHTML = ''; c.style.display = '';
  urls.forEach((u, i) => {
    const a = document.createElement('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'btn btn--segment' + (i === 0 ? ' btn--segment-done' : ''); a.textContent = `第 ${i + 1} 段` + (i === 0 ? ' ✓' : '');
    a.addEventListener('click', () => { a.classList.add('btn--segment-done'); a.textContent = `第 ${i + 1} 段 ✓`; }); c.appendChild(a);
  });
}
function hideSegmentButtons() { const c = $('segment-buttons'); if (c) { c.style.display = 'none'; c.innerHTML = ''; } }

function updateActionButtons() {
  const n = getFilteredStops().length; $('btn-sort').disabled = !n; $('btn-open-maps').disabled = !n;
  $('stop-count').textContent = getFilteredStops().length;
}

// ── 渲染站點 ────────────────────────────────────────────────
function renderStops() {
  const list = $('stops-list'), empty = $('empty-state');
  const filtered = getFilteredStops();
  $('stop-count').textContent = filtered.length;
  list.innerHTML = '';
  if (filtered.length === 0) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  filtered.forEach((stop, idx) => {
    const li = document.createElement('li');
    li.className = 'stop-item'; li.dataset.id = stop.id; li.dataset.idx = idx; li.draggable = true;

    const hasCoord = !!geoCache[stop.address];
    const typeBadge = stop.type
      ? `<span class="badge badge--type badge--type-${stop.type === '醫院' ? 'hospital' : stop.type === '診所' ? 'clinic' : 'pharmacy'}">${stop.type}</span>`
      : '';
    const coordBadge = hasCoord ? `<span class="badge badge--coord" title="GPS 已快取">📍</span>` : '';

    li.innerHTML = `
      <div class="stop-item__handle" title="拖曳排序">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>
        </svg>
      </div>
      <div class="stop-item__num">${idx + 1}</div>
      <div class="stop-item__body">
        <div class="stop-item__name">${escHtml(stop.name || stop.address)}</div>
        <div class="stop-item__addr">${escHtml(stop.address)}</div>
        <div class="stop-item__meta">${stop.district ? `<span class="badge badge--town">${escHtml(stop.district)}</span>` : ''} ${typeBadge} ${coordBadge}</div>
      </div>
      <button class="stop-item__fav-btn" title="儲存至常用">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </button>
      <button class="stop-item__del-btn" title="刪除">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>`;

    li.querySelector('.stop-item__del-btn').addEventListener('click', e => { e.stopPropagation(); deleteStop(stop.id); });
    li.querySelector('.stop-item__fav-btn').addEventListener('click', e => { e.stopPropagation(); quickSaveFav(stop.address); });
    addDragEvents(li, idx);
    list.appendChild(li);
  });
}

// ── 拖曳 ────────────────────────────────────────────────────
function addDragEvents(li, idx) {
  li.addEventListener('dragstart', e => { dragSrcIdx = idx; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  li.addEventListener('dragend', () => { li.classList.remove('dragging'); document.querySelectorAll('.stop-item.drag-over').forEach(el => el.classList.remove('drag-over')); });
  li.addEventListener('dragover', e => { e.preventDefault(); if (dragSrcIdx !== idx) { document.querySelectorAll('.stop-item.drag-over').forEach(el => el.classList.remove('drag-over')); li.classList.add('drag-over'); } });
  li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
  li.addEventListener('drop', e => {
    e.preventDefault(); li.classList.remove('drag-over');
    if (dragSrcIdx === null || dragSrcIdx === idx) return;
    const arr = getFilteredStops();
    const moved = arr.splice(dragSrcIdx, 1)[0];
    arr.splice(idx, 0, moved);
    // 寫回 stops
    if (activeFilter === 'all') { stops = arr; }
    else { const others = stops.filter(s => s.type !== activeFilter); stops = [...arr, ...others]; }
    dragSrcIdx = null;
    mapsUrls = buildMapsUrls(getFilteredStops());
    saveStops(); renderStops(); updateActionButtons();
  });

  let ts = null, ghost = null;
  li.addEventListener('touchstart', e => {
    if (!e.target.closest('.stop-item__handle')) return;
    ts = { y: e.touches[0].clientY, idx };
    ghost = li.cloneNode(true);
    const r = li.getBoundingClientRect();
    ghost.style.cssText = `position:fixed;z-index:9999;opacity:0.75;pointer-events:none;width:${li.offsetWidth}px;left:${r.left}px;top:${r.top}px;transition:none;`;
    document.body.appendChild(ghost);
    li.classList.add('dragging');
    e.preventDefault();
  }, { passive: false });

  li.addEventListener('touchmove', e => {
    if (!ts) return; e.preventDefault();
    ghost.style.top = (parseFloat(ghost.style.top) + e.touches[0].clientY - ts.y) + 'px';
    ts.y = e.touches[0].clientY;
    document.querySelectorAll('.stop-item.drag-over').forEach(el => el.classList.remove('drag-over'));
    const els = document.elementsFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    const t = els.find(el => el.classList?.contains('stop-item') && el !== li);
    if (t) { t.classList.add('drag-over'); dragSrcIdx = ts.idx; }
  }, { passive: false });

  li.addEventListener('touchend', () => {
    if (!ts) return;
    ghost?.remove(); ghost = null; li.classList.remove('dragging');
    const over = document.querySelector('.stop-item.drag-over');
    if (over) {
      const ti = parseInt(over.dataset.idx);
      over.classList.remove('drag-over');
      if (!isNaN(ti) && ti !== ts.idx) {
        const arr = getFilteredStops();
        const moved = arr.splice(ts.idx, 1)[0];
        arr.splice(ti, 0, moved);
        if (activeFilter === 'all') { stops = arr; } else { stops = [...arr, ...stops.filter(s => s.type !== activeFilter)]; }
        mapsUrls = buildMapsUrls(getFilteredStops());
        saveStops(); renderStops(); updateActionButtons();
      }
    }
    ts = null; dragSrcIdx = null;
  });
}

// ── 常用地址簿 ──────────────────────────────────────────────
function openDrawer() { $('favorites-drawer').classList.add('is-open'); $('favorites-overlay').classList.add('is-open'); }
function closeDrawer() { $('favorites-drawer').classList.remove('is-open'); $('favorites-overlay').classList.remove('is-open'); }

async function addFavorite() {
  const ni = $('fav-name-input'), ai = $('fav-addr-input'), ti = $('fav-type-select');
  const addr = ai.value.trim();
  if (!addr) { ai.focus(); toast('請輸入地址', 'error'); return; }
  const name = ni.value.trim() || addr;
  const type = ti ? ti.value : detectType(name);
  if (favorites.some(f => f.address === addr)) { toast('已存在', 'info'); return; }

  const btn = $('btn-fav-add');
  const oldText = btn.innerHTML;
  btn.innerHTML = '<div class="spinner" style="display:inline-block; vertical-align:middle; margin-right:6px; width:14px; height:14px;"></div>取得座標中';
  btn.disabled = true;

  try {
    if (!geoCache[addr]) {
      let c = await tryNominatim(addr);
      if (!c) c = await tryPhoton(addr);
      if (c) {
        geoCache[addr] = c;
        saveGeoCache();
      }
    }
  } catch (e) { }

  btn.innerHTML = oldText;
  btn.disabled = false;

  favorites.push({ id: uid(), name, address: addr, type });
  saveFavorites(); renderFavorites();
  ni.value = ''; ai.value = ''; if (ti) ti.value = '';
  toast(`已儲存：${name}`, 'success');
}

function quickSaveFav(addr) {
  if (favorites.some(f => f.address === addr)) { toast('已在常用地址簿', 'info'); return; }
  const stop = stops.find(s => s.address === addr);
  const name = stop?.name || addr;
  const type = stop?.type || detectType(addr);
  favorites.push({ id: uid(), name, address: addr, type });
  saveFavorites(); renderFavorites(); toast('已儲存至常用地址簿', 'success');
}

function deleteFavorite(id) { favorites = favorites.filter(f => f.id !== id); saveFavorites(); renderFavorites(); }

function addFavToRoute(fav) {
  const addr = typeof fav === 'string' ? fav : fav.address;
  const name = typeof fav === 'string' ? fav : (fav.name || fav.address);
  const type = typeof fav === 'string' ? detectType(fav) : (fav.type || detectType(fav.name || ''));
  stops.push({ id: uid(), address: addr, name, type, district: extractDistrict(addr) });
  mapsUrls = buildMapsUrls(getFilteredStops()); saveStops(); renderStops(); renderFilterTabs(); updateActionButtons(); hideSortStatus();
  toast(`已加入：${name}`, 'success');
}

function renderFavorites() {
  const list = $('favorites-list'), empty = $('fav-empty-state'); list.innerHTML = '';
  if (!favorites.length) { empty.style.display = ''; updateFavSelectionFooter(); return; }
  empty.style.display = 'none';

  favorites.forEach(f => {
    const li = document.createElement('li');
    li.className = 'fav-item';
    if (selectedFavs.has(f.id)) li.classList.add('is-selected');

    li.addEventListener('click', (e) => {
      if (e.target.closest('.fav-item__del-btn')) return;
      if (selectedFavs.has(f.id)) {
        selectedFavs.delete(f.id);
        li.classList.remove('is-selected');
        const chk = li.querySelector('.fav-checkbox');
        if (chk) chk.checked = false;
      } else {
        selectedFavs.add(f.id);
        li.classList.add('is-selected');
        const chk = li.querySelector('.fav-checkbox');
        if (chk) chk.checked = true;
      }
      updateFavSelectionFooter();
    });

    const typeLabel = f.type ? `<span class="badge badge--type badge--type-${f.type === '醫院' ? 'hospital' : f.type === '診所' ? 'clinic' : f.type === '藥局' ? 'pharmacy' : 'company'}">${escHtml(f.type)}</span>` : '';
    const isChecked = selectedFavs.has(f.id) ? 'checked' : '';
    const coordBadge = geoCache[f.address] ? `<span class="badge badge--coord" title="座標已取得">📍</span>` : '';

    li.innerHTML = `
      <input type="checkbox" class="fav-checkbox" value="${f.id}" ${isChecked} style="margin-right: 12px; transform: scale(1.3); pointer-events: none;">
      <div class="fav-item__body">
          <div class="fav-item__name">${escHtml(f.name)} ${typeLabel} ${coordBadge}</div>
          <div class="fav-item__addr">${escHtml(f.address)}</div>
      </div>
      <button class="fav-item__del-btn" title="刪除">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
      </button>`;

    li.querySelector('.fav-item__del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      selectedFavs.delete(f.id);
      deleteFavorite(f.id);
      updateFavSelectionFooter();
    });
    list.appendChild(li);
  });
  updateFavSelectionFooter();
}

function updateFavSelectionFooter() {
  const footer = $('fav-selection-footer');
  const count = $('fav-selection-count');
  if (footer && count) {
    if (selectedFavs.size > 0) {
      footer.style.display = 'block';
      count.textContent = `已選取 ${selectedFavs.size} 項`;
    } else {
      footer.style.display = 'none';
    }
  }
}

function confirmFavSelection() {
  if (selectedFavs.size === 0) return;
  let addedCount = 0;
  favorites.forEach(f => {
    if (selectedFavs.has(f.id)) {
      stops.push({ id: uid(), address: f.address, name: f.name, type: f.type, district: extractDistrict(f.address) });
      addedCount++;
    }
  });
  selectedFavs.clear();
  mapsUrls = buildMapsUrls(getFilteredStops());
  saveStops(); renderStops(); renderFilterTabs(); updateActionButtons(); hideSortStatus();
  closeDrawer();
  renderFavorites(); // 取消所有勾選
  toast(`已將 ${addedCount} 個地點加入路線`, 'success', 2000);
}

// ── 地址自動建議（Nominatim）──────────────────────────────────
let acTimeout = null;
let acController = null;

function initAddressAutocomplete() {
  const input = $('fav-addr-input');
  if (!input) return;

  // 建立下拉容器
  let dropdown = document.createElement('div');
  dropdown.className = 'ac-dropdown';
  dropdown.id = 'ac-dropdown';
  input.parentNode.style.position = 'relative';
  input.parentNode.insertBefore(dropdown, input.nextSibling);

  input.addEventListener('input', () => {
    clearTimeout(acTimeout);
    const q = input.value.trim();
    if (q.length < 3) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }
    acTimeout = setTimeout(() => fetchSuggestions(q, dropdown, input), 400);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { dropdown.style.display = 'none'; }, 200);
  });
}

async function fetchSuggestions(query, dropdown, input) {
  if (acController) acController.abort();
  acController = new AbortController();
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=tw&accept-language=zh-TW`;
    const res = await fetch(url, {
      mode: 'cors',
      headers: {
        'Accept-Language': 'zh-TW',
        'User-Agent': 'RouteOptimizer/8.0 (contact@example.com)'
      },
      signal: acController.signal
    });
    if (!res.ok) return;
    const data = await res.json();
    dropdown.innerHTML = '';
    if (!data.length) { dropdown.style.display = 'none'; return; }
    dropdown.style.display = '';
    data.forEach(item => {
      const div = document.createElement('div');
      div.className = 'ac-item';
      div.textContent = item.display_name;
      div.addEventListener('mousedown', e => {
        e.preventDefault();
        input.value = item.display_name;
        dropdown.style.display = 'none';
        // 快取座標
        geoCache[item.display_name] = { lat: +item.lat, lng: +item.lon };
        saveGeoCache();
      });
      dropdown.appendChild(div);
    });
  } catch (e) {
    if (e.name !== 'AbortError') console.error('[autocomplete]', e);
  }
}

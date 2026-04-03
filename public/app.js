// ============================================================
// 六哥指数 — 前端 (API-backed)
// ============================================================
let authToken = localStorage.getItem('liuge_token') || '';
let currentUser = null;
let stocks = [];
const minuteData = {};

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (authToken) opts.headers['Authorization'] = 'Bearer ' + authToken;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function showPw(id) { document.getElementById(id).type = 'text' }
function hidePw(id) { document.getElementById(id).type = 'password' }
function byteLength(str) { let len = 0; for (let i = 0; i < str.length; i++) len += str.charCodeAt(i) > 127 ? 3 : 1; return len }

// ============================================================
// 1. Auth
// ============================================================
let pendingUser = '', pendingPass = '';

async function loginStep1() {
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value;
  const err = document.getElementById('loginError1'); err.textContent = '';
  if (!user) { err.textContent = '请输入用户名'; return }
  if (user.length < 2) { err.textContent = '用户名至少2个字符'; return }
  if (!/^[A-Za-z0-9!@#$%^&*_\-]{8,16}$/.test(pass)) { err.textContent = '密码需8~16位，字母/数字/符号'; return }
  try {
    const res = await api('POST', '/api/login', { username: user, password: pass });
    authToken = res.token; localStorage.setItem('liuge_token', authToken);
    currentUser = res.user; enterApp(); return;
  } catch (e) {
    if (e.message.includes('密码') || e.message.includes('用户名')) {
      // Could be wrong password for existing user, or new user
      // Try to check if user exists by the error
      if (e.message === '用户名或密码错误') {
        // Don't know if user exists or not — try register to find out
        pendingUser = user; pendingPass = pass;
        try {
          const res2 = await api('POST', '/api/register', { username: user, password: pass });
          // If register succeeds, it was a new user — but we need confirm step
          // Actually the register already created the user. Let's just use it.
          authToken = res2.token; localStorage.setItem('liuge_token', authToken);
          currentUser = res2.user; enterApp(); return;
        } catch (e2) {
          if (e2.message === '用户名已存在') { err.textContent = '密码错误，请重试'; return }
          // New user but need confirm — show step 2
          err.textContent = e2.message; return;
        }
      }
      err.textContent = e.message; return;
    }
    err.textContent = e.message;
  }
}

async function loginStep2() {
  const cp = document.getElementById('loginPassConfirm').value;
  const err = document.getElementById('loginError2'); err.textContent = '';
  if (!cp) { err.textContent = '请再次输入密码'; return }
  if (cp !== pendingPass) { err.textContent = '两次密码不一致'; return }
  try {
    const res = await api('POST', '/api/register', { username: pendingUser, password: pendingPass });
    authToken = res.token; localStorage.setItem('liuge_token', authToken);
    currentUser = res.user; enterApp();
  } catch (e) { err.textContent = e.message }
}

function backToStep1() { document.getElementById('loginStep2').classList.remove('active'); document.getElementById('loginStep1').style.display = 'block' }

function doLogout() {
  authToken = ''; currentUser = null; localStorage.removeItem('liuge_token');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('loginPage').classList.remove('hidden');
  document.getElementById('loginStep1').style.display = 'block';
  document.getElementById('loginStep2').classList.remove('active');
  document.getElementById('loginUser').value = ''; document.getElementById('loginPass').value = '';
  document.getElementById('loginError1').textContent = '';
  appInited = false;
}

function enterApp() {
  const u = currentUser;
  document.getElementById('loginPage').classList.add('hidden');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('appPage').classList.add('active');
  document.getElementById('userName').textContent = u.display_name || u.username;
  const av = document.getElementById('userAvatar');
  if (u.avatar) av.innerHTML = '<img src="' + u.avatar + '">'; else av.textContent = (u.display_name || u.username).charAt(0).toUpperCase();
  document.getElementById('adminLink').style.display = u.is_admin ? 'inline-flex' : 'none';
  initApp();
}

document.getElementById('loginUser').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginPass').focus() });
document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') loginStep1() });
document.getElementById('loginPassConfirm').addEventListener('keydown', e => { if (e.key === 'Enter') loginStep2() });

// ============================================================
// 2. Admin
// ============================================================
let editingAvatarUserId = null;
async function showAdmin() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('adminPage').classList.add('active');
  if (currentUser) { document.getElementById('adminName').textContent = currentUser.display_name || currentUser.username; const av = document.getElementById('adminAvatar'); if (currentUser.avatar) av.innerHTML = '<img src="' + currentUser.avatar + '">'; else av.textContent = (currentUser.display_name || currentUser.username).charAt(0).toUpperCase() }
  await renderAdminUsers();
}
function showApp() { document.querySelectorAll('.page').forEach(p => p.classList.remove('active')); document.getElementById('appPage').classList.add('active') }

async function renderAdminUsers() {
  try {
    const users = await api('GET', '/api/users');
    const tbody = document.getElementById('adminUserList');
    document.getElementById('adminTotalUsers').textContent = users.length;
    document.getElementById('adminTotalAdmins').textContent = users.filter(u => u.is_admin).length;
    tbody.innerHTML = users.map(u => {
      const isSelf = currentUser && u.id === currentUser.id;
      const dn = u.display_name || u.username;
      const avH = u.avatar ? '<img src="' + u.avatar + '">' : '<span>' + dn.charAt(0).toUpperCase() + '</span>';
      const ts = u.last_login ? timeDiff(u.last_login) : '未知';
      return '<tr><td style="font-variant-numeric:tabular-nums;font-size:12px;color:var(--text-muted)">' + u.id + '</td>' +
        '<td><div class="admin-avatar-cell"><div class="admin-avatar-img" onclick="triggerAvatarUpload(' + u.id + ')" title="点击更换头像">' + avH + '</div><div><div><strong contenteditable="true" spellcheck="false" style="outline:none;min-width:40px;display:inline-block;border-bottom:1px dashed var(--border-color);padding:0 2px" oninput="onNameEdit(this)" onblur="saveName(' + u.id + ',this)">' + dn + '</strong>' + (isSelf ? '<span style="font-size:10px;color:var(--gold);margin-left:6px">(我)</span>' : '') + '</div><div style="font-size:10px;color:var(--text-muted)">@' + u.username + '</div></div></div></td>' +
        '<td><span class="status-dot ' + (isSelf ? 'online' : 'offline') + '"></span>' + (isSelf ? '在线' : ts + '前') + '</td>' +
        '<td><span class="admin-badge ' + (u.is_admin ? 'yes' : 'no') + '">' + (u.is_admin ? '管理员' : '普通用户') + '</span></td>' +
        '<td><label class="toggle-switch"><input type="checkbox" ' + (u.is_admin ? 'checked' : '') + ' ' + (isSelf ? 'disabled' : '') + ' onchange="toggleAdmin(' + u.id + ',this.checked)"><span class="toggle-slider"></span></label>' + (isSelf ? '<span style="font-size:10px;color:var(--text-muted);margin-left:6px">不可修改</span>' : '') + '</td></tr>';
    }).join('');
  } catch (e) { console.error(e) }
}

function onNameEdit(el) { el.classList.toggle('name-over-limit', byteLength(el.textContent) > 32) }
async function saveName(userId, el) {
  const text = el.textContent.trim(); if (!text || byteLength(text) > 32) return;
  try { await api('PUT', '/api/users/' + userId + '/name', { display_name: text }) } catch (e) { alert(e.message) }
  if (currentUser && currentUser.id === userId) { currentUser.display_name = text; document.getElementById('userName').textContent = text }
}
function triggerAvatarUpload(userId) { editingAvatarUserId = userId; document.getElementById('avatarFileInput').click() }
function handleAvatarUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  if (file.size > 4 * 1024 * 1024) { alert('头像不能超过4MB'); e.target.value = ''; return }
  const reader = new FileReader();
  reader.onload = function(ev) {
    const img = new Image(); img.onload = async function() {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128;
      const ctx = c.getContext('2d'); const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 128, 128);
      const small = c.toDataURL('image/jpeg', 0.8);
      try { await api('PUT', '/api/users/' + editingAvatarUserId + '/avatar', { avatar: small }) } catch (e) { alert(e.message); return }
      if (currentUser && currentUser.id === editingAvatarUserId) { currentUser.avatar = small; document.getElementById('userAvatar').innerHTML = '<img src="' + small + '">' }
      renderAdminUsers();
    }; img.src = ev.target.result;
  }; reader.readAsDataURL(file); e.target.value = '';
}
async function toggleAdmin(userId, isAdmin) { try { await api('PUT', '/api/users/' + userId + '/admin', { is_admin: isAdmin }); renderAdminUsers() } catch (e) { alert(e.message) } }
function timeDiff(ts) { const d = Date.now() - ts, m = Math.floor(d / 60000); if (m < 1) return '刚刚'; if (m < 60) return m + '分钟'; const h = Math.floor(m / 60); if (h < 24) return h + '小时'; return Math.floor(h / 24) + '天' }

// ============================================================
// 3. Market API
// ============================================================
function getMarketPrefix(c) { return (c.startsWith('6') || c.startsWith('9')) ? 'sh' : 'sz' }
function getEastmoneyUrl(c) { return (getMarketPrefix(c) === 'sh') ? 'https://quote.eastmoney.com/sh' + c + '.html' : 'https://quote.eastmoney.com/sz' + c + '.html' }

function fetchMinuteData(code) {
  return new Promise(function(r) {
    var sym = getMarketPrefix(code) + code, vn = 'min_' + code + '_' + Date.now();
    var sc = document.createElement('script');
    sc.src = 'https://web.ifzq.gtimg.cn/appstock/app/minute/query?_var=' + vn + '&code=' + sym + '&_=' + Date.now();
    var t = setTimeout(function() { cl(); r(null) }, 8000);
    function cl() { clearTimeout(t); if (sc.parentNode) sc.parentNode.removeChild(sc); try { delete window[vn] } catch (e) {} }
    sc.onload = function() { try { var raw = window[vn]; if (raw && raw.data && raw.data[sym] && raw.data[sym].data && raw.data[sym].data.data) { var prices = raw.data[sym].data.data.map(function(x) { return parseFloat(x.split(' ')[1]) }).filter(function(v) { return !isNaN(v) && v > 0 }); if (prices.length > 0) { cl(); r(prices); return } } } catch (e) {} cl(); r(null) };
    sc.onerror = function() { cl(); r(null) };
    document.head.appendChild(sc);
  });
}
async function loadAllMinuteData() { await Promise.all(stocks.map(async function(s) { var p = await fetchMinuteData(s.code); if (p && p.length > 0) minuteData[s.code] = p })); stocks.forEach(function(s) { drawKline('kline-' + s.code, s.code) }) }

function drawKline(id, code) {
  var cv = document.getElementById(id); if (!cv) return;
  var s = stocks.find(function(x) { return x.code === code }), ctx = cv.getContext('2d'), W = 140, H = 50, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.scale(dpr, dpr);
  ctx.fillStyle = '#1c2128'; ctx.fillRect(0, 0, W, H);
  if (!s || !s.quote || !s.quote.prevClose || s.quote.price <= 0) { ctx.fillStyle = '#6e7681'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('等待数据...', W / 2, H / 2 + 4); return }
  var q = s.quote, pc = q.prevClose, pts = minuteData[code];
  if (!pts || pts.length < 2) { ctx.fillStyle = '#6e7681'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('加载中...', W / 2, H / 2 + 4); return }
  var all = [pc].concat(pts), mn = Math.min.apply(null, all) * 0.999, mx = Math.max.apply(null, all) * 1.001, rng = mx - mn || 1, pad = 4;
  function toY(v) { return pad + ((mx - v) / rng) * (H - pad * 2) }
  ctx.strokeStyle = 'rgba(110,118,129,0.35)'; ctx.lineWidth = 0.5; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(0, toY(pc)); ctx.lineTo(W, toY(pc)); ctx.stroke(); ctx.setLineDash([]);
  var lp = pts[pts.length - 1], lc = lp > pc ? '#ef4444' : lp < pc ? '#22c55e' : '#6e7681', gr = ctx.createLinearGradient(0, 0, 0, H);
  if (lp >= pc) { gr.addColorStop(0, 'rgba(239,68,68,0.18)'); gr.addColorStop(1, 'rgba(239,68,68,0)') } else { gr.addColorStop(0, 'rgba(34,197,94,0.18)'); gr.addColorStop(1, 'rgba(34,197,94,0)') }
  var sx = W / (pts.length - 1 || 1);
  ctx.beginPath(); ctx.moveTo(0, toY(pts[0])); pts.forEach(function(p, i) { ctx.lineTo(i * sx, toY(p)) }); ctx.lineTo((pts.length - 1) * sx, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fillStyle = gr; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, toY(pts[0])); pts.forEach(function(p, i) { ctx.lineTo(i * sx, toY(p)) }); ctx.strokeStyle = lc; ctx.lineWidth = 1.5; ctx.stroke();
  var ex = (pts.length - 1) * sx, ey = toY(lp), hl = lc === '#ef4444' ? 'rgba(239,68,68,0.2)' : lc === '#22c55e' ? 'rgba(34,197,94,0.2)' : 'rgba(110,118,129,0.2)';
  ctx.beginPath(); ctx.arc(ex, ey, 4, 0, Math.PI * 2); ctx.fillStyle = hl; ctx.fill(); ctx.beginPath(); ctx.arc(ex, ey, 2, 0, Math.PI * 2); ctx.fillStyle = lc; ctx.fill();
}

function fetchQuotesBatch(codes) { if (!codes.length) return Promise.resolve({}); return new Promise(function(r) { var syms = codes.map(function(c) { return getMarketPrefix(c) + c }).join(','), sc = document.createElement('script'); sc.src = 'https://qt.gtimg.cn/q=' + syms + '&_=' + Date.now(); var t = setTimeout(function() { cl(); r({}) }, 8000); function cl() { clearTimeout(t); if (sc.parentNode) sc.parentNode.removeChild(sc) } sc.onload = function() { var res = {}; codes.forEach(function(code) { try { var sym = getMarketPrefix(code) + code, raw = window['v_' + sym]; if (raw && typeof raw === 'string' && raw.length > 10) { var p = raw.split('~'); if (p.length >= 45) res[code] = { code: code, name: p[1], open: +p[5], prevClose: +p[4], price: +p[3], high: +p[33] || +p[41], low: +p[34] || +p[42], volume: +p[6], amount: +p[37], change: +p[31], changePercent: +p[32] } } } catch (e) {} }); cl(); r(res) }; sc.onerror = function() { cl(); r({}) }; document.head.appendChild(sc) }) }

// ============================================================
// 4. Render
// ============================================================
function colc(c) { return c > 0 ? 'c-red' : c < 0 ? 'c-green' : 'c-gray' }
function renderStocks() {
  var list = document.getElementById('stockList');
  if (!stocks.length) { list.innerHTML = '<div class="empty-state"><div class="icon">📊</div><div class="text">暂无股票，点击右上角"添加股票"开始盯盘</div></div>'; updateStats(); return }
  list.innerHTML = stocks.map(function(s, i) {
    var chg = s.quote ? ((s.quote.price - s.quote.prevClose) / s.quote.prevClose * 100) : 0;
    var chgS = s.quote ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '%' : '--';
    var prS = s.quote ? s.quote.price.toFixed(2) : '--';
    var cl = s.quote ? colc(chg) : 'c-gray';
    var nm = s.quote ? s.quote.name : (s.name || '加载中...');
    var url = getEastmoneyUrl(s.code);
    return '<div class="stock-row" draggable="true" data-idx="' + i + '" ondragstart="dragStart(event)" ondragover="dragOver(event)" ondrop="dropRow(event)" ondragend="dragEnd(event)" ontouchstart="touchStart(event,' + i + ')" ontouchmove="touchMove(event)" ontouchend="touchEnd(event)">' +
      '<div class="drag-handle" title="拖拽排序">⠿</div>' +
      '<div class="stock-info"><div class="name ' + cl + '"><a href="' + url + '" target="_blank" rel="noopener">' + nm + '</a></div><div class="code">' + s.code + '</div></div>' +
      '<div class="kline-cell"><canvas id="kline-' + s.code + '" width="140" height="50" style="width:140px;height:50px;border-radius:4px"></canvas></div>' +
      '<div class="change-cell ' + cl + '" style="text-align:right">' + chgS + '</div>' +
      '<div class="price-cell ' + cl + '" style="text-align:right">' + prS + '</div>' +
      '<div class="editable-group"><div class="editable-row"><span class="label">目标</span><input class="editable-input" type="text" value="' + (s.target_price || '') + '" placeholder="--" onchange="updateField(' + i + ',\'target_price\',this.value)"></div><div class="editable-row"><span class="label">成本</span><input class="editable-input" type="text" value="' + (s.cost_price || '') + '" placeholder="--" onchange="updateField(' + i + ',\'cost_price\',this.value)"></div></div>' +
      '<div><input class="editable-input source-input" type="text" value="' + (s.source || '') + '" placeholder="填写消息来源..." onchange="updateField(' + i + ',\'source\',this.value)"></div>' +
      '<div style="text-align:center"><button class="target-btn ' + (s.reached ? 'yes' : 'no') + '" onclick="toggleReached(' + i + ')">' + (s.reached ? '✓ 已达标' : '未达标') + '</button></div>' +
      '<div style="text-align:center"><button class="delete-btn" onclick="removeStock(' + i + ')" title="删除">✕</button></div></div>';
  }).join('');
  setTimeout(function() { stocks.forEach(function(s) { drawKline('kline-' + s.code, s.code) }) }, 0);
  updateStats();
}
function updateStats() { document.getElementById('statCount').textContent = stocks.length; var u = 0, d = 0, f = 0, t = 0; stocks.forEach(function(s) { if (s.quote) { var c = s.quote.price - s.quote.prevClose; if (c > 0) u++; else if (c < 0) d++; else f++ } if (s.reached) t++ }); document.getElementById('statUp').textContent = u; document.getElementById('statDown').textContent = d; document.getElementById('statFlat').textContent = f; document.getElementById('statTarget').textContent = t }

// ============================================================
// 5. Drag & Drop
// ============================================================
var dragIdx = null;
function dragStart(e) { dragIdx = +e.currentTarget.dataset.idx; e.currentTarget.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move' }
function dragOver(e) { e.preventDefault(); document.querySelectorAll('.stock-row').forEach(function(r) { r.classList.remove('drag-over') }); e.currentTarget.classList.add('drag-over') }
function dropRow(e) { e.preventDefault(); var toIdx = +e.currentTarget.dataset.idx; if (dragIdx !== null && dragIdx !== toIdx) { var item = stocks.splice(dragIdx, 1)[0]; stocks.splice(toIdx, 0, item); syncOrder(); renderStocks() } document.querySelectorAll('.stock-row').forEach(function(r) { r.classList.remove('drag-over') }) }
function dragEnd(e) { e.currentTarget.classList.remove('dragging'); document.querySelectorAll('.stock-row').forEach(function(r) { r.classList.remove('drag-over') }); dragIdx = null }
var touchDragIdx = null, touchTimer = null, touchDragging = false, touchClone = null;
function touchStart(e, idx) { touchDragIdx = idx; touchTimer = setTimeout(function() { touchDragging = true; e.currentTarget.classList.add('dragging') }, 400) }
function touchMove(e) { if (!touchDragging) return; e.preventDefault() }
function touchEnd(e) { clearTimeout(touchTimer); if (touchDragging) { var el = document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY); var row = el ? el.closest('.stock-row') : null; if (row) { var toIdx = +row.dataset.idx; if (touchDragIdx !== null && touchDragIdx !== toIdx) { var item = stocks.splice(touchDragIdx, 1)[0]; stocks.splice(toIdx, 0, item); syncOrder() } } document.querySelectorAll('.stock-row').forEach(function(r) { r.classList.remove('dragging', 'drag-over') }); renderStocks() } touchDragging = false; touchDragIdx = null }
function syncOrder() { var orders = stocks.map(function(s, i) { return { id: s.id, sort_order: i } }).filter(function(o) { return o.id }); if (orders.length) api('PUT', '/api/stocks/reorder', { orders: orders }).catch(function() {}) }

// ============================================================
// 6. Interactions
// ============================================================
function updateField(i, f, v) { stocks[i][f] = v; if (stocks[i].id) api('PUT', '/api/stocks/' + stocks[i].id, JSON.parse('{"' + f + '":"' + v + '"}')).catch(function() {}) }
function toggleReached(i) { stocks[i].reached = !stocks[i].reached; if (stocks[i].id) api('PUT', '/api/stocks/' + stocks[i].id, { reached: stocks[i].reached }).catch(function() {}); renderStocks() }
async function removeStock(i) { if (!confirm('确定删除 ' + (stocks[i].name || stocks[i].code) + ' 吗？')) return; if (stocks[i].id) try { await api('DELETE', '/api/stocks/' + stocks[i].id) } catch (e) {} stocks.splice(i, 1); renderStocks() }
function openAddModal() { document.getElementById('addModal').classList.add('active'); document.getElementById('stockCodeInput').value = ''; setTimeout(function() { document.getElementById('stockCodeInput').focus() }, 100) }
function closeAddModal() { document.getElementById('addModal').classList.remove('active') }
async function addStock() {
  var code = document.getElementById('stockCodeInput').value.trim();
  if (!/^\d{6}$/.test(code)) { alert('请输入6位股票代码'); return }
  if (stocks.find(function(s) { return s.code === code })) { alert('该股票已在列表中'); return }
  var ns = { code: code, cost_price: '', target_price: '', source: '', reached: false, quote: null };
  try { var res = await api('POST', '/api/stocks', { code: code }); ns.id = res.id } catch (e) {}
  stocks.push(ns); closeAddModal(); renderStocks();
  var q = await new Promise(function(r) { var sym = getMarketPrefix(code) + code, sc = document.createElement('script'); sc.src = 'https://qt.gtimg.cn/q=' + sym + '&_=' + Date.now(); var t = setTimeout(function() { cl(); r(null) }, 5000); function cl() { clearTimeout(t); if (sc.parentNode) sc.parentNode.removeChild(sc) } sc.onload = function() { try { var raw = window['v_' + sym]; if (raw && typeof raw === 'string' && raw.length > 10) { var p = raw.split('~'); if (p.length >= 45) { cl(); r({ code: code, name: p[1], open: +p[5], prevClose: +p[4], price: +p[3], high: +p[33] || +p[41], low: +p[34] || +p[42] }); return } } } catch (e) {} cl(); r(null) }; sc.onerror = function() { cl(); r(null) }; document.head.appendChild(sc) });
  if (q) { var idx = stocks.findIndex(function(s) { return s.code === code }); if (idx >= 0) { stocks[idx].quote = q; stocks[idx].name = q.name; renderStocks(); var p = await fetchMinuteData(code); if (p && p.length > 0) { minuteData[code] = p; drawKline('kline-' + code, code) } } }
}
document.getElementById('stockCodeInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') addStock() });
document.getElementById('addModal').addEventListener('click', function(e) { if (e.target === document.getElementById('addModal')) closeAddModal() });

// ============================================================
// 7. Refresh & Clock
// ============================================================
var refreshFailed = false;
async function refreshAll() { if (!stocks.length) return; try { var codes = stocks.map(function(s) { return s.code }), res = await fetchQuotesBatch(codes); var got = false; codes.forEach(function(c, i) { if (res[c]) { stocks[i].quote = res[c]; stocks[i].name = res[c].name; got = true } }); renderStocks(); refreshFailed = !got } catch (e) { refreshFailed = true } var el = document.getElementById('refreshIndicator'), tx = document.getElementById('refreshText'); if (refreshFailed) { el.classList.add('error'); tx.textContent = '连接异常' } else { el.classList.remove('error'); tx.textContent = '实时更新中' } }
function updateClock() { var n = new Date(); document.getElementById('clock').textContent = [n.getHours(), n.getMinutes(), n.getSeconds()].map(function(v) { return String(v).padStart(2, '0') }).join(':'); var d = n.getDay(), hm = n.getHours() * 100 + n.getMinutes(); var s = '休市'; if (d >= 1 && d <= 5) { if (hm >= 915 && hm < 925) s = '集合竞价'; else if (hm >= 925 && hm < 930) s = '即将开盘'; else if (hm >= 930 && hm < 1130) s = '🔴 交易中（上午）'; else if (hm >= 1130 && hm < 1300) s = '午间休市'; else if (hm >= 1300 && hm < 1500) s = '🔴 交易中（下午）'; else if (hm >= 1500) s = '已收盘'; else s = '未开盘' } document.getElementById('marketStatus').textContent = s }

// ============================================================
// 8. Init
// ============================================================
var appInited = false;
async function initApp() {
  if (appInited) return; appInited = true;
  try { stocks = await api('GET', '/api/stocks') || [] } catch (e) { stocks = [] }
  updateClock(); setInterval(updateClock, 1000); renderStocks();
  var def = ['301053', '603398', '002713', '300091', '000826'];
  var missing = def.filter(function(c) { return !stocks.find(function(s) { return s.code === c }) });
  for (var ci = 0; ci < missing.length; ci++) { try { var res = await api('POST', '/api/stocks', { code: missing[ci] }); stocks.push({ id: res.id, code: missing[ci], cost_price: '', target_price: '', source: '', reached: false, quote: null }) } catch (e) {} }
  if (missing.length) renderStocks();
  if (stocks.length) await refreshAll();
  await loadAllMinuteData();
  setInterval(refreshAll, 10000);
  setInterval(loadAllMinuteData, 60000);
}

// Boot
(async function() {
  if (!authToken) return;
  try { currentUser = await api('GET', '/api/me'); enterApp() } catch (e) { authToken = ''; localStorage.removeItem('liuge_token') }
})();

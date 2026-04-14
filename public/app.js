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
    if (e.message === '用户名或密码错误') {
      // Check if user exists: try register without invite code — if error is '用户名已存在', password is wrong
      // Otherwise, it's a new user — show step 2
      pendingUser = user; pendingPass = pass;
      try {
        // Try register — if first user, will succeed without invite code
        var regRes = await api('POST', '/api/register', { username: user, password: pass });
        // Success! First user registered as admin
        authToken = regRes.token; localStorage.setItem('liuge_token', authToken);
        currentUser = regRes.user; enterApp(); return;
      } catch (e2) {
        if (e2.message === '用户名已存在') {
          err.textContent = '密码错误，请重试'; return;
        }
        // New user but needs invite code — show step 2
        document.getElementById('loginStep1').style.display = 'none';
        document.getElementById('loginStep2').classList.add('active');
        document.getElementById('loginPassConfirm').value = '';
        document.getElementById('loginInviteCode').value = '';
        setTimeout(function() { document.getElementById('loginPassConfirm').focus() }, 100);
        return;
      }
    }
    err.textContent = e.message;
  }
}

async function loginStep2() {
  const cp = document.getElementById('loginPassConfirm').value;
  const invCode = (document.getElementById('loginInviteCode').value || '').trim().toUpperCase();
  const err = document.getElementById('loginError2'); err.textContent = '';
  if (!cp) { err.textContent = '请再次输入密码'; return }
  if (cp !== pendingPass) { err.textContent = '两次密码不一致'; return }
  try {
    const body = { username: pendingUser, password: pendingPass };
    if (invCode) body.invite_code = invCode;
    const res = await api('POST', '/api/register', body);
    authToken = res.token; localStorage.setItem('liuge_token', authToken);
    currentUser = res.user; enterApp();
  } catch (e) { err.textContent = e.message }
}

function backToStep1() { document.getElementById('loginStep2').classList.remove('active'); document.getElementById('loginStep1').style.display = 'block' }

// 头像菜单弹窗
function toggleUserMenu(e) {
  e.stopPropagation();
  var menu = document.getElementById('userMenu');
  menu.classList.toggle('open');
}
function closeUserMenu() {
  var menu = document.getElementById('userMenu');
  if (menu) menu.classList.remove('open');
}
// 点击页面其他地方关闭弹窗
document.addEventListener('click', function() { closeUserMenu() });

function doLogout() {
  closeUserMenu();
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
  document.getElementById('adminLink').style.display = 'inline-flex';
  document.getElementById('addStockBtn').style.display = u.is_admin ? 'inline-flex' : 'none';
  document.getElementById('editModeBtn').style.display = u.is_admin ? 'inline-flex' : 'none';
  renderTableHeader();
  initApp();
}

document.getElementById('loginUser').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginPass').focus() });
document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') loginStep1() });
document.getElementById('loginPassConfirm').addEventListener('keydown', e => { if (e.key === 'Enter') loginStep2() });

// ============================================================
// 2. Admin Page
// ============================================================
let editingAvatarUserId = null;
async function showAdmin() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('adminPage').classList.add('active');
  if (currentUser) { document.getElementById('adminName').textContent = currentUser.display_name || currentUser.username; const av = document.getElementById('adminAvatar'); if (currentUser.avatar) av.innerHTML = '<img src="' + currentUser.avatar + '">'; else av.textContent = (currentUser.display_name || currentUser.username).charAt(0).toUpperCase() }
  // 普通用户隐藏管理员专属区域
  var isAdmin = currentUser && currentUser.is_admin;
  var adminStats = document.getElementById('adminStatsBar');
  if (adminStats) adminStats.style.display = isAdmin ? '' : 'none';
  var inviteSection = document.getElementById('inviteSection');
  if (inviteSection) inviteSection.style.display = isAdmin ? '' : 'none';
  // 管理页标题根据角色调整
  var adminTitle = document.getElementById('adminPageTitle');
  if (adminTitle) adminTitle.textContent = isAdmin ? '👥 用户管理' : '👤 个人设置';
  await renderAdminUsers();
  if (isAdmin) await renderInvites();
  await checkWxPusherStatus();
}
function showApp() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('appPage').classList.add('active');
  // 返回时重新渲染，确保列表正常显示
  renderStocks();
}

async function renderAdminUsers() {
  try {
    const users = await api('GET', '/api/users');
    const tbody = document.getElementById('adminUserList');
    const isAdmin = currentUser && currentUser.is_admin;
    // 动态表头
    var theadRow = tbody.parentElement.querySelector('thead tr');
    if (isAdmin) {
      theadRow.innerHTML = '<th>UID</th><th>头像 / 用户名</th><th>登录状态</th><th>管理员</th><th>管理员开关</th><th></th>';
    } else {
      theadRow.innerHTML = '<th>头像 / 用户名</th>';
    }
    if (isAdmin) {
      document.getElementById('adminTotalUsers').textContent = users.length;
      document.getElementById('adminTotalAdmins').textContent = users.filter(u => u.is_admin).length;
    }
    tbody.innerHTML = users.map(u => {
      const isSelf = currentUser && u.id === currentUser.id;
      const dn = u.display_name || u.username;
      const avH = u.avatar ? '<img src="' + u.avatar + '">' : '<span>' + dn.charAt(0).toUpperCase() + '</span>';
      const ts = u.last_login ? timeDiff(u.last_login) : '未知';
      var row = '<tr>';
      if (isAdmin) row += '<td style="font-variant-numeric:tabular-nums;font-size:12px;color:var(--text-muted)">' + u.id + '</td>';
      row += '<td><div class="admin-avatar-cell">' +
        (isSelf
          ? '<div class="admin-avatar-img" onclick="triggerAvatarUpload(' + u.id + ')" title="点击更换头像">' + avH + '<img class="avatar-pencil" src="/image/pencil.png" width="14" height="14"></div>'
          : '<div class="admin-avatar-img" style="cursor:default">' + avH + '</div>') +
        '<div><div>' +
        (isSelf
          ? '<strong contenteditable="true" spellcheck="false" style="outline:none;min-width:40px;display:inline-block;border-bottom:1px dashed var(--border-color);padding:0 2px" oninput="onNameEdit(this)" onblur="saveName(' + u.id + ',this)">' + dn + '</strong><span style="font-size:10px;color:var(--gold);margin-left:6px">(我)</span>'
          : '<strong>' + dn + '</strong>') +
        '</div><div style="font-size:10px;color:var(--text-muted)">@' + u.username + '</div></div></div></td>';
      if (isAdmin) {
        row += '<td><span class="status-dot ' + (isSelf ? 'online' : 'offline') + '"></span>' + (isSelf ? '在线' : ts + '前') + '</td>' +
        '<td><span class="admin-badge ' + (u.is_admin ? 'yes' : 'no') + '">' + (u.is_admin ? '管理员' : '普通用户') + '</span></td>' +
        '<td><label class="toggle-switch"><input type="checkbox" ' + (u.is_admin ? 'checked' : '') + ' ' + (isSelf ? 'disabled' : '') + ' onchange="toggleAdmin(' + u.id + ',this.checked)"><span class="toggle-slider"></span></label>' + (isSelf ? '<span style="font-size:10px;color:var(--text-muted);margin-left:6px">不可修改</span>' : '') + '</td>' +
        '<td>' + (isSelf ? '' : '<button class="delete-btn" onclick="deleteUser(' + u.id + ',\'' + dn.replace(/'/g, "\\'") + '\')" title="删除用户" style="display:inline-flex">✕</button>') + '</td>';
      }
      row += '</tr>';
      return row;
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
async function deleteUser(userId, name) { if (!confirm('确定删除用户 "' + name + '" 吗？该操作不可撤销。')) return; try { await api('DELETE', '/api/users/' + userId); renderAdminUsers() } catch (e) { alert(e.message) } }
function timeDiff(ts) { const d = Date.now() - ts, m = Math.floor(d / 60000); if (m < 1) return '刚刚'; if (m < 60) return m + '分钟'; const h = Math.floor(m / 60); if (h < 24) return h + '小时'; return Math.floor(h / 24) + '天' }

// ============================================================
// 2b. WxPusher 绑定
// ============================================================
async function checkWxPusherStatus() {
  try {
    var res = await api('GET', '/api/wxpusher/status');
    if (res.bound) {
      document.getElementById('wxpusherBound').style.display = '';
      document.getElementById('wxpusherUnbound').style.display = 'none';
    } else {
      document.getElementById('wxpusherBound').style.display = 'none';
      document.getElementById('wxpusherUnbound').style.display = '';
    }
  } catch(e) {}
}

async function bindWxPusher() {
  try {
    var res = await api('GET', '/api/wxpusher/qrcode');
    if (res.data && res.data.url) {
      document.getElementById('wxpusherQRImg').src = res.data.url;
      document.getElementById('wxpusherQR').style.display = '';
      // 每3秒检查是否已绑定
      var checkInterval = setInterval(async function() {
        var status = await api('GET', '/api/wxpusher/status');
        if (status.bound) {
          clearInterval(checkInterval);
          document.getElementById('wxpusherQR').style.display = 'none';
          document.getElementById('wxpusherBound').style.display = '';
          document.getElementById('wxpusherUnbound').style.display = 'none';
        }
      }, 3000);
      // 5分钟后停止轮询
      setTimeout(function() { clearInterval(checkInterval) }, 300000);
    }
  } catch(e) { alert('生成二维码失败: ' + e.message) }
}

async function unbindWxPusher() {
  if (!confirm('确定解绑微信推送吗？解绑后将不再收到价格提醒。')) return;
  try {
    await api('DELETE', '/api/wxpusher/bindling');
    document.getElementById('wxpusherBound').style.display = 'none';
    document.getElementById('wxpusherUnbound').style.display = '';
  } catch(e) { alert(e.message) }
}

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
async function loadAllMinuteData() {
  await Promise.all(stocks.map(async function(s) { var p = await fetchMinuteData(s.code); if (p && p.length > 0) minuteData[s.code] = p }));
  stocks.forEach(function(s) { drawKline('kline-' + s.code, s.code); var mc = document.getElementById('mkline-' + s.code); if(mc){drawKline('mkline-' + s.code, s.code, mc.parentElement.clientWidth||100, 28)} });
}

function drawKline(id, code, W, H) {
  var cv = document.getElementById(id); if (!cv) return;
  W = W || 140; H = H || 50;
  var s = stocks.find(function(x) { return x.code === code }), ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
  // 固定canvas像素尺寸，防止被flex拉伸
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  cv.style.maxWidth = W + 'px';
  ctx.scale(dpr, dpr);
  var isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  ctx.clearRect(0, 0, W, H);
  var gridColor = isDark ? 'rgba(110,118,129,0.35)' : 'rgba(0,0,0,0.1)';
  var labelColor = isDark ? '#6e7681' : '#9a9a9e';
  if (!s || !s.quote || !s.quote.prevClose || s.quote.price <= 0) { ctx.fillStyle = labelColor; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('等待数据...', W / 2, H / 2 + 3); return }
  var q = s.quote, pc = q.prevClose, pts = minuteData[code];
  if (!pts || pts.length < 2) { ctx.fillStyle = labelColor; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('加载中...', W / 2, H / 2 + 3); return }

  // A股一天共240分钟（9:30-11:30=120分钟 + 13:00-15:00=120分钟）
  var TOTAL_MINUTES = 240;
  // 按总交易时长分配X轴，未收盘时走线只到当前进度位置
  var sx = W / TOTAL_MINUTES;  // 每分钟的像素宽度
  var dataWidth = (pts.length - 1) * sx; // 实际数据占据的宽度

  var all = [pc].concat(pts), mn = Math.min.apply(null, all) * 0.999, mx = Math.max.apply(null, all) * 1.001, rng = mx - mn || 1, pad = 3;
  function toY(v) { return pad + ((mx - v) / rng) * (H - pad * 2) }

  // 昨收基准线（画满整个宽度）
  ctx.strokeStyle = gridColor; ctx.lineWidth = 0.5; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(0, toY(pc)); ctx.lineTo(W, toY(pc)); ctx.stroke(); ctx.setLineDash([]);

  var lp = pts[pts.length - 1], lc = lp > pc ? '#ef4444' : lp < pc ? '#22c55e' : '#6e7681';


  // 走势线
  ctx.beginPath(); ctx.moveTo(0, toY(pts[0]));
  pts.forEach(function(p, i) { ctx.lineTo(i * sx, toY(p)) });
  ctx.strokeStyle = lc; ctx.lineWidth = 1.5; ctx.stroke();

  // 终点圆点
  var ex = dataWidth, ey = toY(lp);
  var hl = lc === '#ef4444' ? 'rgba(239,68,68,0.2)' : lc === '#22c55e' ? 'rgba(34,197,94,0.2)' : 'rgba(110,118,129,0.2)';
  ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fillStyle = hl; ctx.fill();
  ctx.beginPath(); ctx.arc(ex, ey, 1.5, 0, Math.PI * 2); ctx.fillStyle = lc; ctx.fill();
}

function fetchQuotesBatch(codes) { if (!codes.length) return Promise.resolve({}); return new Promise(function(r) { var syms = codes.map(function(c) { return getMarketPrefix(c) + c }).join(','), sc = document.createElement('script'); sc.src = 'https://qt.gtimg.cn/q=' + syms + '&_=' + Date.now(); var t = setTimeout(function() { cl(); r({}) }, 8000); function cl() { clearTimeout(t); if (sc.parentNode) sc.parentNode.removeChild(sc) } sc.onload = function() { var res = {}; codes.forEach(function(code) { try { var sym = getMarketPrefix(code) + code, raw = window['v_' + sym]; if (raw && typeof raw === 'string' && raw.length > 10) { var p = raw.split('~'); if (p.length >= 45) res[code] = { code: code, name: p[1], open: +p[5], prevClose: +p[4], price: +p[3], high: +p[33] || +p[41], low: +p[34] || +p[42], volume: +p[6], amount: +p[37], change: +p[31], changePercent: +p[32] } } } catch (e) {} }); cl(); r(res) }; sc.onerror = function() { cl(); r({}) }; document.head.appendChild(sc) }) }

// ============================================================
// 3.5 Edit Mode — 编辑/保存模式
// ============================================================
var editMode = false;

function toggleEditMode() {
  editMode = true;
  document.getElementById('editModeBtn').style.display = 'none';
  document.getElementById('saveModeBtn').style.display = 'inline-flex';
  // 编辑模式下保留添加股票按钮
  renderStocks();
}

async function saveAllChanges() {
  // 收集所有编辑中的字段
  var rows = document.querySelectorAll('[data-idx]');
  var promises = [];
  rows.forEach(function(row) {
    var idx = +row.dataset.idx;
    var s = stocks[idx];
    if (!s || !s.id) return;
    var targetInput = row.querySelector('[data-field="target_price"]');
    var costInput = row.querySelector('[data-field="cost_price"]');
    var sourceInput = row.querySelector('[data-field="source"]');
    var body = {};
    var changed = false;
    if (targetInput && targetInput.value !== (s.target_price || '')) { body.target_price = targetInput.value; s.target_price = targetInput.value; changed = true; }
    if (costInput && costInput.value !== (s.cost_price || '')) { body.cost_price = costInput.value; s.cost_price = costInput.value; changed = true; }
    if (sourceInput && sourceInput.value !== (s.source || '')) { body.source = sourceInput.value; s.source = sourceInput.value; changed = true; }
    if (changed) promises.push(api('PUT', '/api/stocks/' + s.id, body).catch(function() {}));
  });
  if (promises.length) await Promise.all(promises);
  editMode = false;
  document.getElementById('editModeBtn').style.display = 'inline-flex';
  document.getElementById('saveModeBtn').style.display = 'none';
  if (currentUser && currentUser.is_admin) document.getElementById('addStockBtn').style.display = 'inline-flex';
  renderStocks();
}

// ============================================================
// 4. Table Header (admin vs user)
// ============================================================
function renderTableHeader() {
  var isAdmin = currentUser && currentUser.is_admin;
  var hdr = document.getElementById('tableHeader');
  if (isAdmin) {
    hdr.innerHTML = '<div class="table-header-admin"><div></div><div>股票名称 / 代码</div><div style="text-align:center">分时走势</div><div style="text-align:right">当前价格</div><div style="text-align:right">涨跌幅</div><div style="text-align:center">目标 / 成本价</div><div>备注</div><div style="text-align:center">关注</div><div>评论</div><div></div></div>';
  } else {
    hdr.innerHTML = '<div class="table-header-user"><div>股票名称 / 代码</div><div style="text-align:center">分时走势</div><div style="text-align:right">当前价格</div><div style="text-align:right">涨跌幅</div><div style="text-align:center">目标 / 成本价</div><div>备注</div><div style="text-align:center">关注</div><div>评论</div></div>';
  }
}

// ============================================================
// 5. Render — Desktop + Mobile
// ============================================================
function colc(c) { return c > 0 ? 'c-red' : c < 0 ? 'c-green' : 'c-gray' }

function renderStocks() {
  var list = document.getElementById('stockList');
  var mobileList = document.getElementById('mobileStockList');
  var isAdmin = currentUser && currentUser.is_admin;
  var rowClass = isAdmin ? 'stock-row-admin' : 'stock-row-user';

  if (!stocks.length) {
    var emptyMsg = isAdmin ? '暂无股票，点击右上角"添加股票"开始盯盘' : '暂无股票，请联系管理员添加';
    list.innerHTML = '<div class="empty-state"><div class="icon">📊</div><div class="text">' + emptyMsg + '</div></div>';
    if (mobileList) mobileList.innerHTML = '<div class="empty-state"><div class="icon">📊</div><div class="text">' + emptyMsg + '</div></div>';
    return;
  }

  // Desktop
  list.innerHTML = stocks.map(function(s, i) {
    var chg = s.quote ? ((s.quote.price - s.quote.prevClose) / s.quote.prevClose * 100) : 0;
    var chgS = s.quote ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '%' : '--';
    var prS = s.quote ? s.quote.price.toFixed(2) : '--';
    var cl = s.quote ? colc(chg) : 'c-gray';
    var nm = s.quote ? s.quote.name : (s.name || '加载中...');
    var url = getEastmoneyUrl(s.code);
    var dragAttrs = (isAdmin && editMode) ? ' draggable="true" ondragstart="dragStart(event)" ondragover="dragOver(event)" ondrop="dropRow(event)" ondragend="dragEnd(event)" ontouchstart="touchStart(event,' + i + ')" ontouchmove="touchMove(event)" ontouchend="touchEnd(event)"' : '';

    var html = '<div class="' + rowClass + '" data-idx="' + i + '"' + dragAttrs + '>';

    if (isAdmin && editMode) html += '<div class="drag-handle" title="拖拽排序">⠿</div>';
    else if (isAdmin) html += '<div style="width:30px"></div>';

    html += '<div class="stock-info"><div class="name ' + cl + '"><a href="' + url + '" target="_blank" rel="noopener">' + nm + '</a></div><div class="code">' + s.code + '</div></div>';
    html += '<div class="kline-cell"><canvas id="kline-' + s.code + '" width="140" height="50" style="width:140px;height:50px;border-radius:4px"></canvas></div>';
    html += '<div class="price-cell ' + cl + '" style="text-align:right">' + prS + '</div>';
    html += '<div class="change-cell ' + cl + '" style="text-align:right">' + chgS + '</div>';

    // 目标/成本 — 编辑模式才可编辑
    var canEdit = isAdmin && editMode;
    html += '<div class="editable-group"><div class="editable-row"><span class="label">目标</span>';
    if (canEdit) html += '<input class="editable-input" type="text" data-field="target_price" value="' + (s.target_price || '') + '" placeholder="--">';
    else html += '<span class="editable-display">' + (s.target_price || '--') + '</span>';
    html += '</div><div class="editable-row"><span class="label">成本</span>';
    if (canEdit) html += '<input class="editable-input" type="text" data-field="cost_price" value="' + (s.cost_price || '') + '" placeholder="--">';
    else html += '<span class="editable-display">' + (s.cost_price || '--') + '</span>';
    html += '</div></div>';

    // 备注
    html += '<div>';
    if (canEdit) html += '<textarea class="editable-input source-input" data-field="source" rows="3" placeholder="添加备注...">' + (s.source || '') + '</textarea>';
    else html += '<span class="editable-display" style="font-size:12px;white-space:pre-wrap">' + (s.source || '--') + '</span>';
    html += '</div>';

    // 关注状态（眼睛图标）
    var eyeOn = '<img src="/image/eye-fill.png" width="28" height="28" alt="关注中">';
    var eyeOff = '<img src="/image/eye.png" width="28" height="28" alt="未关注">';
    html += '<div style="text-align:center">';
    if (canEdit) html += '<button class="watch-btn" onclick="toggleReached(' + i + ')" title="' + (s.reached ? '关注中' : '未关注') + '">' + (s.reached ? eyeOn : eyeOff) + '</button>';
    else html += '<span class="watch-btn" style="cursor:default">' + (s.reached ? eyeOn : eyeOff) + '</span>';
    html += '</div>';

    // 评论列
    var comments = (s.comments || []).slice().reverse();
    html += '<div class="comment-cell">';
    comments.forEach(function(c) {
      var initial = (c.display_name || c.username || '?').charAt(0).toUpperCase();
      var canDel = (currentUser && (c.user_id === currentUser.id || currentUser.is_admin));
      html += '<div class="comment-item">';
      html += '<div class="comment-avatar">' + initial + '</div>';
      html += '<div class="comment-body"><span class="comment-author">' + (c.display_name || c.username) + '</span> ';
      html += '<span class="comment-text">' + escHtml(c.content) + '</span> ';
      html += '<span class="comment-time">' + timeAgo(c.created_at) + '</span>';
      if (canDel) html += ' <button class="comment-del" onclick="deleteComment(' + c.id + ',' + s.id + ')" title="删除">✕</button>';
      html += '</div></div>';
    });
    html += '<div class="comment-input-wrap"><input class="comment-input" placeholder="写评论..." data-stock-id="' + s.id + '" onkeydown="if(event.key===\'Enter\')sendComment(this)"><button class="comment-send" onclick="sendComment(this.previousElementSibling)">发送</button></div>';
    html += '</div>';

    // 删除 — 编辑模式才显示
    if (canEdit) html += '<div style="text-align:center"><button class="delete-btn" onclick="removeStock(' + i + ')" title="删除">✕</button></div>';
    else if (isAdmin) html += '<div></div>';

    html += '</div>';
    return html;
  }).join('');

  // Mobile cards — 按设计稿排版
  if (mobileList) {
    mobileList.innerHTML = stocks.map(function(s, i) {
      var chg = s.quote ? ((s.quote.price - s.quote.prevClose) / s.quote.prevClose * 100) : 0;
      var chgS = s.quote ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '%' : '--';
      var prS = s.quote ? s.quote.price.toFixed(2) : '--';
      var cl = s.quote ? colc(chg) : 'c-gray';
      var nm = s.quote ? s.quote.name : (s.name || '加载中...');
      var url = getEastmoneyUrl(s.code);
      var noteText = s.source || '';
      var eyeImg = s.reached
        ? '<img src="/image/eye-fill.png" width="20" height="20" alt="关注中">'
        : '<img src="/image/eye.png" width="20" height="20" alt="未关注">';
      return '<div class="m-card">' +
        '<div class="m-line1">' +
          '<div class="m-line1-left">' +
            '<a class="m-stock-name ' + cl + '" href="' + url + '" target="_blank" rel="noopener">' + nm + '</a>' +
            '<span class="m-eye">' + eyeImg + '</span>' +
          '</div>' +
          '<div class="m-line1-chart"><canvas id="mkline-' + s.code + '"></canvas></div>' +
          '<div class="m-line1-price ' + cl + '">¥' + prS + '</div>' +
        '</div>' +
        '<div class="m-line2">' +
          '<div class="m-line2-code">' + s.code + '</div>' +
          '<div class="m-line2-right"><span class="m-line2-change ' + cl + '">' + chgS + '</span></div>' +
        '</div>' +
        '<div class="m-line3">' +
          '<div></div>' +
          '<div class="m-line3-meta">成本:' + (s.cost_price || '--') + '  目标:' + (s.target_price || '--') + '</div>' +
        '</div>' +
        (noteText ? '<div class="m-line4">' + noteText + '</div>' : '') +
        buildMobileComments(s) +
      '</div>';
    }).join('');
  }

  // Draw klines
  setTimeout(function() {
    stocks.forEach(function(s) {
      drawKline('kline-' + s.code, s.code);
      var mCv = document.getElementById('mkline-' + s.code);
      if (mCv) {
        var mW = mCv.parentElement.clientWidth || 100;
        drawKline('mkline-' + s.code, s.code, mW, 28);
      }
    });
  }, 0);
}

// ============================================================
// 6. Drag & Drop
// ============================================================
var dragIdx = null;
function dragStart(e) { dragIdx = +e.currentTarget.dataset.idx; e.currentTarget.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move' }
function dragOver(e) { e.preventDefault(); document.querySelectorAll('[class^="stock-row"]').forEach(function(r) { r.classList.remove('drag-over') }); e.currentTarget.classList.add('drag-over') }
function dropRow(e) { e.preventDefault(); var toIdx = +e.currentTarget.dataset.idx; if (dragIdx !== null && dragIdx !== toIdx) { var item = stocks.splice(dragIdx, 1)[0]; stocks.splice(toIdx, 0, item); syncOrder(); renderStocks() } document.querySelectorAll('[class^="stock-row"]').forEach(function(r) { r.classList.remove('drag-over') }) }
function dragEnd(e) { e.currentTarget.classList.remove('dragging'); document.querySelectorAll('[class^="stock-row"]').forEach(function(r) { r.classList.remove('drag-over') }); dragIdx = null }
var touchDragIdx = null, touchTimer = null, touchDragging = false;
function touchStart(e, idx) { touchDragIdx = idx; touchTimer = setTimeout(function() { touchDragging = true; e.currentTarget.classList.add('dragging') }, 400) }
function touchMove(e) { if (!touchDragging) return; e.preventDefault() }
function touchEnd(e) { clearTimeout(touchTimer); if (touchDragging) { var el = document.elementFromPoint(e.changedTouches[0].clientX, e.changedTouches[0].clientY); var row = el ? el.closest('[class^="stock-row"]') : null; if (row) { var toIdx = +row.dataset.idx; if (touchDragIdx !== null && touchDragIdx !== toIdx) { var item = stocks.splice(touchDragIdx, 1)[0]; stocks.splice(toIdx, 0, item); syncOrder() } } document.querySelectorAll('[class^="stock-row"]').forEach(function(r) { r.classList.remove('dragging', 'drag-over') }); renderStocks() } touchDragging = false; touchDragIdx = null }
function syncOrder() { var orders = stocks.map(function(s, i) { return { id: s.id, sort_order: i } }).filter(function(o) { return o.id }); if (orders.length) api('PUT', '/api/stocks/reorder', { orders: orders }).catch(function() {}) }

// ============================================================
// 7. Interactions
// ============================================================
function updateField(i, f, v) {
  stocks[i][f] = v;
  if (stocks[i].id) {
    var body = {};
    body[f] = v;
    api('PUT', '/api/stocks/' + stocks[i].id, body).catch(function() {});
  }
}
function toggleReached(i) { stocks[i].reached = !stocks[i].reached; if (stocks[i].id) api('PUT', '/api/stocks/' + stocks[i].id, { reached: stocks[i].reached }).catch(function() {}); renderStocks() }
async function removeStock(i) { if (!confirm('确定删除 ' + (stocks[i].name || stocks[i].code) + ' 吗？')) return; if (stocks[i].id) try { await api('DELETE', '/api/stocks/' + stocks[i].id) } catch (e) {} stocks.splice(i, 1); renderStocks() }
function openAddModal() { document.getElementById('addModal').classList.add('active'); document.getElementById('stockCodeInput').value = ''; setTimeout(function() { document.getElementById('stockCodeInput').focus() }, 100) }
function closeAddModal() { document.getElementById('addModal').classList.remove('active') }
async function addStock() {
  var code = document.getElementById('stockCodeInput').value.trim();
  if (!/^\d{6}$/.test(code)) { alert('请输入6位股票代码'); return }
  if (stocks.find(function(s) { return s.code === code })) { alert('该股票已在列表中'); return }
  var ns = { code: code, cost_price: '', target_price: '', source: '', reached: false, quote: null };
  try { var res = await api('POST', '/api/stocks', { code: code }); ns.id = res.id } catch (e) { alert(e.message); return }
  stocks.push(ns); closeAddModal(); renderStocks();
  var q = await new Promise(function(r) { var sym = getMarketPrefix(code) + code, sc = document.createElement('script'); sc.src = 'https://qt.gtimg.cn/q=' + sym + '&_=' + Date.now(); var t = setTimeout(function() { cl(); r(null) }, 5000); function cl() { clearTimeout(t); if (sc.parentNode) sc.parentNode.removeChild(sc) } sc.onload = function() { try { var raw = window['v_' + sym]; if (raw && typeof raw === 'string' && raw.length > 10) { var p = raw.split('~'); if (p.length >= 45) { cl(); r({ code: code, name: p[1], open: +p[5], prevClose: +p[4], price: +p[3], high: +p[33] || +p[41], low: +p[34] || +p[42] }); return } } } catch (e) {} cl(); r(null) }; sc.onerror = function() { cl(); r(null) }; document.head.appendChild(sc) });
  if (q) { var idx = stocks.findIndex(function(s) { return s.code === code }); if (idx >= 0) { stocks[idx].quote = q; stocks[idx].name = q.name; renderStocks(); var p = await fetchMinuteData(code); if (p && p.length > 0) { minuteData[code] = p; drawKline('kline-' + code, code); var mc = document.getElementById('mkline-' + code); if(mc){drawKline('mkline-' + code, code, mc.parentElement.clientWidth||100, 28)} } } }
}
document.getElementById('stockCodeInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') addStock() });
document.getElementById('addModal').addEventListener('click', function(e) { if (e.target === document.getElementById('addModal')) closeAddModal() });


// ============================================================
// 7b. Comments
// ============================================================
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
function timeAgo(ts) { var d = Date.now() - ts, m = Math.floor(d/60000); if(m<1)return'刚刚'; if(m<60)return m+'分钟前'; var h=Math.floor(m/60); if(h<24)return h+'小时前'; return Math.floor(h/24)+'天前' }

function buildMobileComments(s) {
  var comments = (s.comments || []).slice().reverse();
  if (!comments.length) return '<div class="m-comments"><div class="m-comment-input-wrap"><input class="m-comment-input" placeholder="写评论..." data-stock-id="' + s.id + '" onkeydown="if(event.key===\'Enter\')sendComment(this)"><button class="comment-send" onclick="sendComment(this.previousElementSibling)">发送</button></div></div>';
  var first = comments[0];
  var total = comments.length;
  var initial = (first.display_name || first.username || '?').charAt(0).toUpperCase();
  var html = '<div class="m-comments">';
  // 预览：第1条
  html += '<div class="m-comment-preview">';
  html += '<div class="comment-avatar">' + initial + '</div>';
  html += '<span class="comment-text"><b>' + (first.display_name || first.username) + '</b> ' + escHtml(first.content) + '</span>';
  if (total > 1) html += '<button class="m-comment-toggle" onclick="toggleMobileComments(this,' + s.id + ')">(' + total + ') ▼</button>';
  html += '</div>';
  // 所有评论（默认隐藏）— 跳过第1条，只显示剩余
  html += '<div class="m-comment-all" id="mComments-' + s.id + '" style="display:none">';
  comments.slice(1).forEach(function(c) {
    var ci = (c.display_name || c.username || '?').charAt(0).toUpperCase();
    var canDel = currentUser && (c.user_id === currentUser.id || currentUser.is_admin);
    html += '<div class="comment-item"><div class="comment-avatar">' + ci + '</div><div class="comment-body"><span class="comment-author">' + (c.display_name || c.username) + '</span> <span class="comment-text">' + escHtml(c.content) + '</span> <span class="comment-time">' + timeAgo(c.created_at) + '</span>';
    if (canDel) html += ' <button class="comment-del" onclick="deleteComment(' + c.id + ',' + s.id + ')">✕</button>';
    html += '</div></div>';
  });
  html += '</div>';
  // 输入框
  html += '<div class="m-comment-input-wrap"><input class="m-comment-input" placeholder="写评论..." data-stock-id="' + s.id + '" onkeydown="if(event.key===\'Enter\')sendComment(this)"><button class="comment-send" onclick="sendComment(this.previousElementSibling)">发送</button></div>';
  html += '</div>';
  return html;
}

function toggleMobileComments(btn, stockId) {
  var el = document.getElementById('mComments-' + stockId);
  if (!el) return;
  if (el.style.display === 'none') { el.style.display = 'block'; btn.textContent = btn.textContent.replace('▼','▲') }
  else { el.style.display = 'none'; btn.textContent = btn.textContent.replace('▲','▼') }
}

async function sendComment(input) {
  var stockId = input.dataset.stockId;
  var content = input.value.trim();
  if (!content) return;
  try {
    await api('POST', '/api/stocks/' + stockId + '/comments', { content: content });
    input.value = '';
    // 刷新评论：从服务器拉最新stocks
    var serverStocks = await api('GET', '/api/stocks');
    if (serverStocks) { var qm = {}; stocks.forEach(function(s){if(s.quote)qm[s.code]=s.quote}); stocks = serverStocks; stocks.forEach(function(s){if(qm[s.code])s.quote=qm[s.code]}); }
    renderStocks();
  } catch(e) { alert(e.message) }
}

async function deleteComment(commentId, stockId) {
  if (!confirm('删除这条评论？')) return;
  try {
    await api('DELETE', '/api/comments/' + commentId);
    var serverStocks = await api('GET', '/api/stocks');
    if (serverStocks) { var qm = {}; stocks.forEach(function(s){if(s.quote)qm[s.code]=s.quote}); stocks = serverStocks; stocks.forEach(function(s){if(qm[s.code])s.quote=qm[s.code]}); }
    renderStocks();
  } catch(e) { alert(e.message) }
}

// ============================================================
// 8. Refresh & Clock
// ============================================================
var refreshFailed = false;
async function refreshAll() {
  // 编辑模式下不从服务器拉取列表
  if (!editMode) {
    try {
      var serverStocks = await api('GET', '/api/stocks');
      if (serverStocks) {
        var quoteMap = {};
        stocks.forEach(function(s) { if (s.quote) quoteMap[s.code] = s.quote });
        stocks = serverStocks;
        stocks.forEach(function(s) { if (quoteMap[s.code]) s.quote = quoteMap[s.code] });
      }
    } catch (e) {}
  }
  if (!stocks.length) { renderStocks(); return; }
  try {
    var codes = stocks.map(function(s) { return s.code });
    var res = await fetchQuotesBatch(codes);
    var got = false;
    codes.forEach(function(c, i) { if (res[c]) { stocks[i].quote = res[c]; stocks[i].name = res[c].name; got = true } });
    if (!editMode) renderStocks();
    refreshFailed = !got;
  } catch (e) { refreshFailed = true }
  var el = document.getElementById('refreshIndicator'), tx = document.getElementById('refreshText');
  var elM = document.getElementById('refreshIndicatorM'), txM = document.getElementById('refreshTextM');
  if (refreshFailed) { el.classList.add('error'); tx.textContent = '连接异常'; if(elM){elM.classList.add('error');txM.textContent='连接异常'} } else { el.classList.remove('error'); tx.textContent = '实时更新中'; if(elM){elM.classList.remove('error');txM.textContent='实时更新中'} }
}

function updateClock() {
  var n = new Date();
  var timeStr = [n.getHours(), n.getMinutes(), n.getSeconds()].map(function(v) { return String(v).padStart(2, '0') }).join(':');
  document.getElementById('clock').textContent = timeStr;
  var cm = document.getElementById('clockM'); if (cm) cm.textContent = timeStr;

  var d = n.getDay(), hm = n.getHours() * 100 + n.getMinutes();
  var s = '休市';
  var isTrading = false;
  if (d >= 1 && d <= 5) {
    if (hm >= 915 && hm < 925) { s = '集合竞价'; isTrading = true; }
    else if (hm >= 925 && hm < 930) { s = '即将开盘'; isTrading = true; }
    else if (hm >= 930 && hm < 1130) { s = '交易中'; isTrading = true; }
    else if (hm >= 1130 && hm < 1300) { s = '午间休市'; isTrading = true; }
    else if (hm >= 1300 && hm < 1500) { s = '交易中'; isTrading = true; }
    else if (hm >= 1500) { s = '已收盘'; }
    else { s = '未开盘'; }
  }
  document.getElementById('marketStatus').textContent = s;
  var msm = document.getElementById('marketStatusM'); if (msm) msm.textContent = s;

  // 自动切换主题：交易时段 → 白底，非交易时段 → 黑底
  var theme = isTrading ? 'light' : 'dark';
  if (document.documentElement.getAttribute('data-theme') !== theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

// ============================================================
// 9. Init
// ============================================================
var appInited = false;

// 判断当前是否交易时段
function isTradingTime() {
  var n = new Date();
  var d = n.getDay(), hm = n.getHours() * 100 + n.getMinutes();
  if (d < 1 || d > 5) return false;
  // 9:15 ~ 15:00
  return hm >= 915 && hm < 1500;
}

// 动态刷新调度：交易时段5秒，非交易60秒
var refreshTimer = null;
var minuteTimer = null;

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  var interval = isTradingTime() ? 5000 : 60000;
  refreshTimer = setTimeout(async function() {
    await refreshAll();
    scheduleRefresh(); // 递归调度，每次重新判断时段
  }, interval);
}

function scheduleMinuteData() {
  if (minuteTimer) clearTimeout(minuteTimer);
  var interval = isTradingTime() ? 30000 : 120000; // 交易30秒，非交易2分钟
  minuteTimer = setTimeout(async function() {
    await loadAllMinuteData();
    scheduleMinuteData();
  }, interval);
}

async function initApp() {
  if (appInited) return; appInited = true;
  try { stocks = await api('GET', '/api/stocks') || [] } catch (e) { stocks = [] }
  updateClock(); setInterval(updateClock, 1000);
  renderStocks();
  if (stocks.length) await refreshAll();
  await loadAllMinuteData();
  scheduleRefresh();
  scheduleMinuteData();
}

// ============================================================
// 10. Invite Code Management
// ============================================================
async function renderInvites() {
  try {
    var invites = await api('GET', '/api/invites');
    var tbody = document.getElementById('inviteList');
    if (!invites.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px">暂无邀请码，点击"生成邀请码"创建</td></tr>';
      return;
    }
    tbody.innerHTML = invites.map(function(inv) {
      var status = inv.used ? '<span style="color:var(--text-muted)">已使用</span>' : '<span style="color:var(--green);font-weight:600">可用</span>';
      var usedBy = inv.used_by || '--';
      var time = new Date(inv.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      return '<tr>' +
        '<td><code style="background:var(--bg-card);padding:3px 8px;border-radius:4px;font-size:14px;letter-spacing:2px;font-weight:700;color:var(--gold);cursor:pointer" onclick="copyInvite(\'' + inv.code + '\')" title="点击复制">' + inv.code + '</code></td>' +
        '<td>' + status + '</td>' +
        '<td>' + usedBy + '</td>' +
        '<td style="font-size:12px;color:var(--text-muted)">' + time + '</td>' +
        '<td><button class="delete-btn" onclick="deleteInvite(' + inv.id + ')" title="删除" style="display:inline-flex">✕</button></td>' +
      '</tr>';
    }).join('');
  } catch (e) { console.error(e) }
}

async function generateInvite() {
  try {
    var inv = await api('POST', '/api/invites');
    await renderInvites();
    // 自动复制到剪贴板
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(inv.code);
      alert('邀请码已生成并复制到剪贴板：' + inv.code);
    } else {
      alert('邀请码已生成：' + inv.code + '\n请手动复制发给好友');
    }
  } catch (e) { alert(e.message) }
}

async function deleteInvite(id) {
  if (!confirm('确定删除该邀请码？')) return;
  try { await api('DELETE', '/api/invites/' + id); renderInvites() } catch (e) { alert(e.message) }
}

function copyInvite(code) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(code).then(function() { alert('邀请码已复制：' + code) });
  } else {
    prompt('请手动复制邀请码：', code);
  }
}

// Boot
(async function() {
  if (!authToken) return;
  try { currentUser = await api('GET', '/api/me'); enterApp() } catch (e) { authToken = ''; localStorage.removeItem('liuge_token') }
})();

// ============================================================
// 六哥指数 — 后端服务
// Node.js + Express + sql.js (纯JS SQLite)
// ============================================================
const express = require('express');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const iconv = require('iconv-lite');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'liuge_secret_key_2026';
// Railway Volume 挂载到 /data，本地开发用 ./data
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'liuge.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

let db;

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function get(sql, params = []) { return all(sql, params)[0] || null; }
function run(sql, params = []) {
  db.run(sql, params);
  return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] || 0, changes: db.getRowsModified() };
}
function saveDb() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (e) { console.error('Save DB error:', e.message); }
}

// 业务代码的写操作都已经同步 saveDb()，此处不再定时重复写盘
// 优雅退出时保存
process.on('SIGTERM', () => { saveDb(); process.exit(0); });
process.on('SIGINT', () => { saveDb(); process.exit(0); });

// ============================================================
// Auth Middleware
// ============================================================
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: '请先登录' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // 只查必要字段，避免每次请求都把 avatar(base64 可能很大) / password_hash 查出来
    const user = get('SELECT id, username, display_name, is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!user) return res.status(401).json({ error: '用户不存在' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}
function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: '需要管理员权限' });
    next();
  });
}

// ============================================================
// Auth API — 邀请制注册
// ============================================================
app.post('/api/register', (req, res) => {
  const { username, password, invite_code } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.length < 2) return res.status(400).json({ error: '用户名至少2个字符' });
  if (!/^[A-Za-z0-9!@#$%^&*_\-]{8,16}$/.test(password)) return res.status(400).json({ error: '密码格式不正确' });

  const userCount = get('SELECT COUNT(*) as c FROM users').c;

  // 第一个用户（管理员）不需要邀请码
  if (userCount > 0) {
    if (!invite_code) return res.status(400).json({ error: '需要邀请码才能注册' });
    const inv = get('SELECT * FROM invite_codes WHERE code = ? AND used = 0', [invite_code]);
    if (!inv) return res.status(400).json({ error: '邀请码无效或已被使用' });
    // 标记邀请码已使用
    run('UPDATE invite_codes SET used = 1, used_by = ?, used_at = ? WHERE id = ?', [username, Date.now(), inv.id]);
  }

  const existing = get('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: '用户名已存在' });

  const hash = bcrypt.hashSync(password, 10);
  const isAdmin = userCount === 0 ? 1 : 0;
  const now = Date.now();
  const result = run('INSERT INTO users (username, display_name, password_hash, is_admin, created_at, last_login) VALUES (?,?,?,?,?,?)', [username, username, hash, isAdmin, now, now]);
  saveDb();
  const token = jwt.sign({ id: result.lastInsertRowid }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: result.lastInsertRowid, username, display_name: username, is_admin: isAdmin, avatar: null } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const user = get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: '用户名或密码错误' });
  run('UPDATE users SET last_login = ? WHERE id = ?', [Date.now(), user.id]);
  saveDb();
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, is_admin: user.is_admin, avatar: user.avatar } });
});

app.get('/api/me', auth, (req, res) => {
  // 只有 /api/me 需要 avatar，额外查一次；顺便刷新 last_login
  const full = get('SELECT id, username, display_name, is_admin, avatar FROM users WHERE id = ?', [req.user.id]);
  run('UPDATE users SET last_login = ? WHERE id = ?', [Date.now(), req.user.id]);
  saveDb();
  res.json(full);
});

// ============================================================
// Invite Code API — 管理员生成/查看邀请码
// ============================================================
app.get('/api/invites', adminAuth, (req, res) => {
  res.json(all('SELECT * FROM invite_codes ORDER BY created_at DESC'));
});

app.post('/api/invites', adminAuth, (req, res) => {
  const code = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8位随机码
  const now = Date.now();
  const result = run('INSERT INTO invite_codes (code, created_by, created_at, used) VALUES (?,?,?,0)', [code, req.user.id, now]);
  saveDb();
  res.json({ id: result.lastInsertRowid, code, created_at: now, used: 0 });
});

app.delete('/api/invites/:id', adminAuth, (req, res) => {
  run('DELETE FROM invite_codes WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

// ============================================================
// User Management API
// ============================================================
app.get('/api/users', auth, (req, res) => {
  if (req.user.is_admin) {
    res.json(all('SELECT id, username, display_name, is_admin, avatar, created_at, last_login FROM users ORDER BY created_at'));
  } else {
    res.json(all('SELECT id, username, display_name, is_admin, avatar, created_at, last_login FROM users WHERE id = ?', [req.user.id]));
  }
});

app.put('/api/users/:id/admin', adminAuth, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: '不能修改自己' });
  run('UPDATE users SET is_admin = ? WHERE id = ?', [req.body.is_admin ? 1 : 0, id]);
  saveDb();
  res.json({ success: true });
});

app.delete('/api/users/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  run('DELETE FROM users WHERE id = ?', [id]);
  saveDb();
  res.json({ success: true });
});

app.put('/api/users/:id/avatar', auth, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) !== req.user.id) return res.status(403).json({ error: '只能修改自己的头像' });
  run('UPDATE users SET avatar = ? WHERE id = ?', [req.body.avatar || null, id]);
  saveDb();
  res.json({ success: true });
});

app.put('/api/users/:id/name', auth, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) !== req.user.id) return res.status(403).json({ error: '只能修改自己的用户名' });
  const { display_name } = req.body;
  if (!display_name || !display_name.trim()) return res.status(400).json({ error: '显示名不能为空' });
  let byteLen = 0;
  for (let i = 0; i < display_name.length; i++) byteLen += display_name.charCodeAt(i) > 127 ? 3 : 1;
  if (byteLen > 32) return res.status(400).json({ error: '显示名超出32字节限制' });
  run('UPDATE users SET display_name = ? WHERE id = ?', [display_name.trim(), id]);
  saveDb();
  res.json({ success: true });
});

// ============================================================
// Stock API — 仅管理员可增删改排序
// ============================================================
app.get('/api/stocks', auth, (req, res) => {
  const stocks = all('SELECT * FROM stocks ORDER BY sort_order, id');
  if (!stocks.length) return res.json([]);
  // 一次性查出所有评论，按 stock_id 分组，避免 N+1
  const ids = stocks.map(s => s.id);
  const placeholders = ids.map(() => '?').join(',');
  const comments = all(`SELECT * FROM comments WHERE stock_id IN (${placeholders}) ORDER BY created_at DESC`, ids);
  const byStock = {};
  comments.forEach(c => { (byStock[c.stock_id] = byStock[c.stock_id] || []).push(c); });
  stocks.forEach(s => { s.comments = byStock[s.id] || []; });
  res.json(stocks);
});

// 排序 — 仅管理员（必须在 :id 路由前面，否则 'reorder' 会被当作 :id）
app.put('/api/stocks/reorder', adminAuth, (req, res) => {
  const { orders } = req.body;
  if (!orders || !Array.isArray(orders)) return res.status(400).json({ error: '参数错误' });
  orders.forEach(o => run('UPDATE stocks SET sort_order = ? WHERE id = ?', [o.sort_order, o.id]));
  saveDb();
  res.json({ success: true });
});

app.post('/api/stocks', adminAuth, (req, res) => {
  const { code } = req.body;
  if (!code || !/^\d{6}$/.test(code)) return res.status(400).json({ error: '请输入6位股票代码' });
  const existing = get('SELECT id FROM stocks WHERE code = ?', [code]);
  if (existing) return res.status(409).json({ error: '该股票已在列表中' });
  const maxOrder = get('SELECT MAX(sort_order) as m FROM stocks').m || 0;
  const result = run('INSERT INTO stocks (code, sort_order, created_by, created_at) VALUES (?,?,?,?)', [code, maxOrder + 1, req.user.id, Date.now()]);
  saveDb();
  res.json({ id: result.lastInsertRowid, code, sort_order: maxOrder + 1 });
});

app.put('/api/stocks/:id', adminAuth, (req, res) => {
  const { id } = req.params;
  const { cost_price, target_price, source, reached } = req.body;
  const updates = [], params = [];
  if (cost_price !== undefined) { updates.push('cost_price = ?'); params.push(cost_price); }
  if (target_price !== undefined) { updates.push('target_price = ?'); params.push(target_price); }
  if (source !== undefined) { updates.push('source = ?'); params.push(source); }
  if (reached !== undefined) { updates.push('reached = ?'); params.push(reached ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: '没有需要更新的字段' });
  params.push(id);
  run(`UPDATE stocks SET ${updates.join(', ')} WHERE id = ?`, params);
  saveDb();
  res.json({ success: true });
});

app.delete('/api/stocks/:id', adminAuth, (req, res) => {
  run('DELETE FROM stocks WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

// ============================================================
// Comments API
// ============================================================
app.get('/api/stocks/:stockId/comments', auth, (req, res) => {
  const rows = all('SELECT * FROM comments WHERE stock_id = ? ORDER BY created_at DESC', [req.params.stockId]);
  res.json(rows);
});

app.post('/api/stocks/:stockId/comments', auth, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '评论不能为空' });
  const user = req.user;
  run('INSERT INTO comments (stock_id, user_id, username, display_name, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.stockId, user.id, user.username, user.display_name || user.username, content.trim(), Date.now()]);
  saveDb();
  const newComment = get('SELECT * FROM comments WHERE stock_id = ? ORDER BY id DESC LIMIT 1', [req.params.stockId]);
  res.json(newComment);
});

app.delete('/api/comments/:id', auth, (req, res) => {
  const comment = get('SELECT * FROM comments WHERE id = ?', [req.params.id]);
  if (!comment) return res.status(404).json({ error: '评论不存在' });
  // 只有评论作者或管理员可以删
  if (comment.user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: '无权删除' });
  run('DELETE FROM comments WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

// ============================================================
// WxPusher 推送
// ============================================================
const WXPUSHER_TOKEN = process.env.WXPUSHER_TOKEN || 'AT_hQs2ignARGaNeKsqBySy32LwpFOboJjm';
const WXPUSHER_TOPIC_ID = parseInt(process.env.WXPUSHER_TOPIC_ID || '0'); // 在WxPusher后台创建Topic后填入
const https = require('https');

function wxpusherSend(content, summary, topicIds, uids) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      appToken: WXPUSHER_TOKEN,
      content: content,
      summary: summary || content.substring(0, 50),
      contentType: 2, // HTML
      topicIds: topicIds || [],
      uids: uids || []
    });
    console.log('[WxPusher] 发送请求, topicIds=' + JSON.stringify(topicIds) + ', summary=' + summary);
    const req = https.request({
      hostname: 'wxpusher.zjiecode.com', path: '/api/send/message',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { console.log('[WxPusher] 响应:', data); try { resolve(JSON.parse(data)) } catch(e) { resolve({ success: false, raw: data }) } });
    });
    req.on('error', (e) => { console.log('[WxPusher] 请求错误:', e.message); resolve({ success: false, error: e.message }) });
    req.write(body);
    req.end();
  });
}

// 每日提醒记录 { "code_buy": "2026-04-14", "code_sell": "2026-04-14", "morning_watch": "2026-04-14" }
const alertSentToday = {};

// 获取北京时间（无论服务器时区如何都正确）
function bjNow() {
  const nowUtcMs = Date.now();
  return new Date(nowUtcMs + 8 * 3600 * 1000);
}

function getTodayStr() {
  const n = bjNow(); return n.getUTCFullYear() + '-' + String(n.getUTCMonth()+1).padStart(2,'0') + '-' + String(n.getUTCDate()).padStart(2,'0');
}

function isTradingTime() {
  const n = bjNow(), d = n.getUTCDay(), hm = n.getUTCHours() * 100 + n.getUTCMinutes();
  return d >= 1 && d <= 5 && hm >= 915 && hm < 1500;
}

// 是否为交易日（仅按周一~周五，不处理法定节假日）
function isTradingDay() {
  const d = bjNow().getUTCDay();
  return d >= 1 && d <= 5;
}

// 从腾讯行情接口获取股票名称
function fetchStockName(code) {
  return new Promise((resolve) => {
    const prefix = (code.startsWith('6') || code.startsWith('9')) ? 'sh' : 'sz';
    const symbol = prefix + code;
    const req = https.request({
      hostname: 'qt.gtimg.cn', path: '/q=' + symbol, method: 'GET'
    }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = iconv.decode(Buffer.concat(chunks), 'gbk');
        const match = data.match(/="([^"]+)"/);
        if (match) {
          const parts = match[1].split('~');
          if (parts.length >= 45 && parts[1]) return resolve(parts[1]);
        }
        resolve(code);
      });
    });
    req.on('error', () => resolve(code));
    req.setTimeout(5000, () => { req.destroy(); resolve(code) });
    req.end();
  });
}

// 早盘关注股票推送：交易日 9:25~9:30 推送一次（开盘前几分钟，窗口加宽防漂移）
async function checkMorningWatch() {
  if (!db) return;
  if (!isTradingDay()) return;
  const n = bjNow(), hm = n.getUTCHours() * 100 + n.getUTCMinutes();
  if (hm < 925 || hm >= 930) return;

  const today = getTodayStr();
  if (alertSentToday['morning_watch'] === today) return;
  console.log('[MorningWatch] 开始检查今日关注股票...');

  // 每次都实时查 DB，确保 reached 最新状态
  const watched = all('SELECT code FROM stocks WHERE reached = 1 ORDER BY sort_order, id');
  if (!watched || !watched.length) {
    console.log('[MorningWatch] 无关注股票，跳过推送');
    alertSentToday['morning_watch'] = today; // 今日标记已检查，避免反复查DB
    return;
  }

  const topicIds = WXPUSHER_TOPIC_ID ? [WXPUSHER_TOPIC_ID] : [];
  if (!topicIds.length) { console.log('[MorningWatch] 未配置 TOPIC_ID'); return; }

  // 并行获取股票名称
  const names = await Promise.all(watched.map(s => fetchStockName(s.code)));
  const nameStr = names.join('、');
  const text = `早晨，六哥指数今日关注：${nameStr}，准备起飞！`;

  const html = `<h3>🌅 今日关注</h3><p style="font-size:15px;line-height:1.6">${text}</p>`;
  const summary = text.length > 50 ? text.substring(0, 47) + '...' : text;

  const result = await wxpusherSend(html, summary, topicIds);
  console.log('[MorningWatch] 推送结果:', JSON.stringify(result));
  alertSentToday['morning_watch'] = today;
  console.log('  🌅 早盘关注提醒:', text);
}

// 批量获取多只股票行情（单次 HTTP 请求搞定）
// 返回：{ '600036': { name, price }, '000001': {...} }
function fetchQuotesBatch(codes) {
  return new Promise((resolve) => {
    if (!codes.length) return resolve({});
    const symbols = codes.map(c => ((c.startsWith('6') || c.startsWith('9')) ? 'sh' : 'sz') + c).join(',');
    const req = https.request({
      hostname: 'qt.gtimg.cn', path: '/q=' + symbols, method: 'GET'
    }, (res) => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = iconv.decode(Buffer.concat(chunks), 'gbk');
        const result = {};
        // 腾讯接口返回格式: v_sh600036="1~招商银行~600036~...~"; v_sz000001="..."
        const regex = /v_(?:sh|sz)(\d{6})="([^"]+)"/g;
        let m;
        while ((m = regex.exec(data)) !== null) {
          const parts = m[2].split('~');
          if (parts.length >= 45) {
            result[m[1]] = { name: parts[1] || m[1], price: parseFloat(parts[3]) || 0 };
          }
        }
        resolve(result);
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(8000, () => { req.destroy(); resolve({}) });
    req.end();
  });
}

async function checkPriceAlerts() {
  if (!db || !isTradingTime()) return;
  const today = getTodayStr();
  // 只扫描"已关注"（reached=1）且 有成本/目标价 的股票
  const stocks = all('SELECT * FROM stocks WHERE reached = 1');
  if (!stocks || !stocks.length) return;

  const meaningful = stocks.filter(s => {
    const c = parseFloat(s.cost_price), t = parseFloat(s.target_price);
    return (!isNaN(c) && c > 0) || (!isNaN(t) && t > 0);
  });
  if (!meaningful.length) return;

  // 一次批量请求拿到所有行情
  const quotes = await fetchQuotesBatch(meaningful.map(s => s.code));

  for (const s of meaningful) {
    const q = quotes[s.code];
    if (!q || !q.price || q.price <= 0) continue;
    const costPrice = parseFloat(s.cost_price);
    const targetPrice = parseFloat(s.target_price);
    const price = q.price, name = q.name;

    // 买入提醒（当前价 ≤ 成本价）
    if (!isNaN(costPrice) && costPrice > 0 && price <= costPrice) {
      const key = s.code + '_buy';
      if (alertSentToday[key] !== today) {
        const topicIds = WXPUSHER_TOPIC_ID ? [WXPUSHER_TOPIC_ID] : [];
        if (topicIds.length) {
          const html = `<h3>📗 买入提醒</h3><p><b>${name}</b>（${s.code}）</p><p>当前价：<b style="color:#22c55e">¥${price.toFixed(2)}</b></p><p>成本价：¥${costPrice.toFixed(2)}</p><p style="color:#888;font-size:12px">价格已触碰成本价，可考虑买入</p>`;
          const summary = '📗 ' + name + ' ¥' + price.toFixed(2) + ' 触碰成本价';
          await wxpusherSend(html, summary, topicIds);
          alertSentToday[key] = today;
          console.log('  📗 买入提醒:', name, price, '≤', costPrice);
        }
      }
    }

    // 卖出提醒（当前价 ≥ 目标价）
    if (!isNaN(targetPrice) && targetPrice > 0 && price >= targetPrice) {
      const key = s.code + '_sell';
      if (alertSentToday[key] !== today) {
        const topicIds = WXPUSHER_TOPIC_ID ? [WXPUSHER_TOPIC_ID] : [];
        if (topicIds.length) {
          const html = `<h3>📕 卖出提醒</h3><p><b>${name}</b>（${s.code}）</p><p>当前价：<b style="color:#ef4444">¥${price.toFixed(2)}</b></p><p>目标价：¥${targetPrice.toFixed(2)}</p><p style="color:#888;font-size:12px">价格已触碰目标价，可考虑卖出</p>`;
          const summary = '📕 ' + name + ' ¥' + price.toFixed(2) + ' 触碰目标价';
          await wxpusherSend(html, summary, topicIds);
          alertSentToday[key] = today;
          console.log('  📕 卖出提醒:', name, price, '≥', targetPrice);
        }
      }
    }
  }
}

// WxPusher 用户绑定相关 API
app.get('/api/wxpusher/qrcode', auth, (req, res) => {
  // 生成带参数的关注二维码
  const extra = 'user_' + req.user.id;
  const url = `https://wxpusher.zjiecode.com/api/fun/create/qrcode?appToken=${WXPUSHER_TOKEN}&extra=${extra}&validTime=3600`;
  https.get(url, (resp) => {
    let data = '';
    resp.on('data', c => data += c);
    resp.on('end', () => {
      try { res.json(JSON.parse(data)) } catch(e) { res.status(500).json({ error: '生成二维码失败' }) }
    });
  }).on('error', () => res.status(500).json({ error: '网络错误' }));
});

// WxPusher 回调：用户扫码关注后，WxPusher 会回调这个地址
app.post('/api/wxpusher/callback', (req, res) => {
  try {
    const { action, data } = req.body;
    if (action === 'app_subscribe' && data && data.uid && data.extra) {
      // extra 格式: user_123
      const userId = parseInt(data.extra.replace('user_', ''));
      if (userId && db) {
        run('UPDATE users SET wxpusher_uid = ? WHERE id = ?', [data.uid, userId]);
        saveDb();
        console.log('  🔗 WxPusher 绑定: user', userId, '→', data.uid);
      }
    }
  } catch(e) {}
  res.json({ success: true });
});

// 获取当前用户的 WxPusher 绑定状态
app.get('/api/wxpusher/status', auth, (req, res) => {
  const user = get('SELECT wxpusher_uid FROM users WHERE id = ?', [req.user.id]);
  res.json({ bound: !!(user && user.wxpusher_uid), uid: user ? user.wxpusher_uid : null });
});

// 解绑 WxPusher
app.delete('/api/wxpusher/bindling', auth, (req, res) => {
  run('UPDATE users SET wxpusher_uid = NULL WHERE id = ?', [req.user.id]);
  saveDb();
  res.json({ success: true });
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

// ============================================================
// Start
// ============================================================
async function start() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('  📂 已加载数据库: ' + DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('  📂 新建数据库: ' + DB_PATH);
  }
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL, avatar TEXT DEFAULT NULL, is_admin INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL, last_login INTEGER, wxpusher_uid TEXT DEFAULT NULL
  )`);
  // 兼容旧表：添加 wxpusher_uid 列
  try { db.run('ALTER TABLE users ADD COLUMN wxpusher_uid TEXT DEFAULT NULL') } catch(e) {};
  db.run(`CREATE TABLE IF NOT EXISTS stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
    cost_price TEXT DEFAULT '', target_price TEXT DEFAULT '', source TEXT DEFAULT '',
    reached INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
    created_by INTEGER, created_at INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS invite_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL,
    created_by INTEGER, created_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0, used_by TEXT, used_at INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, stock_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL, username TEXT NOT NULL, display_name TEXT,
    content TEXT NOT NULL, created_at INTEGER NOT NULL,
    FOREIGN KEY(stock_id) REFERENCES stocks(id) ON DELETE CASCADE
  )`);
  saveDb();
  app.listen(PORT, () => {
    console.log('\n  🍊 六哥指数 服务已启动');
    console.log('  🚀 地址: http://localhost:' + PORT);
    console.log('  📁 数据库: ' + DB_PATH);
    console.log('  📡 WxPusher Topic ID: ' + (WXPUSHER_TOPIC_ID || '未配置'));
    console.log('  🕐 服务器时间: ' + new Date().toString());
    console.log('  🇨🇳 北京时间: ' + bjNow().toISOString().replace('T', ' ').replace('Z', '') + '\n');
  });
  // ============================================================
  // 自适应调度器 — 休市/周末完全不唤醒
  // 状态机：
  //   A) 早盘窗口 9:29~9:30       → 每 15s 跑一次 checkMorningWatch
  //   B) 交易时段 9:15~15:00 (工作日) → 每 5s 跑一次 checkPriceAlerts
  //   C) 其他时间                  → 计算到下一个唤醒点的毫秒数，setTimeout 一次性 sleep 过去
  //                                   (跨天跨周末都直接 sleep 过去，不再轮询)
  // ============================================================
  scheduleNextTick();
}

// 下一次唤醒时间点（北京时间）
// 返回距离下一个需要工作的时间点的毫秒数
function msUntilNextActiveWindow() {
  const n = bjNow();
  const day = n.getUTCDay();          // 0=周日 1=周一 ... 6=周六
  const h = n.getUTCHours();
  const m = n.getUTCMinutes();
  const hm = h * 100 + m;

  // 今天是工作日
  if (day >= 1 && day <= 5) {
    // 9:25 之前 → 睡到 9:25（留 5 分钟窗口防 setTimeout 漂移）
    if (hm < 925) return msUntilTime(9, 25);
    // 9:25~9:30 → 早盘窗口，立刻跑
    if (hm < 930) return 0;
    // 9:30~9:15 之间这段不存在（9:30 > 9:15），直接看交易时段
    // 9:15 之前 已在上面处理；9:15~15:00 也立刻跑
    if (hm >= 915 && hm < 1500) return 0;
    // 15:00 之后 → 睡到明天 9:29（若明天是周末则继续顺延）
    return msUntilNextWorkdayAt(9, 25);
  }
  // 周末 → 睡到下周一 9:29
  return msUntilNextWorkdayAt(9, 25);
}

// 距离今天某个时刻还有多少毫秒（北京时间）
function msUntilTime(targetH, targetM) {
  const n = bjNow();
  const nowMsBj = n.getTime();
  const todayStart = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), targetH, targetM, 0);
  const diff = todayStart - nowMsBj;
  return diff > 0 ? diff : 0;
}

// 距离下一个工作日某个时刻还有多少毫秒（跳过周末）
function msUntilNextWorkdayAt(targetH, targetM) {
  const n = bjNow();
  // 从明天开始找
  for (let i = 1; i <= 7; i++) {
    const future = new Date(n.getTime() + i * 86400000);
    const fDay = future.getUTCDay();
    if (fDay >= 1 && fDay <= 5) {
      const target = Date.UTC(future.getUTCFullYear(), future.getUTCMonth(), future.getUTCDate(), targetH, targetM, 0);
      return target - n.getTime();
    }
  }
  return 86400000; // 兜底 1 天
}

async function scheduleNextTick() {
  try {
    const n = bjNow();
    const day = n.getUTCDay();
    const hm = n.getUTCHours() * 100 + n.getUTCMinutes();
    const inMorningWindow = day >= 1 && day <= 5 && hm >= 925 && hm < 930;
    const inTradingWindow = day >= 1 && day <= 5 && hm >= 915 && hm < 1500;

    if (inMorningWindow) {
      await checkMorningWatch();
      setTimeout(scheduleNextTick, 15000); // 窗口内 15s 一次
      return;
    }
    if (inTradingWindow) {
      await checkPriceAlerts();
      setTimeout(scheduleNextTick, 5000);  // 交易中 5s 一次
      return;
    }

    // 非交易时段 — 直接睡到下一个窗口
    const sleep = msUntilNextActiveWindow();
    const wakeAt = new Date(n.getTime() + sleep);
    console.log('[Scheduler] 休眠至 ' + wakeAt.toISOString().replace('T', ' ').replace('Z', '') + ' (北京时间)，共 ' + Math.round(sleep / 1000 / 60) + ' 分钟');
    // setTimeout 上限约 24.8 天，这里最长 72h 以内，没问题
    setTimeout(scheduleNextTick, Math.max(sleep, 1000));
  } catch (e) {
    console.error('[Scheduler] 错误:', e.message);
    setTimeout(scheduleNextTick, 60000); // 异常时 1 分钟后重试
  }
}

start().catch(e => { console.error('启动失败:', e); process.exit(1); });

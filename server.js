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

setInterval(saveDb, 10000);
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
    const user = get('SELECT * FROM users WHERE id = ?', [decoded.id]);
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
  const u = req.user;
  res.json({ id: u.id, username: u.username, display_name: u.display_name, is_admin: u.is_admin, avatar: u.avatar });
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
  run('UPDATE users SET last_login = ? WHERE id = ?', [Date.now(), req.user.id]);
  const stocks = all('SELECT * FROM stocks ORDER BY sort_order, id');
  stocks.forEach(s => {
    s.comments = all('SELECT * FROM comments WHERE stock_id = ? ORDER BY created_at DESC', [s.id]);
  });
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
    created_at INTEGER NOT NULL, last_login INTEGER
  )`);
  // UID 从 8000 开始
  const maxId = db.exec('SELECT MAX(id) FROM users');
  const currentMax = (maxId.length && maxId[0].values[0][0]) || 0;
  if (currentMax < 7999) {
    db.run("INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('users', 7999)");
  };
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
    console.log('  📁 数据库: ' + DB_PATH + '\n');
  });
}

start().catch(e => { console.error('启动失败:', e); process.exit(1); });

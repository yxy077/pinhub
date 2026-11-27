'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { starterData, failure, stringField, accountName, passwordValue, publicUser, publicOrder, orderFromBody } = require('./domain.cjs');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const dbPath = path.join(dataDir, 'db.json');
const keyPath = path.join(dataDir, 'session.key');
const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
const secureCookies = process.env.SECURE_COOKIES === '1';
const sessionSeconds = 7 * 24 * 60 * 60;
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
if (!process.env.SESSION_SECRET && !fs.existsSync(keyPath)) {
  fs.writeFileSync(keyPath, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
}
const sessionSecret = process.env.SESSION_SECRET || fs.readFileSync(keyPath, 'utf8').trim();
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET 至少需要 32 个字符');

function save(next) {
  const tempPath = dbPath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tempPath, dbPath);
}

let db;
if (fs.existsSync(dbPath)) {
  db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
} else {
  db = starterData();
  save(db);
}

function change(update) {
  const next = structuredClone(db);
  const result = update(next);
  save(next);
  db = next;
  return result;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if ((req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
    throw failure(415, '请使用 JSON 发送请求。');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > 8192) {
      req.resume();
      throw failure(413, '提交内容过长。');
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw failure(400, '提交内容格式有误。');
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function signature(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('hex');
}

function sessionCookie(value, maxAge) {
  return 'dorm_session=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge +
    (secureCookies ? '; Secure' : '');
}

function addSession(next, userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  next.sessions = next.sessions.filter(item => item.expiresAt > now);
  next.sessions.push({ id, userId, expiresAt: now + sessionSeconds * 1000 });
  return sessionCookie(id + '.' + signature(id), sessionSeconds);
}

function getSession(req) {
  const match = /(?:^|;\s*)dorm_session=([a-f0-9]{64})\.([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
  if (!match || !crypto.timingSafeEqual(Buffer.from(match[2]), Buffer.from(signature(match[1])))) return null;
  return db.sessions.find(item => item.id === match[1] && item.expiresAt > Date.now()) || null;
}

const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/food.jpg': ['food.jpg', 'image/jpeg']
};

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const method = req.method;
    const file = Object.hasOwn(staticFiles, pathname) && staticFiles[pathname];
    if (file && (method === 'GET' || method === 'HEAD')) {
      const content = fs.readFileSync(path.join(__dirname, 'public', file[0]));
      res.writeHead(200, { 'Content-Type': file[1], 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
      return res.end(method === 'HEAD' ? undefined : content);
    }
    if (method === 'GET' && pathname === '/api/orders') {
      return send(res, 200, { orders: db.orders.map(publicOrder), now: Date.now() });
    }
    const session = getSession(req);
    const user = session && db.users.find(item => item.id === session.userId);
    if (method === 'GET' && pathname === '/api/me') {
      return send(res, 200, { user: user ? publicUser(user) : null });
    }
    if (method !== 'POST') throw failure(404, '页面不存在。');

    const body = await readBody(req);
    if (pathname === '/api/register') {
      const username = accountName(body.username);
      const password = passwordValue(body.password);
      const nickname = stringField(body.nickname, 1, 16, '昵称需为 1–16 个字符。');
      if (db.users.some(item => item.username === username)) throw failure(409, '这个账号已经被使用。');
      const salt = crypto.randomBytes(16).toString('hex');
      const newUser = {
        id: crypto.randomUUID(), username, nickname, salt, hash: hashPassword(password, salt)
      };
      const cookie = change(next => {
        next.users.push(newUser);
        return addSession(next, newUser.id);
      });
      return send(res, 201, { user: publicUser(newUser) }, { 'Set-Cookie': cookie });
    }
    if (pathname === '/api/login') {
      const username = accountName(body.username);
      const password = passwordValue(body.password);
      const account = db.users.find(item => item.username === username);
      const hash = hashPassword(password, account ? account.salt : 'missing-account');
      if (!account || !crypto.timingSafeEqual(Buffer.from(account.hash), Buffer.from(hash))) {
        throw failure(401, '账号或密码不正确。');
      }
      const cookie = change(next => addSession(next, account.id));
      return send(res, 200, { user: publicUser(account) }, { 'Set-Cookie': cookie });
    }
    if (pathname === '/api/logout') {
      if (session) change(next => { next.sessions = next.sessions.filter(item => item.id !== session.id); });
      return send(res, 200, {}, { 'Set-Cookie': sessionCookie('', 0) });
    }
    if (!['/api/orders', '/api/orders/join', '/api/orders/cancel'].includes(pathname)) {
      throw failure(404, '接口不存在。');
    }
    if (!user || !db.sessions.some(item => item.id === session.id && item.expiresAt > Date.now())) {
      throw failure(401, '请先登录。');
    }
    if (pathname === '/api/orders') {
      const order = orderFromBody(body, user, crypto.randomUUID());
      change(next => next.orders.unshift(order));
      return send(res, 201, { order: publicOrder(order) });
    }
    const order = change(next => {
      const item = next.orders.find(entry => entry.id === body.id);
      if (!item) throw failure(404, '找不到这条拼单。');
      if (item.deadline <= Date.now()) throw failure(409, '拼单已经截止。');
      const index = item.members.findIndex(member => member.id === user.id);
      if (pathname === '/api/orders/join') {
        if (index !== -1) throw failure(409, '你已报名此拼单。');
        if (item.members.length >= item.target) throw failure(409, '这条拼单已经满员。');
        item.members.push({ id: user.id, nickname: user.nickname });
      } else {
        if (item.ownerId === user.id) throw failure(409, '发起人自动计入，无法退出自己的拼单。');
        if (index === -1) throw failure(409, '你还没有报名此拼单。');
        item.members.splice(index, 1);
      }
      return item;
    });
    return send(res, 200, { order: publicOrder(order) });
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : '服务器暂时无法处理请求。' });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  console.log('宿舍拼单局已启动 http://' + (host === '0.0.0.0' ? '127.0.0.1' : host) + ':' + address.port);
});

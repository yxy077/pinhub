const { starterData, failure, stringField, accountName, passwordValue, publicUser, publicOrder, orderFromBody } = domain;
const encoder = new TextEncoder();
const sessionSeconds = 7 * 24 * 60 * 60;
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
};

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

async function readBody(request) {
  if ((request.headers.get('Content-Type') || '').split(';')[0].trim() !== 'application/json') {
    throw failure(415, '请使用 JSON 发送请求。');
  }
  if (!request.body) throw failure(400, '提交内容格式有误。');
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 8192) {
      await reader.cancel();
      throw failure(413, '提交内容过长。');
    }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw failure(400, '提交内容格式有误。');
  }
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(length) {
  return hex(crypto.getRandomValues(new Uint8Array(length)));
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: encoder.encode(salt)
  }, key, 256));
}

function compareHashes(left, right) {
  let difference = left.length ^ right.length;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

async function hashToken(token) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
}

function cookie(value, maxAge) {
  return 'pinhub_session=' + value + '; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=' + maxAge;
}

async function getSession(request, db) {
  const match = /(?:^|;\s*)pinhub_session=([a-f0-9]{64})(?:;|$)/.exec(request.headers.get('Cookie') || '');
  if (!match) return null;
  const tokenHash = await hashToken(match[1]);
  return db.prepare(`SELECT users.id, users.nickname, sessions.token_hash FROM sessions
    JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ?`)
    .bind(tokenHash, Date.now()).first();
}

async function register(db, body) {
  const username = accountName(body.username);
  const password = passwordValue(body.password);
  const nickname = stringField(body.nickname, 1, 16, '昵称需为 1–16 个字符。');
  const user = { id: crypto.randomUUID(), nickname };
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);
  const token = randomHex(32);
  const now = Date.now();
  const tokenHash = await hashToken(token);
  const results = await db.batch([
    db.prepare('INSERT INTO users(id, username, nickname, salt, hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT(username) DO NOTHING')
      .bind(user.id, username, nickname, salt, hash),
    db.prepare(`INSERT INTO sessions(token_hash, user_id, expires_at)
      SELECT ?, id, ? FROM users WHERE id = ?`).bind(tokenHash, now + sessionSeconds * 1000, user.id)
  ]);
  if (results[0].meta.changes !== 1) throw failure(409, '这个账号已经被使用。');
  return json(201, { user: publicUser(user) }, { 'Set-Cookie': cookie(token, sessionSeconds) });
}

async function login(db, body) {
  const username = accountName(body.username);
  const password = passwordValue(body.password);
  const user = await db.prepare('SELECT id, nickname, salt, hash FROM users WHERE username = ?').bind(username).first();
  const hash = await hashPassword(password, user ? user.salt : 'missing-account');
  if (!user || !compareHashes(hash, user.hash)) throw failure(401, '账号或密码不正确。');
  const token = randomHex(32);
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(await hashToken(token), user.id, now + sessionSeconds * 1000)
  ]);
  return json(200, { user: publicUser(user) }, { 'Set-Cookie': cookie(token, sessionSeconds) });
}

function insertOrder(db, order) {
  return db.prepare('INSERT INTO orders(id, created_at, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING')
    .bind(order.id, order.createdAt, JSON.stringify(order));
}

async function listOrders(db) {
  const select = db.prepare('SELECT id, payload FROM orders ORDER BY created_at DESC, id');
  let { results: rows } = await select.all();
  if (!rows.some(row => row.id === 'sample-0')) {
    await db.batch(starterData().orders.map(order => insertOrder(db, order)));
    ({ results: rows } = await select.all());
  }
  return rows.map(row => publicOrder(JSON.parse(row.payload)));
}

async function changeMembership(db, id, user, join) {
  if (typeof id !== 'string') throw failure(404, '找不到这条拼单。');
  // A revision check prevents two simultaneous requests from claiming the last seat.
  for (let attempt = 0; attempt < 6; attempt++) {
    const row = await db.prepare('SELECT revision, payload FROM orders WHERE id = ?').bind(id).first();
    if (!row) throw failure(404, '找不到这条拼单。');
    const order = JSON.parse(row.payload);
    if (order.deadline <= Date.now()) throw failure(409, '拼单已经截止。');
    const index = order.members.findIndex(member => member.id === user.id);
    if (join) {
      if (index >= 0) throw failure(409, '你已报名此拼单。');
      if (order.members.length >= order.target) throw failure(409, '这条拼单已经满员。');
      order.members.push({ id: user.id, nickname: user.nickname });
    } else {
      if (order.ownerId === user.id) throw failure(409, '发起人自动计入，无法退出自己的拼单。');
      if (index < 0) throw failure(409, '你还没有报名此拼单。');
      order.members.splice(index, 1);
    }
    const result = await db.prepare(`UPDATE orders SET payload = ?, revision = revision + 1
      WHERE id = ? AND revision = ? AND ? > CAST(unixepoch('subsec') * 1000 AS INTEGER)`)
      .bind(JSON.stringify(order), id, row.revision, order.deadline).run();
    if (result.meta.changes === 1) return publicOrder(order);
  }
  throw failure(409, '拼单状态已变化，请刷新后再试。');
}

export default {
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);
      const method = request.method;
      if ((method === 'GET' || method === 'HEAD') && Object.hasOwn(assets, pathname)) {
        const [type, encoded] = assets[pathname];
        return new Response(method === 'HEAD' ? null : Uint8Array.from(atob(encoded), character => character.charCodeAt(0)), {
          headers: { ...securityHeaders, 'Content-Type': type, 'Cache-Control': 'no-cache' }
        });
      }
      const db = env.DB;
      if (method === 'GET' && pathname === '/api/orders') {
        return json(200, { orders: await listOrders(db), now: Date.now() });
      }
      if (method === 'GET' && pathname === '/api/me') {
        const user = await getSession(request, db);
        return json(200, { user: user ? publicUser(user) : null });
      }
      if (method !== 'POST') throw failure(404, '页面不存在。');
      if (request.headers.get('Sec-Fetch-Site') === 'cross-site') throw failure(403, '请在拼单页面内重试。');
      const body = await readBody(request);
      if (pathname === '/api/register') return await register(db, body);
      if (pathname === '/api/login') return await login(db, body);
      const user = await getSession(request, db);
      if (pathname === '/api/logout') {
        if (user) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.token_hash).run();
        return json(200, {}, { 'Set-Cookie': cookie('', 0) });
      }
      if (!['/api/orders', '/api/orders/join', '/api/orders/cancel'].includes(pathname)) {
        throw failure(404, '接口不存在。');
      }
      if (!user) throw failure(401, '请先登录。');
      if (pathname === '/api/orders') {
        const order = orderFromBody(body, user, crypto.randomUUID());
        await insertOrder(db, order).run();
        return json(201, { order: publicOrder(order) });
      }
      const order = await changeMembership(db, body.id, user, pathname === '/api/orders/join');
      return json(200, { order });
    } catch (error) {
      if (!error.status) console.error(error);
      return json(error.status || 500, { error: error.status ? error.message : '服务器暂时无法处理请求。' });
    }
  }
};

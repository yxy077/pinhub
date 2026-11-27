'use strict';

const categories = ['奶茶', '水果', '零食', '其他'];
const platforms = ['美团', '饿了么', '拼多多', '淘宝', '其他'];

function starterData() {
  const now = Date.now();
  /** @type {Array<[string, string, string, number, number, number, string, string, number]>} */
  const examples = [
    ['黑糖波波奶茶', '奶茶', '美团', 6800, 4, 2, '晚风同学', '下课后一起点，默认少冰。', 5],
    ['丹东草莓分享盒', '水果', '拼多多', 5600, 5, 3, '橘子汽水', '两斤装，到货后按份分。', 19],
    ['追剧零食组合', '零食', '淘宝', 4500, 5, 3, '小熊饼干', '薯片、脆饼和小麻花，适合晚上一起吃。', 28],
    ['周末三明治套餐', '其他', '饿了么', 7200, 4, 2, '海盐同学', '周末中午一起点。', 48]
  ];
  return {
    users: [],
    sessions: [],
    orders: examples.map(([title, category, platform, cents, target, count, nickname, note, hours], index) => {
      const members = [{ id: 'sample-' + index, nickname }];
      ['柠檬苏打', '星期五'].slice(0, count - 1).forEach((name, number) => {
        members.push({ id: 'sample-' + index + '-' + number, nickname: name });
      });
      return {
        id: 'sample-' + index, title, category, platform, cents, target, note,
        createdAt: now - index * 60000, deadline: now + hours * 3600000,
        ownerId: members[0].id, members, sample: true
      };
    })
  };
}

function failure(status, message) {
  return Object.assign(new Error(message), { status });
}

function stringField(value, min, max, message) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min || text.length > max) throw failure(400, message);
  return text;
}

function accountName(value) {
  const name = stringField(value, 3, 24, '账号需为 3–24 位。');
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw failure(400, '账号只支持英文字母、数字和下划线。');
  }
  return name.toLowerCase();
}

function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 6 || value.length > 72 || !value.trim()) {
    throw failure(400, '密码需为 6–72 位。');
  }
  return value;
}

function publicUser(user) {
  return { id: user.id, nickname: user.nickname };
}

function publicOrder(order) {
  return { ...order, members: order.members.map(({ id, nickname }) => ({ id, nickname })) };
}

function orderFromBody(body, user, orderId) {
  const title = stringField(body.title, 1, 48, '商品名称需为 1–48 个字符。');
  const note = stringField(body.note, 0, 120, '备注最多 120 个字符。');
  const room = stringField(body.room, 0, 16, '宿舍号最多 16 个字符。');
  if (!categories.includes(body.category) || !platforms.includes(body.platform)) {
    throw failure(400, '请选择商品分类和购买平台。');
  }
  const amount = typeof body.total === 'string' ? body.total : '';
  const money = /^(\d{1,5})(?:\.(\d{1,2}))?$/.exec(amount);
  const cents = money ? Number(money[1]) * 100 + Number((money[2] || '').padEnd(2, '0')) : 0;
  if (cents < 1) throw failure(400, '请输入有效总价，最多两位小数。');
  const target = typeof body.target === 'string' && /^\d{1,2}$/.test(body.target) ? Number(body.target) : 0;
  if (target < 2 || target > 99) throw failure(400, '目标人数需为 2–99 人，含发起人。');
  const now = Date.now();
  const deadline = body.deadline;
  if (!Number.isSafeInteger(deadline) || deadline <= now || deadline > 8640000000000000) {
    throw failure(400, '请选择晚于当前时间的截止时间。');
  }
  return {
    id: orderId, title, category: body.category, platform: body.platform,
    cents, target, deadline, note, ...(room && { room }), createdAt: now, ownerId: user.id,
    members: [{ id: user.id, nickname: user.nickname }]
  };
}

module.exports = { starterData, failure, stringField, accountName, passwordValue, publicUser, publicOrder, orderFromBody };

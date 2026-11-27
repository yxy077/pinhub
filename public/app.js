(function () {
  'use strict';

  var user = null;
  var orders = [];
  var loaded = false;
  var offline = false;
  var view = 'all';
  var category = '全部';
  var clockOffset = 0;
  var refreshId = 0;
  var refreshPending = false;
  var previousRender = '';
  var deadlineBoundary = Infinity;
  var actionInProgress = {};
  var modalMode = '';
  var pendingAction = null;
  var previousFocus = null;
  var toastTimer;
  var photoClasses = { 奶茶: 'tea', 水果: 'fruit', 零食: 'snack', 其他: 'other' };
  var modal = byId('modal');
  var authForm = byId('auth-form');
  var orderForm = byId('order-form');
  var orderList = byId('orders');

  function byId(id) {
    return document.getElementById(id);
  }

  function node(tag, className, content) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (typeof content !== 'undefined') element.textContent = content;
    return element;
  }

  function api(method, path, data, done) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, path, true);
    xhr.timeout = 8000;
    if (method === 'POST') xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = function () {
      var result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch (error) {
        done('服务器返回了无法识别的响应。', null, xhr.status);
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) done(null, result, xhr.status);
      else done(result.error || '请求失败，请重试。', null, xhr.status);
    };
    xhr.onerror = xhr.ontimeout = function () {
      done('暂时无法连接服务器，请重试。', null, 0);
    };
    xhr.send(method === 'POST' ? JSON.stringify(data || {}) : null);
  }

  function notify(message) {
    clearTimeout(toastTimer);
    byId('toast').textContent = message;
    toastTimer = setTimeout(function () { byId('toast').textContent = ''; }, 4000);
  }

  function now() {
    return Date.now() + clockOffset;
  }

  function statusOf(order) {
    if (order.deadline <= now()) return 'closed';
    if (order.members.length >= order.target) return 'full';
    return 'open';
  }

  function includesUser(order) {
    return user && order.members.some(function (member) { return member.id === user.id; });
  }

  function pad(value) {
    return ('0' + value).slice(-2);
  }

  function countdown(deadline) {
    var seconds = Math.max(0, Math.ceil((deadline - now()) / 1000));
    if (!seconds) return '已截止';
    var days = Math.floor(seconds / 86400);
    return (days ? days + '天 ' : '') + pad(Math.floor(seconds / 3600) % 24) +
      ':' + pad(Math.floor(seconds / 60) % 60) + ':' + pad(seconds % 60);
  }

  function money(cents) {
    return '¥' + (cents / 100).toFixed(2);
  }

  function deadlineLabel(deadline, currentTime) {
    var date = new Date(deadline);
    var today = new Date(currentTime);
    var tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    var day = date.toDateString();
    var prefix = (date.getMonth() + 1) + '月' + date.getDate() + '日 ';
    if (day === today.toDateString()) prefix = '今天 ';
    else if (day === tomorrow.toDateString()) prefix = '明天 ';
    return prefix + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ' 截止';
  }

  function actionProps(order, status) {
    if (status === 'closed') return { label: '已截止', disabled: true };
    if (user && user.id === order.ownerId) return { label: '我发起的拼单', disabled: true };
    if (includesUser(order)) return { label: '取消报名', route: 'cancel' };
    if (status === 'full') return { label: '拼单已满', disabled: true };
    return { label: '报名', route: 'join' };
  }

  function makeOrder(order, expanded, currentTime) {
    var status = statusOf(order);
    var stateLabel = { closed: '已截止', full: '已满员', open: '还差 ' + (order.target - order.members.length) + ' 人' }[status];
    var card = node('article', 'order');
    var header = node('div', 'order-header');
    var photo = node('div', 'order-photo photo-' + (photoClasses[order.category] || 'other'));
    photo.setAttribute('aria-hidden', 'true');
    header.appendChild(photo);

    var info = node('div', 'order-info');
    var title = node('h3', '', order.title);
    title.id = 'order-title-' + order.id;
    title.tabIndex = -1;
    card.setAttribute('aria-labelledby', title.id);
    info.appendChild(title);
    info.appendChild(node('p', 'order-meta',
      order.members[0].nickname + '发起 · ' + order.platform + (order.sample ? ' · 示例' : '') +
      (order.room ? ' · 宿舍 ' + order.room : '')));
    var timing = node('div', 'order-timing');
    timing.appendChild(node('span', 'order-state ' + status, stateLabel));
    var deadline = node('time', 'order-deadline', deadlineLabel(order.deadline, currentTime));
    deadline.dateTime = new Date(order.deadline).toISOString();
    timing.appendChild(deadline);
    info.appendChild(timing);
    header.appendChild(info);
    card.appendChild(header);

    var countRow = node('div', 'order-count-row');
    countRow.appendChild(node('span', '', '已报名 ' + order.members.length + '/' + order.target));
    if (status !== 'closed') {
      var timer = node('span', 'countdown', '剩余 ' + countdown(order.deadline));
      timer.setAttribute('data-deadline', order.deadline);
      countRow.appendChild(timer);
    }
    card.appendChild(countRow);

    var actionRow = node('div', 'order-action-row');
    var split = node('span', 'order-price', '当前 ');
    split.appendChild(node('strong', '', money(Math.round(order.cents / order.members.length))));
    split.appendChild(document.createTextNode(' / 人'));
    actionRow.appendChild(split);

    var action = actionProps(order, status);
    var button = node('button', 'button order-action ' + (action.route === 'join' ? 'button-primary' : 'button-outline'),
      actionInProgress[order.id] ? '处理中…' : action.label);
    button.type = 'button';
    button.id = 'order-action-' + order.id;
    button.disabled = !!action.disabled || !!actionInProgress[order.id];
    button.setAttribute('aria-label', button.textContent + '：' + order.title);
    if (action.route) {
      button.onclick = function () {
        requireAccount(function () { submitAction(order.id, action.route); });
      };
    }
    actionRow.appendChild(button);
    card.appendChild(actionRow);

    var details = node('details', 'order-details');
    details.id = 'order-details-' + order.id;
    if (expanded[details.id]) details.setAttribute('open', '');
    var summary = node('summary', '', '拼单详情');
    summary.id = 'order-summary-' + order.id;
    details.appendChild(summary);
    details.appendChild(node('p', '', '总价 ' + money(order.cents) + ' · ' + order.category));
    if (order.note) details.appendChild(node('p', '', order.note));
    details.appendChild(node('p', '', '报名成员：' + order.members.map(function (member) { return member.nickname; }).join('、')));
    var progress = node('progress', 'order-progress');
    progress.max = order.target;
    progress.value = order.members.length;
    progress.setAttribute('aria-label', '报名进度');
    details.appendChild(progress);
    card.appendChild(details);
    return card;
  }

  function renderBoard() {
    var activeOnly = byId('open-only').checked;
    var base = orders.filter(function (order) { return view === 'all' || includesUser(order); });
    var available = base.filter(function (order) { return statusOf(order) === 'open'; }).length;
    var visible = base.filter(function (order) {
      return (category === '全部' || category === order.category) && (!activeOnly || statusOf(order) === 'open');
    });
    deadlineBoundary = Infinity;
    orders.forEach(function (order) {
      if (order.deadline > now()) deadlineBoundary = Math.min(deadlineBoundary, order.deadline);
    });
    byId('board-title').textContent = view === 'all' ? '拼单大厅' : '我的拼单';
    byId('board-summary').textContent = !loaded ? (offline ? '暂时无法加载拼单' : '正在加载拼单…') :
      '共 ' + base.length + ' 条拼单 · ' + available + ' 条可报名';
    orderList.setAttribute('aria-busy', !loaded && !offline ? 'true' : 'false');

    var currentTime = now();
    var signature = JSON.stringify([visible, visible.map(statusOf), new Date(currentTime).toDateString(), user && user.id, actionInProgress]);
    if (signature !== previousRender) {
      previousRender = signature;
      var focused = orderList.contains(document.activeElement) ? document.activeElement.id : '';
      var expanded = {};
      var openDetails = orderList.querySelectorAll('.order-details[open]');
      for (var i = 0; i < openDetails.length; i++) expanded[openDetails[i].id] = true;
      var fragment = document.createDocumentFragment();
      visible.forEach(function (order) { fragment.appendChild(makeOrder(order, expanded, currentTime)); });
      orderList.textContent = '';
      orderList.appendChild(fragment);
      if (focused) {
        if (byId(focused) && !byId(focused).disabled) byId(focused).focus();
        else {
          var orderTitle = byId(focused.replace('order-action-', 'order-title-'));
          (orderTitle || byId('board-title')).focus();
        }
      }
    }

    byId('empty').hidden = visible.length > 0 || (!loaded && !offline);
    if (byId('empty').hidden) return;
    var emptyAction = byId('empty-action');
    emptyAction.hidden = false;
    if (!loaded && offline) {
      byId('empty-title').textContent = '服务器暂时未连接';
      byId('empty-copy').textContent = '请稍后再试。';
      emptyAction.textContent = '重新加载';
      emptyAction.onclick = refresh;
    } else if (view === 'mine' && !user) {
      byId('empty-title').textContent = '查看我的拼单';
      byId('empty-copy').textContent = '登录后可查看你发起和参加的拼单。';
      emptyAction.textContent = '登录';
      emptyAction.onclick = function () { openAuth('login'); };
    } else if (category !== '全部' || activeOnly) {
      byId('empty-title').textContent = '没有符合条件的拼单';
      byId('empty-copy').textContent = '可以清除筛选查看其他拼单。';
      emptyAction.textContent = '清除筛选';
      emptyAction.onclick = resetFilters;
    } else {
      byId('empty-title').textContent = '这里还没有拼单';
      byId('empty-copy').textContent = view === 'mine' ? '发起或加入拼单后，会显示在这里。' : '发起一条拼单，邀请室友参加。';
      emptyAction.hidden = view === 'all';
      emptyAction.textContent = '浏览拼单大厅';
      emptyAction.onclick = function () { selectView('all'); };
    }
  }

  function refresh() {
    var id = ++refreshId;
    refreshPending = true;
    api('GET', '/api/orders', null, function (error, data) {
      if (id !== refreshId) return;
      refreshPending = false;
      offline = !!error;
      byId('live').className = offline ? 'live offline' : 'live';
      byId('live-text').textContent = offline ? '同步中断' : '每 3 秒同步';
      if (data) {
        clockOffset = data.now - Date.now();
        orders = data.orders;
        loaded = true;
      }
      renderBoard();
    });
  }

  function tick() {
    if (now() >= deadlineBoundary) renderBoard();
    var timers = orderList.querySelectorAll('[data-deadline]');
    for (var i = 0; i < timers.length; i++) {
      var remaining = countdown(Number(timers[i].getAttribute('data-deadline')));
      var label = remaining === '已截止' ? remaining : '剩余 ' + remaining;
      if (timers[i].textContent !== label) timers[i].textContent = label;
    }
  }

  function refreshControls(selector, attribute, value) {
    var controls = document.querySelectorAll(selector);
    for (var i = 0; i < controls.length; i++) {
      var active = controls[i].getAttribute(attribute) === value;
      if (active) controls[i].classList.add('active');
      else controls[i].classList.remove('active');
      controls[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function resetFilters() {
    category = '全部';
    byId('open-only').checked = false;
    refreshControls('[data-category]', 'data-category', category);
    renderBoard();
  }

  function selectView(value) {
    view = value;
    byId('welcome').hidden = value !== 'all';
    refreshControls('[data-view]', 'data-view', view);
    resetFilters();
    var title = byId('board-title');
    if (view === 'all') window.scrollTo(0, 0);
    else title.focus();
  }

  function setUser(value) {
    user = value;
    byId('account-name').textContent = user ? user.nickname : '';
    byId('account-name').hidden = !user;
    byId('login').hidden = !!user;
    byId('logout').hidden = !user;
    renderBoard();
  }

  function openModal() {
    if (modal.hidden) previousFocus = document.activeElement;
    modal.hidden = false;
    byId('form-error').textContent = '';
  }

  function closeModal() {
    if (byId('auth-submit').disabled || byId('order-submit').disabled) return;
    modal.hidden = true;
    modalMode = '';
    pendingAction = null;
    authForm.reset();
    orderForm.reset();
    if (previousFocus && document.body.contains(previousFocus) && !previousFocus.hidden) previousFocus.focus();
    else if (user) byId('logout').focus();
    else byId('login').focus();
    previousFocus = null;
  }

  function formField(form, name) {
    return form.elements.namedItem(name);
  }

  function openAuth(mode) {
    modalMode = mode;
    openModal();
    var register = mode === 'register';
    byId('modal-title').textContent = register ? '注册' : '登录';
    byId('auth-switch').hidden = false;
    byId('tab-login').setAttribute('aria-pressed', register ? 'false' : 'true');
    byId('tab-register').setAttribute('aria-pressed', register ? 'true' : 'false');
    byId('register-fields').hidden = !register;
    formField(authForm, 'password').autocomplete = register ? 'new-password' : 'current-password';
    formField(authForm, 'nickname').required = register;
    byId('auth-submit').textContent = register ? '注册并登录' : '登录';
    orderForm.hidden = true;
    authForm.hidden = false;
    formField(authForm, 'username').focus();
  }

  function localDateValue(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function openOrder() {
    modalMode = 'order';
    openModal();
    byId('modal-title').textContent = '发起拼单';
    byId('auth-switch').hidden = true;
    authForm.hidden = true;
    orderForm.hidden = false;
    orderForm.reset();
    formField(orderForm, 'deadline').value = localDateValue(new Date(now() + 7200000));
    formField(orderForm, 'title').focus();
  }

  function requireAccount(action) {
    if (user) action();
    else {
      pendingAction = action;
      openAuth('login');
    }
  }

  function submitAction(id, route) {
    if (actionInProgress[id]) return;
    actionInProgress[id] = true;
    renderBoard();
    api('POST', '/api/orders/' + route, { id: id }, function (error, data, status) {
      delete actionInProgress[id];
      if (status === 401) {
        setUser(null);
        requireAccount(function () { submitAction(id, route); });
      }
      if (error) notify(error);
      else {
        orders = orders.map(function (order) { return order.id === id ? data.order : order; });
        notify(route === 'join' ? '报名成功' : '已取消报名');
      }
      renderBoard();
      refresh();
    });
  }

  function deadlineValue(value) {
    var parts = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)$/.exec(value);
    if (!parts) return NaN;
    var date = new Date(0);
    date.setFullYear(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    date.setHours(Number(parts[4]), Number(parts[5]), 0, 0);
    return localDateValue(date) === value.replace(' ', 'T') ? date.getTime() : NaN;
  }

  authForm.onsubmit = function (event) {
    event.preventDefault();
    var submit = byId('auth-submit');
    if (submit.disabled) return;
    var register = modalMode === 'register';
    var payload = {
      username: formField(authForm, 'username').value,
      password: formField(authForm, 'password').value
    };
    if (register) {
      payload.nickname = formField(authForm, 'nickname').value;
    }
    byId('form-error').textContent = '';
    submit.disabled = true;
    byId('tab-login').disabled = byId('tab-register').disabled = true;
    api('POST', register ? '/api/register' : '/api/login', payload, function (error, data) {
      submit.disabled = false;
      byId('tab-login').disabled = byId('tab-register').disabled = false;
      if (error) {
        byId('form-error').textContent = error;
        return;
      }
      var next = pendingAction;
      setUser(data.user);
      closeModal();
      notify(register ? '注册成功' : '已登录');
      if (next) next();
    });
  };

  orderForm.onsubmit = function (event) {
    event.preventDefault();
    var submit = byId('order-submit');
    if (submit.disabled) return;
    var payload = {};
    ['title', 'category', 'platform', 'total', 'target', 'room', 'note'].forEach(function (name) {
      payload[name] = formField(orderForm, name).value;
    });
    payload.deadline = deadlineValue(formField(orderForm, 'deadline').value);
    if (isNaN(payload.deadline) || payload.deadline <= now()) {
      byId('form-error').textContent = '请输入有效的截止时间，且晚于当前时间。';
      return;
    }
    byId('form-error').textContent = '';
    submit.disabled = true;
    api('POST', '/api/orders', payload, function (error, data, status) {
      submit.disabled = false;
      if (error) {
        byId('form-error').textContent = error;
        if (status === 401) setUser(null);
        return;
      }
      orders.unshift(data.order);
      closeModal();
      selectView('all');
      notify('拼单已发布');
      refresh();
    });
  };

  byId('login').onclick = function () { openAuth('login'); };
  byId('logout').onclick = function () {
    var button = this;
    button.disabled = true;
    api('POST', '/api/logout', {}, function (error) {
      button.disabled = false;
      if (error) notify(error);
      else {
        setUser(null);
        byId('login').focus();
        notify('已退出登录');
      }
    });
  };
  byId('new-order').onclick = function () { requireAccount(openOrder); };
  byId('mobile-new-order').onclick = byId('new-order').onclick;
  byId('tab-login').onclick = function () { openAuth('login'); };
  byId('tab-register').onclick = function () { openAuth('register'); };
  byId('close-modal').onclick = closeModal;
  modal.onclick = function (event) { if (event.target === modal) closeModal(); };
  document.addEventListener('keydown', function (event) {
    if (modal.hidden) return;
    if (event.key === 'Escape' || event.keyCode === 27) {
      closeModal();
      return;
    }
    if (event.key !== 'Tab' && event.keyCode !== 9) return;
    var focusable = Array.prototype.filter.call(
      modal.querySelectorAll('button, input, select, textarea'),
      function (element) { return !element.disabled && element.getClientRects().length; }
    );
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  var viewButtons = document.querySelectorAll('[data-view]');
  for (var i = 0; i < viewButtons.length; i++) {
    viewButtons[i].onclick = function () { selectView(this.getAttribute('data-view')); };
  }
  document.querySelector('.filters').onclick = function (event) {
    var value = event.target.getAttribute('data-category');
    if (!value) return;
    category = value;
    refreshControls('[data-category]', 'data-category', category);
    renderBoard();
  };
  byId('open-only').onchange = renderBoard;

  api('GET', '/api/me', null, function (error, data) {
    if (data && !user) setUser(data.user);
  });
  refresh();
  setInterval(function () { if (!refreshPending) refresh(); }, 3000);
  setInterval(tick, 1000);
}());

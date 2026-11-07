/*
 * 微录 · 界面逻辑
 * 原生 JS，无框架；数据保存在 localStorage。
 */
(function () {
  'use strict';

  var C = window.WeiLuCore;
  var STORAGE_KEY = 'weilu.data.v1';
  var isSingleFile = !!document.querySelector('meta[name="weilu-single"]');
  var nativeAndroid = !!(window.WeiluAndroid && typeof window.WeiluAndroid.saveBackup === 'function');
  var view = document.getElementById('view');
  var sheetRoot = document.getElementById('sheet-root');
  var importInput = document.getElementById('import-file');
  var toastEl = document.getElementById('toast');
  var toastTimer = null;

  var today = C.todayKey();
  var state = {
    data: loadData(),
    tab: 'calendar',
    calYear: C.parseDateKey(today).getFullYear(),
    calMonth: C.parseDateKey(today).getMonth(),
    selected: today,
    filter: 'all',
    query: '',
    statsMonth: C.monthKeyOf(today),
    pendingConfirm: null,
    contactAfterSave: null,
    lastTrigger: null
  };

  /* ---------------- 启动 ---------------- */

  (function boot() {
    try {
      var params = new URLSearchParams(location.search);
      if (params.get('demo') === '1' && !state.data.contacts.length && !state.data.calls.length && window.WeiLuSeed) {
        state.data = C.normalizeData(window.WeiLuSeed.build(today));
        saveData();
      }
    } catch (e) { /* 忽略 */ }

    var hash = (location.hash || '').replace(/^#/, '');
    if (['calendar', 'records', 'stats', 'family'].indexOf(hash) >= 0) state.tab = hash;

    renderAll();
    registerServiceWorker();
  })();

  /* ---------------- 数据存取 ---------------- */

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return C.normalizeData(JSON.parse(raw));
    } catch (e) {
      console.warn('读取本地数据失败', e);
    }
    return C.makeEmptyData();
  }

  function saveData() {
    state.data.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
      return true;
    } catch (e) {
      toast('保存失败：浏览器存储不可用或空间不足');
      return false;
    }
  }

  function registerServiceWorker() {
    if (nativeAndroid) return;
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    navigator.serviceWorker.register('./sw.js').catch(function () { /* 离线缓存不可用不影响使用 */ });
  }

  /* ---------------- 小工具 ---------------- */

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function svg(name) {
    return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }

  function pad(n) {
    return C.pad2(n);
  }

  function contactById(id) {
    for (var i = 0; i < state.data.contacts.length; i++) {
      if (state.data.contacts[i].id === id) return state.data.contacts[i];
    }
    return null;
  }

  function colorOf(id) {
    var p = contactById(id);
    return p ? p.color : '#2F5D50';
  }

  function avatarText(name) {
    var n = String(name || '').trim();
    if (!n) return '?';
    if (/[\u4e00-\u9fa5]/.test(n)) return n.slice(-1);
    return n.slice(0, 1).toUpperCase();
  }

  function nowTime() {
    var d = new Date();
    return pad(d.getHours()) + ':' + pad(Math.floor(d.getMinutes() / 5) * 5);
  }

  function summaryFor(monthKey) {
    return C.summarize({
      contacts: state.data.contacts,
      calls: state.data.calls,
      today: C.todayKey(),
      monthKey: monthKey,
      reminderDays: state.data.settings.reminderDays,
      trendMonths: 6
    });
  }

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('is-on');
    }, 2400);
  }

  function setTab(tab) {
    if (!tab || state.tab === tab) return;
    state.tab = tab;
    renderChrome();
    renderView();
    window.scrollTo({ top: 0, behavior: 'auto' });
    try {
      history.replaceState(null, '', '#' + tab);
    } catch (e) { /* file:// 下可能受限 */ }
  }

  /* ---------------- 渲染入口 ---------------- */

  function renderAll() {
    renderChrome();
    renderView();
  }

  function renderChrome() {
    var dateLine = document.getElementById('today-line');
    if (dateLine) dateLine.textContent = C.formatDayCN(C.todayKey(), { year: true });
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-tab') === state.tab;
      tabs[i].classList.toggle('is-on', on);
      if (on) tabs[i].setAttribute('aria-current', 'page');
      else tabs[i].removeAttribute('aria-current');
    }
    updateInstallUi();
  }

  function renderView() {
    if (state.tab === 'records') view.innerHTML = recordsView();
    else if (state.tab === 'stats') view.innerHTML = statsView();
    else if (state.tab === 'family') view.innerHTML = familyView();
    else view.innerHTML = calendarView();
  }

  /* ---------------- 日历页 ---------------- */

  function calendarView() {
    var monthKey = state.calYear + '-' + pad(state.calMonth + 1);
    var s = summaryFor(monthKey);
    var overall = summaryFor(C.monthKeyOf(C.todayKey()));
    var cells = C.monthGrid(state.calYear, state.calMonth, { compact: true });
    var dayCalls = state.data.calls.filter(function (c) { return c.date === state.selected; })
      .sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
    var dayInfo = s.byDay[state.selected] || { count: 0, minutes: 0 };
    var reminder = overall.reminders[0];
    var hasContacts = state.data.contacts.length > 0;

    var html = '';

    if (reminder) {
      html += '<div class="reminder">' +
        '<div class="reminder-ic">' + svg('bell') + '</div>' +
        '<div class="reminder-text"><strong>该给' + esc(reminder.name) + '打个电话了</strong>' +
        '<span>已经 ' + reminder.daysSince + ' 天没有通话' +
        (overall.reminders.length > 1 ? ' · 还有 ' + (overall.reminders.length - 1) + ' 位家人' : '') + '</span></div>' +
        '<button class="btn sm" data-action="new-call" data-contact="' + esc(reminder.id) + '">现在记录</button>' +
        '</div>';
    }

    if (!hasContacts) {
      html += '<section class="card empty welcome" style="margin-bottom:12px">' +
        '<div class="empty-ic">' + svg('users') + '</div>' +
        '<h3>欢迎使用微录</h3>' +
        '<p>先添加孙子、侄子，再记下每一次通话</p>' +
        '<button class="btn primary" data-action="new-contact">＋ 添加第一位家人</button>' +
        '</section>';
    }

    html += '<section class="card cal-card">' +
      '<div class="cal-head">' +
        '<button class="cal-nav" data-action="cal-prev" aria-label="上个月">' + svg('chevron-left') + '</button>' +
        '<div class="cal-heading"><h2>' + C.monthLabel(monthKey) + '</h2>' +
          '<p>' + (s.totals.calls ? '共 ' + s.totals.calls + ' 次 · ' + C.durationText(s.totals.minutes) : '这个月还没有通话') + '</p>' +
        '</div>' +
        '<button class="cal-nav" data-action="cal-next" aria-label="下个月">' + svg('chevron-right') + '</button>' +
      '</div>' +
      '<div class="weekdays">' +
        ['一', '二', '三', '四', '五', '六', '日'].map(function (w) { return '<span>' + w + '</span>'; }).join('') +
      '</div>' +
      '<div class="cal-grid">' + cells.map(function (cell) { return calendarCell(cell, s); }).join('') + '</div>' +
      '<div class="cal-foot"><span class="cal-hint"><i></i>圆点代表当天有通话</span>' +
        '<button class="text-btn" data-action="cal-today">回到今天</button></div>' +
    '</section>';

    html += dayCard(dayCalls, dayInfo, s.today);
    return html;
  }

  function calendarCell(cell, s) {
    var classes = ['cell'];
    if (!cell.inMonth) classes.push('is-out');
    if (cell.key > s.today) classes.push('is-future');
    if (cell.key === s.today) classes.push('is-today');
    if (cell.key === state.selected) classes.push('is-selected');
    var info = s.byDay[cell.key];
    var dots = '';
    if (info) {
      dots = info.contactIds.slice(0, 3).map(function (id) {
        return '<i style="--c:' + colorOf(id) + '"></i>';
      }).join('');
    }
    var label = C.formatDayCN(cell.key) + (info ? '，' + info.count + ' 次通话' : '');
    return '<button class="' + classes.join(' ') + '" data-action="pick-day" data-key="' + cell.key + '" aria-label="' + esc(label) + '">' +
      '<span class="cell-num">' + cell.day + '</span>' +
      '<span class="dots" aria-hidden="true">' + dots + '</span>' +
    '</button>';
  }

  function dayCard(dayCalls, dayInfo, todayKey) {
    var date = C.parseDateKey(state.selected);
    var title = (date.getMonth() + 1) + '月' + date.getDate() + '日';
    var weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
    var isToday = state.selected === todayKey;

    var list = dayCalls.map(function (call) {
      var p = contactById(call.contactId);
      if (!p) return '';
      var dir = call.direction === 'in' ? 'arrow-in' : 'arrow-out';
      return '<button class="record" data-action="open-call" data-id="' + esc(call.id) + '">' +
        '<span class="avatar" style="--c:' + p.color + '">' + esc(avatarText(p.name)) + '</span>' +
        '<span class="record-main">' +
          '<span class="record-title">' + esc(p.name) + '<span class="tag">' + esc(p.relation) + '</span></span>' +
          '<span class="record-sub">' + esc(call.time) + ' · ' + svg(dir) + esc(C.directionLabel(call.direction)) + '</span>' +
          (call.note ? '<span class="record-note">' + esc(call.note) + '</span>' : '') +
        '</span>' +
        '<span class="record-dur' + (call.duration === 0 ? ' zero' : '') + '">' + C.durationText(call.duration) + '</span>' +
      '</button>';
    }).join('');

    return '<section class="card day-card">' +
      '<div class="day-head">' +
        '<div><h2>' + title + (isToday ? '<span>今天</span>' : '<span>' + weekday + '</span>') + '</h2>' +
          '<p>' + (dayInfo.count ? dayInfo.count + ' 次通话 · ' + C.durationText(dayInfo.minutes) : '这天还没有通话') + '</p>' +
        '</div>' +
        (dayCalls.length ? '<button class="btn sm ghost" data-action="new-call" data-date="' + state.selected + '">＋ 补记</button>' : '') +
      '</div>' +
      (dayCalls.length
        ? list
        : '<div class="empty compact">' +
            '<div class="empty-ic">' + svg('phone') + '</div>' +
            '<p>点一下，记下这天的通话</p>' +
            '<button class="btn primary sm" data-action="new-call" data-date="' + state.selected + '">＋ 记录一次通话</button>' +
          '</div>') +
    '</section>';
  }

  /* ---------------- 记录页 ---------------- */

  function filteredCalls() {
    var q = state.query.trim().toLowerCase();
    return state.data.calls.filter(function (call) {
      if (state.filter !== 'all' && call.contactId !== state.filter) return false;
      if (!q) return true;
      var p = contactById(call.contactId);
      var hay = [p && p.name, p && p.relation, call.note, call.date, C.formatDayCN(call.date)].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    }).sort(C.compareCallsDesc);
  }

  function recordsView() {
    var overall = summaryFor(C.monthKeyOf(C.todayKey()));
    var chips = '<button class="chip' + (state.filter === 'all' ? ' is-on' : '') + '" data-action="filter-contact" data-id="all">全部</button>' +
      state.data.contacts.map(function (p) {
        return '<button class="chip' + (state.filter === p.id ? ' is-on' : '') + '" data-action="filter-contact" data-id="' + esc(p.id) + '">' +
          '<i style="--c:' + p.color + '"></i>' + esc(p.name) + '</button>';
      }).join('');

    return '<header class="page-head">' +
        '<div><h1>通话记录</h1><p>' +
          (overall.overall.calls ? '共 ' + overall.overall.calls + ' 次 · ' + C.durationText(overall.overall.minutes) : '还没有通话记录') +
        '</p></div>' +
        '<button class="btn sm primary" data-action="new-call">＋ 记一笔</button>' +
      '</header>' +
      '<div class="search">' + svg('search') +
        '<input id="search-input" type="search" placeholder="搜索家人或备注" value="' + esc(state.query) + '" autocomplete="off">' +
      '</div>' +
      '<div class="chips">' + chips + '</div>' +
      '<div id="records-results">' + recordsResults() + '</div>';
  }

  function recordsResults() {
    var list = filteredCalls();
    var hasContacts = state.data.contacts.length > 0;

    if (!list.length) {
      var filtering = state.filter !== 'all' || state.query.trim();
      return '<div class="card empty" style="margin-top:4px">' +
        '<div class="empty-ic">' + svg(filtering ? 'search' : 'phone') + '</div>' +
        '<h3>' + (filtering ? '没有找到相关记录' : '还没有通话记录') + '</h3>' +
        '<p>' + (filtering ? '换个关键词，或看看全部记录' : hasContacts ? '记下第一次通话，日历就会亮起来' : '先添加家人，再开始记录') + '</p>' +
        (filtering
          ? '<button class="btn ghost" data-action="reset-filters">清除筛选</button>'
          : hasContacts
            ? '<button class="btn primary" data-action="new-call">＋ 记一笔</button>'
            : '<button class="btn primary" data-action="new-contact">＋ 添加家人</button>') +
      '</div>';
    }

    var groups = [];
    list.forEach(function (call) {
      var ym = C.monthKeyOf(call.date);
      var g = groups[groups.length - 1];
      if (!g || g.ym !== ym) {
        g = { ym: ym, calls: [], minutes: 0 };
        groups.push(g);
      }
      g.calls.push(call);
      g.minutes += call.duration;
    });

    return groups.map(function (g) {
      var days = [];
      g.calls.forEach(function (call) {
        var d = days[days.length - 1];
        if (!d || d.key !== call.date) {
          d = { key: call.date, calls: [] };
          days.push(d);
        }
        d.calls.push(call);
      });

      return '<section class="month-block">' +
        '<div class="month-head"><h2>' + C.monthLabel(g.ym) + '</h2>' +
          '<span>' + g.calls.length + ' 次 · ' + C.durationText(g.minutes) + '</span></div>' +
        days.map(function (d) {
          var date = C.parseDateKey(d.key);
          var weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
          return '<div class="day-row">' +
            '<div class="day-rail"><strong>' + date.getDate() + '</strong><span>' + weekday + '</span></div>' +
            '<div class="day-items">' + d.calls.map(recordCard).join('') + '</div>' +
          '</div>';
        }).join('') +
      '</section>';
    }).join('');
  }

  function recordCard(call) {
    var p = contactById(call.contactId);
    if (!p) return '';
    var dir = call.direction === 'in' ? 'arrow-in' : 'arrow-out';
    return '<button class="record-card" data-action="open-call" data-id="' + esc(call.id) + '">' +
      '<span class="avatar" style="--c:' + p.color + '">' + esc(avatarText(p.name)) + '</span>' +
      '<span class="record-main">' +
        '<span class="record-title">' + esc(p.name) + '<span class="tag">' + esc(p.relation) + '</span></span>' +
        '<span class="record-sub">' + esc(call.time) + ' · ' + svg(dir) + esc(C.directionLabel(call.direction)) + '</span>' +
        (call.note ? '<span class="record-note">' + esc(call.note) + '</span>' : '') +
      '</span>' +
      '<span class="record-dur' + (call.duration === 0 ? ' zero' : '') + '">' + C.durationText(call.duration) + '</span>' +
    '</button>';
  }

  /* ---------------- 统计页 ---------------- */

  function statsView() {
    var currentMonth = C.monthKeyOf(C.todayKey());
    var s = summaryFor(state.statsMonth);
    var isCurrent = state.statsMonth === currentMonth;
    var max = Math.max.apply(null, s.trend.map(function (t) { return t.calls; }).concat([1]));
    var trendTotal = s.trend.reduce(function (sum, t) { return sum + t.calls; }, 0);

    var trend = s.trend.map(function (t) {
      var h = t.calls ? Math.max(7, Math.round(t.calls / max * 100)) : 0;
      return '<div class="trend-col' + (t.monthKey === currentMonth ? ' is-current' : '') + '" title="' + t.label + ' ' + t.calls + ' 次">' +
        '<span class="trend-val">' + t.calls + '</span>' +
        '<div class="trend-bar" style="--h:' + h + '%"></div>' +
        '<span class="trend-label">' + t.label + '</span>' +
      '</div>';
    }).join('');

    var peopleMax = Math.max.apply(null, s.people.map(function (p) { return p.monthCalls; }).concat([1]));
    var ranks = s.people.map(function (p) {
      var width = p.monthCalls ? Math.max(4, Math.round(p.monthCalls / peopleMax * 100)) : 0;
      return '<div class="rank">' +
        '<div class="rank-top"><span class="avatar sm" style="--c:' + p.color + '">' + esc(avatarText(p.name)) + '</span>' +
          '<strong>' + esc(p.name) + '<span class="tag">' + esc(p.relation) + '</span></strong>' +
          '<span class="rank-val">' + p.monthCalls + ' 次</span></div>' +
        '<div class="rank-bar"><i style="width:' + width + '%;--c:' + p.color + '"></i></div>' +
        '<div class="rank-meta">共 ' + p.totalCalls + ' 次 · ' + C.durationText(p.totalMinutes) +
          ' · 最近：' + C.relativeDays(p.daysSince) + '</div>' +
      '</div>';
    }).join('');

    return '<header class="page-head"><div><h1>通话统计</h1><p>看看最近的联络节奏</p></div></header>' +
      '<div class="card month-switch">' +
        '<button class="cal-nav" data-action="stats-prev" aria-label="上个月">' + svg('chevron-left') + '</button>' +
        '<div><strong>' + C.monthLabel(state.statsMonth) + '</strong><small>' + (isCurrent ? '本月' : '历史月份') + '</small></div>' +
        '<button class="cal-nav" data-action="stats-next" aria-label="下个月"' + (state.statsMonth >= currentMonth ? ' disabled' : '') + '>' + svg('chevron-right') + '</button>' +
      '</div>' +
      '<div class="tiles">' +
        '<div class="tile"><strong>' + s.totals.calls + '</strong><span>通话次数</span></div>' +
        '<div class="tile"><strong>' + s.totals.minutes + '</strong><span>通话分钟</span></div>' +
        '<div class="tile"><strong>' + s.totals.contacts + '</strong><span>联系家人</span></div>' +
      '</div>' +
      '<section class="card stats-card">' +
        '<div class="card-head"><h2>近 6 个月</h2><span>共 ' + trendTotal + ' 次</span></div>' +
        '<div class="trend">' + trend + '</div>' +
      '</section>' +
      '<section class="card stats-card">' +
        '<div class="card-head"><h2>家人排行</h2><span>按' + (isCurrent ? '本月' : '该月') + '次数</span></div>' +
        (s.people.length ? '<div class="rank-list">' + ranks + '</div>' :
          '<div class="empty" style="padding:18px 8px 12px"><div class="empty-ic">' + svg('users') + '</div>' +
            '<p>添加家人后，这里会显示每个人的通话情况</p>' +
            '<button class="btn primary sm" data-action="new-contact">＋ 添加家人</button></div>') +
      '</section>' +
      '<p class="footer-note">数据只保存在这台手机上</p>';
  }

  /* ---------------- 家人页 ---------------- */

  function familyView() {
    var s = summaryFor(C.monthKeyOf(C.todayKey()));
    var threshold = state.data.settings.reminderDays;
    var reminderOptions = C.REMINDER_OPTIONS.map(function (d) {
      return '<option value="' + d + '"' + (d === threshold ? ' selected' : '') + '>' + (d === 0 ? '不提醒' : d + ' 天') + '</option>';
    }).join('');

    var people = s.people.map(function (p) {
      var cold = threshold > 0 && p.daysSince !== null && p.daysSince >= threshold;
      var tel = (p.phone || '').replace(/[^0-9+]/g, '');
      return '<article class="card person-card">' +
        '<div class="person-top">' +
          '<span class="avatar lg" style="--c:' + p.color + '">' + esc(avatarText(p.name)) + '</span>' +
          '<div class="person-id"><h3>' + esc(p.name) + '<span class="tag">' + esc(p.relation) + '</span></h3>' +
            '<p>共 ' + p.totalCalls + ' 次 · ' + C.durationText(p.totalMinutes) + '</p></div>' +
          '<span class="person-last' + (cold ? ' is-cold' : '') + '">' + esc(C.relativeDays(p.daysSince)) + '</span>' +
        '</div>' +
        '<p class="person-note">' + (p.lastKey
          ? '最近一次：' + C.formatDayCN(p.lastKey) + ' ' + esc(p.lastTime || '') + ' · ' + C.durationText(p.lastDuration || 0)
          : '还没有通话记录，记下第一次吧') + '</p>' +
        '<div class="person-actions">' +
          '<button class="btn sm primary" data-action="new-call" data-contact="' + esc(p.id) + '">记录通话</button>' +
          (tel ? '<a class="btn sm ghost" href="tel:' + esc(tel) + '">拨打' + svg('phone') + '</a>' : '') +
          '<button class="btn sm ghost" data-action="edit-contact" data-id="' + esc(p.id) + '">编辑</button>' +
        '</div>' +
      '</article>';
    }).join('');

    return '<header class="page-head">' +
        '<div><h1>我的家人</h1><p>' + s.people.length + ' 位家人 · 共 ' + s.overall.calls + ' 次通话</p></div>' +
        '<button class="btn sm primary" data-action="new-contact">＋ 添加</button>' +
      '</header>' +
      (s.people.length ? '<div class="people">' + people + '</div>' :
        '<section class="card empty" style="margin-bottom:16px">' +
          '<div class="empty-ic">' + svg('users') + '</div>' +
          '<h3>还没有添加家人</h3>' +
          '<p>把孙子、侄子的称呼加进来，就能记录每次通话</p>' +
          '<button class="btn primary" data-action="new-contact">＋ 添加第一位家人</button>' +
        '</section>') +
      '<section class="card settings">' +
        '<h2 class="card-title">提醒与备份</h2>' +
        '<label class="setting-row"><span><strong>久未联系提醒</strong><small>超过设定天数，在日历页轻轻提醒</small></span>' +
          '<select data-change="reminder-days" aria-label="久未联系提醒天数">' + reminderOptions + '</select></label>' +
        '<button class="setting-row" data-action="export"><span><strong>导出备份</strong><small>保存成文件，换手机也能带走</small></span><span class="chev">' + svg('download') + '</span></button>' +
        '<button class="setting-row" data-action="import"><span><strong>导入备份</strong><small>从之前导出的文件恢复记录</small></span><span class="chev">' + svg('upload') + '</span></button>' +
        '<button class="setting-row" data-action="clear-data"><span><strong>清空所有数据</strong><small>家人和记录都会删除，无法恢复</small></span><span class="chev">' + svg('trash') + '</span></button>' +
      '</section>' +
      '<section class="card about">' +
        '<div class="about-brand">微录 <span>v1.0</span></div>' +
        '<p>' + (nativeAndroid
          ? '数据只保存在这台手机里，不需要注册，也不会上传。建议隔一段时间导出一份备份。'
          : '数据只保存在这台手机的浏览器里，不需要注册，也不会上传。建议隔一段时间导出一份备份。') + '</p>' +
        (nativeAndroid
          ? '<p class="about-tip" style="margin-top:0">已安装为手机 App，断网也能记录；数据保存在这台手机里。</p>'
          : '<button class="btn ghost block" data-action="install">' + svg('install') + ' 添加到手机桌面</button>' +
            (!isSingleFile ? '<a class="btn ghost block" style="margin-top:8px" href="./微录-单文件版.html" download="微录.html">' +
              svg('download') + ' 下载单文件版</a>' +
              '<p class="about-tip">下载后是单个 HTML 文件，发到手机用浏览器打开就能记，不需要服务器。</p>' : '')) +
        '<button class="btn block" style="margin-top:8px;color:var(--muted);font-size:12.5px" data-action="load-demo">载入示例数据看看</button>' +
      '</section>' +
      '<p class="footer-note">每一次问候，都值得记下</p>';
  }

  /* ---------------- 弹层 ---------------- */

  function hideToast() {
    if (!toastEl) return;
    toastEl.classList.remove('is-on');
    clearTimeout(toastTimer);
  }

  function openSheet(inner) {
    hideToast();
    state.lastTrigger = document.activeElement;
    sheetRoot.innerHTML = '<div class="sheet-backdrop" data-action="close-sheet"></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1">' + inner + '</div>';
    document.body.classList.add('sheet-open');
    setTimeout(function () {
      var sheet = sheetRoot.querySelector('.sheet');
      if (sheet) sheet.focus({ preventScroll: true });
    }, 60);
  }

  function closeSheet() {
    sheetRoot.innerHTML = '';
    document.body.classList.remove('sheet-open');
    state.pendingConfirm = null;
    state.contactAfterSave = null;
    if (state.lastTrigger && typeof state.lastTrigger.focus === 'function') {
      try { state.lastTrigger.focus({ preventScroll: true }); } catch (e) { /* 忽略 */ }
    }
    state.lastTrigger = null;
  }

  function sheetHead(title) {
    return '<div class="sheet-grab"></div>' +
      '<div class="sheet-head"><h2 id="sheet-title">' + esc(title) + '</h2>' +
      '<button type="button" class="icon-btn" data-action="close-sheet" aria-label="关闭">' + svg('x') + '</button></div>';
  }

  function confirmSheet(opts) {
    state.pendingConfirm = opts.onConfirm || null;
    openSheet(sheetHead(opts.title) +
      '<div class="sheet-body"><p class="confirm-text">' + opts.message + '</p>' +
        '<div class="sheet-actions two-even">' +
          '<button type="button" class="btn ghost" data-action="close-sheet">取消</button>' +
          '<button type="button" class="btn ' + (opts.danger ? 'danger' : 'primary') + '" data-action="confirm-yes">' + esc(opts.confirmText || '确定') + '</button>' +
        '</div>' +
      '</div>');
  }

  function startNewCall(opts) {
    opts = opts || {};
    if (!state.data.contacts.length) {
      toast('先添加一位家人');
      openContactSheet(null, function (p) {
        openCallSheet(null, { contactId: p.id, date: opts.date });
      });
      return;
    }
    openCallSheet(null, opts);
  }

  function openCallSheet(call, opts) {
    opts = opts || {};
    var isEdit = !!call;
    var contacts = state.data.contacts;
    if (!contacts.length) {
      startNewCall({ date: opts.date });
      return;
    }
    var defaultContact = opts.contactId || (state.filter !== 'all' ? state.filter : contacts[0].id);
    if (!contactById(defaultContact)) defaultContact = contacts[0].id;
    var draft = call ? {
      id: call.id,
      contactId: call.contactId,
      date: call.date,
      time: call.time,
      duration: call.duration,
      direction: call.direction,
      note: call.note || ''
    } : {
      id: '',
      contactId: defaultContact,
      date: opts.date || state.selected || C.todayKey(),
      time: nowTime(),
      duration: 15,
      direction: 'out',
      note: ''
    };
    if (!C.isValidDateKey(draft.date)) draft.date = C.todayKey();

    var picker = contacts.map(function (p) {
      return '<button type="button" class="contact-pick' + (p.id === draft.contactId ? ' is-on' : '') + '" data-action="pick-contact" data-id="' + esc(p.id) + '">' +
        '<span class="avatar" style="--c:' + p.color + '">' + esc(avatarText(p.name)) + '</span>' +
        '<span>' + esc(p.name) + '</span></button>';
    }).join('');

    var quick = [5, 10, 15, 20, 30, 60].map(function (m) {
      return '<button type="button" class="quick-dur" data-action="dur-set" data-value="' + m + '">' + m + ' 分钟</button>';
    }).join('');

    var form = '<form id="call-form" class="sheet-body" data-id="' + esc(draft.id) + '" novalidate>' +
      '<div class="field"><span class="field-label">和谁通话</span>' +
        '<div class="contact-picker">' + picker + '</div>' +
        '<input type="hidden" name="contactId" value="' + esc(draft.contactId) + '">' +
      '</div>' +
      '<div class="row2">' +
        '<div class="field"><label for="call-date">日期</label><input id="call-date" type="date" name="date" value="' + esc(draft.date) + '" required></div>' +
        '<div class="field"><label for="call-time">时间</label><input id="call-time" type="time" name="time" value="' + esc(draft.time) + '" required></div>' +
      '</div>' +
      '<div class="field">' +
        '<span class="field-label">通话时长 <span class="hint">没接通可记 0 分钟</span></span>' +
        '<div class="duration-row">' +
          '<button type="button" class="dur-btn" data-action="dur-step" data-step="-5" aria-label="减少 5 分钟">−</button>' +
          '<div class="duration-box">' +
            '<input id="duration-input" type="number" name="duration" min="0" max="1440" step="1" inputmode="numeric" value="' + draft.duration + '" aria-label="通话时长（分钟）">' +
            '<span class="duration-unit">分钟</span>' +
          '</div>' +
          '<button type="button" class="dur-btn" data-action="dur-step" data-step="5" aria-label="增加 5 分钟">＋</button>' +
        '</div>' +
        '<div class="quick-durs">' + quick + '</div>' +
        '<p class="dur-hint" id="dur-hint">约 ' + C.durationText(draft.duration) + '</p>' +
      '</div>' +
      '<div class="field"><span class="field-label">谁打给谁</span>' +
        '<div class="seg">' +
          '<label><input type="radio" name="direction" value="out"' + (draft.direction !== 'in' ? ' checked' : '') + '><span>我打过去</span></label>' +
          '<label><input type="radio" name="direction" value="in"' + (draft.direction === 'in' ? ' checked' : '') + '><span>打给我</span></label>' +
        '</div>' +
      '</div>' +
      '<div class="field"><label for="call-note">备注 <span class="hint">可不填</span></label>' +
        '<input id="call-note" type="text" name="note" maxlength="60" value="' + esc(draft.note) + '" placeholder="聊了些什么…"></div>' +
      '<p class="form-error" hidden role="alert"></p>' +
      '<div class="sheet-actions"><button type="button" class="btn ghost" data-action="close-sheet">取消</button>' +
        '<button type="submit" class="btn primary">' + (isEdit ? '保存修改' : '保存记录') + '</button></div>' +
      (isEdit ? '<button type="button" class="delete-link" data-action="delete-call" data-id="' + esc(draft.id) + '">删除这条记录</button>' : '') +
    '</form>';

    openSheet(sheetHead(isEdit ? '编辑通话' : '记录这次通话') + form);
    updateDurationHint();
  }

  function openContactSheet(contact, afterSave) {
    var isEdit = !!contact;
    var colors = C.COLORS.map(function (color, i) {
      var checked = contact ? contact.color === color : i === 0;
      return '<label class="color-dot" style="--c:' + color + '" title="颜色 ' + (i + 1) + '">' +
        '<input type="radio" name="color" value="' + color + '"' + (checked ? ' checked' : '') + '></label>';
    }).join('');

    var relations = C.RELATIONS.map(function (r) {
      return '<option value="' + r + '"' + (contact && contact.relation === r ? ' selected' : '') + '>' + r + '</option>';
    }).join('');

    var form = '<form id="contact-form" class="sheet-body" data-id="' + esc(contact ? contact.id : '') + '" novalidate>' +
      '<div class="field"><label for="contact-name">称呼</label>' +
        '<input id="contact-name" type="text" name="name" maxlength="12" value="' + esc(contact ? contact.name : '') + '" placeholder="例如：小宝" required></div>' +
      '<div class="field"><label for="contact-relation">关系</label>' +
        '<select id="contact-relation" name="relation">' + relations + '</select></div>' +
      '<div class="field"><label for="contact-phone">电话 <span class="hint">可不填，方便直接拨打</span></label>' +
        '<input id="contact-phone" type="tel" name="phone" maxlength="20" value="' + esc(contact && contact.phone ? contact.phone : '') + '" placeholder="手机或座机号码"></div>' +
      '<div class="field"><span class="field-label">标记颜色</span><div class="color-row">' + colors + '</div></div>' +
      '<p class="form-error" hidden role="alert"></p>' +
      '<div class="sheet-actions"><button type="button" class="btn ghost" data-action="close-sheet">取消</button>' +
        '<button type="submit" class="btn primary">' + (isEdit ? '保存修改' : '添加家人') + '</button></div>' +
      (isEdit ? '<button type="button" class="delete-link" data-action="delete-contact" data-id="' + esc(contact.id) + '">删除这位家人</button>' : '') +
    '</form>';

    state.contactAfterSave = typeof afterSave === 'function' ? afterSave : null;
    openSheet(sheetHead(isEdit ? '编辑家人' : '添加家人') + form);
  }

  function openInstallSheet() {
    openSheet(sheetHead('添加到手机桌面') +
      '<div class="sheet-body">' +
        '<p class="confirm-text">把「微录」放到桌面，下次一点就开，像普通 App 一样。</p>' +
        '<ul class="install-list">' +
          '<li><strong>安卓 / Chrome：</strong>右上角菜单 →「添加到主屏幕」或「安装应用」</li>' +
          '<li><strong>iPhone / Safari：</strong>底部「分享」→「添加到主屏幕」</li>' +
          '<li><strong>在微信里打开：</strong>点右上角「…」→「在浏览器打开」后再添加</li>' +
        '</ul>' +
        '<p class="install-tip">用手机浏览器打开本页即可添加。数据保存在这台手机里，不会上传。</p>' +
        '<div class="sheet-actions one"><button type="button" class="btn primary" data-action="close-sheet">知道了</button></div>' +
      '</div>');
  }

  /* ---------------- 表单保存 ---------------- */

  function showFormError(form, errors) {
    var box = form.querySelector('.form-error');
    if (!box) return;
    var keys = Object.keys(errors);
    box.textContent = keys.length ? errors[keys[0]] : '请检查填写内容';
    box.hidden = false;
    var fieldMap = { name: 'name', phone: 'phone', date: 'date', time: 'time', duration: 'duration' };
    keys.forEach(function (k) {
      var field = fieldMap[k];
      if (!field) return;
      var input = form.querySelector('[name="' + field + '"]');
      if (input) input.classList.add('invalid');
    });
  }

  function clearFormError(form) {
    var box = form.querySelector('.form-error');
    if (box) { box.hidden = true; box.textContent = ''; }
    var invalids = form.querySelectorAll('.invalid');
    for (var i = 0; i < invalids.length; i++) invalids[i].classList.remove('invalid');
  }

  function saveCallForm(form) {
    var fd = new FormData(form);
    var id = form.getAttribute('data-id') || '';
    var result = C.validateCall({
      contactId: fd.get('contactId'),
      date: fd.get('date'),
      time: fd.get('time'),
      duration: fd.get('duration'),
      direction: fd.get('direction'),
      note: fd.get('note')
    }, state.data.contacts);
    if (!result.ok) {
      showFormError(form, result.errors);
      return;
    }
    var now = new Date().toISOString();
    if (id) {
      for (var i = 0; i < state.data.calls.length; i++) {
        if (state.data.calls[i].id === id) {
          state.data.calls[i] = Object.assign({}, state.data.calls[i], result.value, { updatedAt: now });
          break;
        }
      }
    } else {
      state.data.calls.push(Object.assign({ id: C.uid('c'), createdAt: now }, result.value));
    }
    state.data.calls.sort(C.compareCallsDesc);
    saveData();

    var savedDate = result.value.date;
    var date = C.parseDateKey(savedDate);
    state.selected = savedDate;
    state.calYear = date.getFullYear();
    state.calMonth = date.getMonth();

    closeSheet();
    renderAll();
    toast(id ? '已更新这次通话' : '已记下，愿常联系');
  }

  function saveContactForm(form) {
    var fd = new FormData(form);
    var id = form.getAttribute('data-id') || '';
    var result = C.validateContact({
      name: fd.get('name'),
      relation: fd.get('relation'),
      phone: fd.get('phone'),
      color: fd.get('color')
    });
    if (!result.ok) {
      showFormError(form, result.errors);
      return;
    }
    var now = new Date().toISOString();
    var saved = null;
    if (id) {
      for (var i = 0; i < state.data.contacts.length; i++) {
        if (state.data.contacts[i].id === id) {
          state.data.contacts[i] = Object.assign({}, state.data.contacts[i], result.value, { updatedAt: now });
          saved = state.data.contacts[i];
          break;
        }
      }
    } else {
      saved = Object.assign({ id: C.uid('p'), createdAt: now }, result.value);
      state.data.contacts.push(saved);
    }
    saveData();
    var cb = state.contactAfterSave;
    closeSheet();
    renderAll();
    if (saved) toast(id ? '已更新家人信息' : '已添加 ' + saved.name);
    if (cb && saved) cb(saved);
  }

  function removeCall(id) {
    state.data.calls = state.data.calls.filter(function (c) { return c.id !== id; });
    saveData();
    renderAll();
    toast('记录已删除');
  }

  function removeContact(id) {
    var p = contactById(id);
    state.data.contacts = state.data.contacts.filter(function (c) { return c.id !== id; });
    state.data.calls = state.data.calls.filter(function (c) { return c.contactId !== id; });
    if (state.filter === id) state.filter = 'all';
    saveData();
    renderAll();
    toast(p ? '已删除 ' + p.name + ' 及相关记录' : '已删除');
  }

  /* ---------------- 备份 / 清空 ---------------- */

  function exportData() {
    try {
      var payload = {
        app: 'weilu',
        version: 1,
        exportedAt: new Date().toISOString(),
        data: state.data
      };
      if (nativeAndroid) {
        var saved = window.WeiluAndroid.saveBackup(
          '微录备份-' + C.todayKey() + '.json',
          JSON.stringify(payload, null, 2)
        );
        if (saved && String(saved).indexOf('ERROR:') !== 0) {
          toast('备份已保存：' + saved);
        } else {
          toast('保存备份失败，请重试');
        }
        return;
      }
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = '微录备份-' + C.todayKey() + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('备份文件已导出');
    } catch (e) {
      toast('导出失败，请重试');
    }
  }

  function handleImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        var parsed = JSON.parse(String(reader.result));
        data = C.normalizeData(parsed && parsed.data ? parsed.data : parsed);
      } catch (e) {
        toast('文件格式不正确');
        return;
      }
      if (!data.contacts.length && !data.calls.length) {
        toast('没有找到可导入的记录');
        return;
      }
      confirmSheet({
        title: '导入备份？',
        message: '将导入 <strong>' + data.contacts.length + '</strong> 位家人、<strong>' + data.calls.length +
          '</strong> 条通话记录，并覆盖当前数据。',
        confirmText: '导入',
        onConfirm: function () {
          state.data = data;
          saveData();
          state.filter = 'all';
          state.query = '';
          state.selected = C.todayKey();
          var d = C.parseDateKey(state.selected);
          state.calYear = d.getFullYear();
          state.calMonth = d.getMonth();
          state.statsMonth = C.monthKeyOf(state.selected);
          renderAll();
          toast('备份已恢复');
        }
      });
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file, 'utf-8');
  }

  /* ---------------- 安装 ---------------- */

  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallUi();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    updateInstallUi();
    toast('已添加到桌面');
  });

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  function updateInstallUi() {
    var btn = document.getElementById('install-btn');
    if (!btn) return;
    var show = !isStandalone() && (!!deferredPrompt || /iPhone|iPad|iPod/i.test(navigator.userAgent));
    btn.hidden = !show;
  }

  function installApp() {
    if (isStandalone()) { toast('已经安装到桌面了'); return; }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      var p = deferredPrompt.userChoice;
      if (p && p.then) {
        p.then(function () { deferredPrompt = null; updateInstallUi(); });
      } else {
        deferredPrompt = null;
        updateInstallUi();
      }
      return;
    }
    openInstallSheet();
  }

  /* ---------------- 交互 ---------------- */

  document.addEventListener('click', function (event) {
    var el = event.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');

    switch (action) {
      case 'tab':
        setTab(el.getAttribute('data-tab'));
        break;

      case 'cal-prev':
      case 'cal-next': {
        var delta = action === 'cal-prev' ? -1 : 1;
        var d = new Date(state.calYear, state.calMonth + delta, 1);
        state.calYear = d.getFullYear();
        state.calMonth = d.getMonth();
        var ym = C.monthKeyOfDate(d);
        state.selected = C.monthKeyOf(C.todayKey()) === ym ? C.todayKey() : ym + '-01';
        renderView();
        break;
      }

      case 'cal-today': {
        var todayDate = C.parseDateKey(C.todayKey());
        state.calYear = todayDate.getFullYear();
        state.calMonth = todayDate.getMonth();
        state.selected = C.todayKey();
        renderView();
        break;
      }

      case 'pick-day': {
        var key = el.getAttribute('data-key');
        state.selected = key;
        var dk = C.parseDateKey(key);
        if (dk.getFullYear() !== state.calYear || dk.getMonth() !== state.calMonth) {
          state.calYear = dk.getFullYear();
          state.calMonth = dk.getMonth();
        }
        renderView();
        break;
      }

      case 'new-call': {
        var date = el.getAttribute('data-date');
        if (!date) date = state.tab === 'calendar' ? state.selected : C.todayKey();
        startNewCall({ contactId: el.getAttribute('data-contact') || '', date: date });
        break;
      }

      case 'open-call': {
        var call = state.data.calls.filter(function (c) { return c.id === el.getAttribute('data-id'); })[0];
        if (call) openCallSheet(call);
        break;
      }

      case 'new-contact':
        openContactSheet(null);
        break;

      case 'edit-contact': {
        var person = contactById(el.getAttribute('data-id'));
        if (person) openContactSheet(person);
        break;
      }

      case 'pick-contact': {
        var form = el.closest('form');
        if (!form) return;
        var hidden = form.querySelector('input[name="contactId"]');
        if (hidden) hidden.value = el.getAttribute('data-id');
        var picks = form.querySelectorAll('.contact-pick');
        for (var i = 0; i < picks.length; i++) {
          picks[i].classList.toggle('is-on', picks[i] === el);
        }
        break;
      }

      case 'dur-step':
      case 'dur-set': {
        var formEl = el.closest('form');
        if (!formEl) return;
        var input = formEl.querySelector('[name="duration"]');
        if (!input) return;
        var next = action === 'dur-step'
          ? Number(input.value || 0) + Number(el.getAttribute('data-step') || 0)
          : Number(el.getAttribute('data-value') || 0);
        input.value = C.clampDuration(next);
        updateDurationHint();
        break;
      }

      case 'close-sheet':
        closeSheet();
        break;

      case 'confirm-yes': {
        var fn = state.pendingConfirm;
        state.pendingConfirm = null;
        closeSheet();
        if (typeof fn === 'function') fn();
        break;
      }

      case 'delete-call': {
        var callId = el.getAttribute('data-id');
        confirmSheet({
          title: '删除这条记录？',
          message: '删除后无法恢复。',
          confirmText: '删除',
          danger: true,
          onConfirm: function () { removeCall(callId); }
        });
        break;
      }

      case 'delete-contact': {
        var contactId = el.getAttribute('data-id');
        var target = contactById(contactId);
        if (!target) return;
        confirmSheet({
          title: '删除' + target.name + '？',
          message: '这位家人的 <strong>' + state.data.calls.filter(function (c) { return c.contactId === contactId; }).length +
            '</strong> 条通话记录也会一起删除，无法恢复。',
          confirmText: '删除',
          danger: true,
          onConfirm: function () { removeContact(contactId); }
        });
        break;
      }

      case 'filter-contact':
        state.filter = el.getAttribute('data-id') || 'all';
        renderView();
        break;

      case 'reset-filters':
        state.filter = 'all';
        state.query = '';
        renderView();
        break;

      case 'stats-prev':
      case 'stats-next': {
        var step = action === 'stats-prev' ? -1 : 1;
        var targetMonth = C.shiftMonth(state.statsMonth, step);
        if (targetMonth > C.monthKeyOf(C.todayKey())) return;
        state.statsMonth = targetMonth;
        renderView();
        break;
      }

      case 'export':
        exportData();
        break;

      case 'import':
        if (importInput) importInput.click();
        break;

      case 'load-demo': {
        var overwrite = state.data.contacts.length || state.data.calls.length;
        var load = function () {
          if (!window.WeiLuSeed) { toast('示例数据未加载'); return; }
          state.data = C.normalizeData(window.WeiLuSeed.build(C.todayKey()));
          state.filter = 'all';
          state.query = '';
          state.selected = C.todayKey();
          var d = C.parseDateKey(state.selected);
          state.calYear = d.getFullYear();
          state.calMonth = d.getMonth();
          state.statsMonth = C.monthKeyOf(state.selected);
          saveData();
          renderAll();
          toast('示例数据已载入');
        };
        if (overwrite) {
          confirmSheet({
            title: '载入示例数据？',
            message: '示例包含 4 位家人和一批通话记录，会<strong>覆盖当前数据</strong>。建议先导出备份。',
            confirmText: '载入',
            danger: true,
            onConfirm: load
          });
        } else {
          load();
        }
        break;
      }

      case 'clear-data': {
        var hasData = state.data.contacts.length || state.data.calls.length;
        if (!hasData) { toast('现在就是空的'); break; }
        confirmSheet({
          title: '清空所有数据？',
          message: '所有家人和通话记录都会被删除，且<strong>无法恢复</strong>。建议先导出备份。',
          confirmText: '确认清空',
          danger: true,
          onConfirm: function () {
            state.data = C.makeEmptyData();
            saveData();
            state.filter = 'all';
            state.query = '';
            state.selected = C.todayKey();
            var d = C.parseDateKey(state.selected);
            state.calYear = d.getFullYear();
            state.calMonth = d.getMonth();
            state.statsMonth = C.monthKeyOf(state.selected);
            renderAll();
            toast('已清空');
          }
        });
        break;
      }

      case 'install':
        installApp();
        break;
    }
  });

  document.addEventListener('submit', function (event) {
    if (event.target.id === 'call-form') {
      event.preventDefault();
      saveCallForm(event.target);
    } else if (event.target.id === 'contact-form') {
      event.preventDefault();
      saveContactForm(event.target);
    }
  });

  document.addEventListener('input', function (event) {
    if (event.target.id === 'search-input') {
      state.query = event.target.value;
      var results = document.getElementById('records-results');
      if (results) results.innerHTML = recordsResults();
    } else if (event.target.id === 'duration-input') {
      updateDurationHint();
    }
  });

  function updateDurationHint() {
    var input = document.getElementById('duration-input');
    var hint = document.getElementById('dur-hint');
    if (!input || !hint) return;
    var value = C.clampDuration(input.value);
    hint.textContent = value ? '约 ' + C.durationText(value) : '这次没接通也可以保存';
  }

  document.addEventListener('change', function (event) {
    if (event.target.matches('[data-change="reminder-days"]')) {
      var days = Number(event.target.value) || 0;
      state.data.settings.reminderDays = days;
      saveData();
      renderView();
      toast(days ? '超过 ' + days + ' 天没通话就会提醒' : '已关闭久未联系提醒');
    }
  });

  if (importInput) {
    importInput.addEventListener('change', function () {
      var file = importInput.files && importInput.files[0];
      importInput.value = '';
      handleImportFile(file);
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && sheetRoot.innerHTML) closeSheet();
  });

  window.addEventListener('hashchange', function () {
    var hash = (location.hash || '').replace(/^#/, '');
    if (['calendar', 'records', 'stats', 'family'].indexOf(hash) >= 0 && hash !== state.tab) {
      state.tab = hash;
      renderChrome();
      renderView();
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  });

  /* 方便自动化检查 */
  window.__WEILU__ = {
    getData: function () { return JSON.parse(JSON.stringify(state.data)); },
    getTab: function () { return state.tab; },
    setTab: setTab,
    toast: toast
  };
})();

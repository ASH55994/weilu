/*
 * 微录 · 核心逻辑
 * 纯函数，无 DOM 依赖，可在浏览器（window.WeiLuCore）和 Node（require）中运行。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WeiLuCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RELATIONS = ['孙子', '孙女', '外孙', '外孙女', '侄子', '侄女', '儿子', '女儿', '其他'];
  var DIRECTIONS = [
    { id: 'out', label: '我打过去', short: '呼出' },
    { id: 'in', label: '打给我', short: '呼入' }
  ];
  var COLORS = ['#2F5D50', '#C96F4A', '#3F6E8A', '#8A5A9E', '#A8763E', '#B0536A', '#5B7F5E', '#6B7280'];
  var WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  var REMINDER_OPTIONS = [0, 5, 7, 10, 14, 30];

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function clampDuration(value) {
    var n = Number(value);
    if (!isFinite(n)) return 0;
    n = Math.round(n);
    if (n < 0) return 0;
    if (n > 1440) return 1440;
    return n;
  }

  /* ---------- 日期 ---------- */

  function dateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function parseDateKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var date = new Date(y, mo - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return date;
  }

  function isValidDateKey(key) {
    return !!parseDateKey(key) && dateKey(parseDateKey(key)) === key;
  }

  function todayKey(now) {
    return dateKey(now instanceof Date ? now : new Date());
  }

  function addDays(date, days) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  function daysBetween(fromKey, toKey) {
    var a = parseDateKey(fromKey);
    var b = parseDateKey(toKey);
    if (!a || !b) return null;
    var utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    var utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((utcB - utcA) / 86400000);
  }

  function monthKeyOf(key) {
    return String(key || '').slice(0, 7);
  }

  function monthKeyOfDate(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1);
  }

  function isValidMonthKey(key) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(key || ''));
  }

  function shiftMonth(monthKey, delta) {
    if (!isValidMonthKey(monthKey)) return monthKey;
    var y = +monthKey.slice(0, 4);
    var m = +monthKey.slice(5, 7) - 1 + Number(delta || 0);
    var d = new Date(y, m, 1);
    return monthKeyOfDate(d);
  }

  function monthLabel(monthKey) {
    if (!isValidMonthKey(monthKey)) return '';
    return (+monthKey.slice(0, 4)) + '年' + (+monthKey.slice(5, 7)) + '月';
  }

  function formatDayCN(key, opts) {
    var d = parseDateKey(key);
    if (!d) return '';
    var base = (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WEEKDAYS[d.getDay()];
    return opts && opts.year ? d.getFullYear() + '年' + base : base;
  }

  /* 月视图网格（周一为一周起点；默认固定 6 行，compact 时按需 5/6 行） */
  function monthGrid(year, monthIndex, opts) {
    var first = new Date(year, monthIndex, 1);
    var offset = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    var rows = opts && opts.compact ? Math.ceil((offset + daysInMonth) / 7) : 6;
    var start = addDays(first, -offset);
    var cells = [];
    for (var i = 0; i < rows * 7; i++) {
      var d = addDays(start, i);
      cells.push({
        key: dateKey(d),
        day: d.getDate(),
        month: d.getMonth(),
        inMonth: d.getMonth() === monthIndex && d.getFullYear() === year
      });
    }
    return cells;
  }

  /* ---------- 文案 ---------- */

  function durationText(minutes) {
    var m = clampDuration(minutes);
    if (m < 60) return m + ' 分钟';
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return rest ? h + ' 小时 ' + rest + ' 分' : h + ' 小时';
  }

  function relativeDays(days) {
    if (days === null || days === undefined || !isFinite(days)) return '还没有通话';
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    return days + ' 天前';
  }

  function directionLabel(id) {
    for (var i = 0; i < DIRECTIONS.length; i++) {
      if (DIRECTIONS[i].id === id) return DIRECTIONS[i].label;
    }
    return DIRECTIONS[0].label;
  }

  /* ---------- 数据 ---------- */

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function makeEmptyData() {
    return {
      version: 1,
      contacts: [],
      calls: [],
      settings: { reminderDays: 10 },
      updatedAt: null
    };
  }

  function validateContact(raw) {
    raw = raw || {};
    var errors = {};
    var name = String(raw.name == null ? '' : raw.name).trim().replace(/\s+/g, ' ');
    if (!name) errors.name = '请填写家人的称呼';
    else if (name.length > 12) errors.name = '称呼最多 12 个字';
    var relation = RELATIONS.indexOf(raw.relation) >= 0 ? raw.relation : '其他';
    var phone = String(raw.phone == null ? '' : raw.phone).trim().slice(0, 20);
    if (phone && !/^[0-9+\-() ]{3,20}$/.test(phone)) errors.phone = '电话号码格式不太对';
    var color = /^#[0-9a-fA-F]{6}$/.test(raw.color || '') ? raw.color : COLORS[0];
    return {
      ok: Object.keys(errors).length === 0,
      errors: errors,
      value: { name: name, relation: relation, phone: phone, color: color }
    };
  }

  function validateCall(raw, contacts) {
    raw = raw || {};
    var errors = {};
    var list = contacts || [];
    var contactId = raw.contactId;
    var exists = list.some(function (c) { return c && c.id === contactId; });
    if (!exists) errors.contactId = '请选择是和哪位家人通话';
    if (!isValidDateKey(raw.date)) errors.date = '请选择日期';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw.time || ''))) errors.time = '请选择时间';
    var duration = Number(raw.duration);
    if (!isFinite(duration) || duration < 0 || duration > 1440) {
      errors.duration = '通话时长需在 0 到 1440 分钟之间';
    }
    var direction = raw.direction === 'in' ? 'in' : 'out';
    var note = String(raw.note == null ? '' : raw.note).trim().slice(0, 60);
    return {
      ok: Object.keys(errors).length === 0,
      errors: errors,
      value: {
        contactId: contactId,
        date: raw.date,
        time: raw.time,
        duration: clampDuration(duration),
        direction: direction,
        note: note
      }
    };
  }

  function normalizeData(raw) {
    var out = makeEmptyData();
    if (!raw || typeof raw !== 'object') return out;
    var seenContacts = Object.create(null);
    var contacts = Array.isArray(raw.contacts) ? raw.contacts.slice(0, 200) : [];
    contacts.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var v = validateContact(c);
      if (!v.ok) return;
      var id = typeof c.id === 'string' && c.id && c.id.length <= 64 && !seenContacts[c.id]
        ? c.id
        : uid('p');
      seenContacts[id] = true;
      out.contacts.push({
        id: id,
        name: v.value.name,
        relation: v.value.relation,
        phone: v.value.phone,
        color: v.value.color,
        createdAt: typeof c.createdAt === 'string' ? c.createdAt : null
      });
    });

    var seenCalls = Object.create(null);
    var calls = Array.isArray(raw.calls) ? raw.calls.slice(0, 20000) : [];
    calls.forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      if (!seenContacts[c.contactId]) return;
      var v = validateCall(c, out.contacts);
      if (!v.ok) return;
      var id = typeof c.id === 'string' && c.id && c.id.length <= 64 && !seenCalls[c.id]
        ? c.id
        : uid('c');
      seenCalls[id] = true;
      out.calls.push({
        id: id,
        contactId: v.value.contactId,
        date: v.value.date,
        time: v.value.time,
        duration: v.value.duration,
        direction: v.value.direction,
        note: v.value.note,
        createdAt: typeof c.createdAt === 'string' ? c.createdAt : null
      });
    });
    out.calls.sort(compareCallsDesc);

    var settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    var days = Number(settings.reminderDays);
    out.settings.reminderDays = REMINDER_OPTIONS.indexOf(days) >= 0 ? days : 10;
    out.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
    return out;
  }

  function compareCallsDesc(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.time !== b.time) return a.time < b.time ? 1 : -1;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  }

  /* ---------- 统计 ---------- */

  function summarize(opts) {
    opts = opts || {};
    var today = isValidDateKey(opts.today) ? opts.today : todayKey();
    var monthKey = isValidMonthKey(opts.monthKey) ? opts.monthKey : monthKeyOf(today);
    var reminderDays = Number(opts.reminderDays);
    if (!isFinite(reminderDays)) reminderDays = 10;
    var trendMonths = opts.trendMonths || 6;

    var contacts = (Array.isArray(opts.contacts) ? opts.contacts : []).filter(function (c) {
      return c && c.id;
    });
    var byId = Object.create(null);
    var people = contacts.map(function (c) {
      byId[c.id] = c;
      return {
        id: c.id,
        name: c.name,
        relation: c.relation,
        color: c.color,
        phone: c.phone || '',
        totalCalls: 0,
        totalMinutes: 0,
        monthCalls: 0,
        monthMinutes: 0,
        lastKey: null,
        lastTime: null,
        lastDuration: 0
      };
    });
    var peopleById = Object.create(null);
    people.forEach(function (p) { peopleById[p.id] = p; });

    var calls = (Array.isArray(opts.calls) ? opts.calls : []).filter(function (c) {
      return c && byId[c.contactId] && isValidDateKey(c.date) && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(c.time || ''));
    });

    var byDay = Object.create(null);
    var months = Object.create(null);
    var monthCalls = 0;
    var monthMinutes = 0;
    var monthDays = Object.create(null);
    var monthContactIds = Object.create(null);
    var totalCalls = 0;
    var totalMinutes = 0;

    calls.forEach(function (c) {
      var duration = clampDuration(c.duration);
      var p = peopleById[c.contactId];
      var ym = monthKeyOf(c.date);
      p.totalCalls += 1;
      p.totalMinutes += duration;
      if (!p.lastKey || c.date > p.lastKey || (c.date === p.lastKey && c.time > (p.lastTime || ''))) {
        p.lastKey = c.date;
        p.lastTime = c.time;
        p.lastDuration = duration;
      }
      totalCalls += 1;
      totalMinutes += duration;

      var day = byDay[c.date] || (byDay[c.date] = { count: 0, minutes: 0, contactIds: [] });
      day.count += 1;
      day.minutes += duration;
      if (day.contactIds.indexOf(c.contactId) < 0) day.contactIds.push(c.contactId);

      var mm = months[ym] || (months[ym] = { calls: 0, minutes: 0 });
      mm.calls += 1;
      mm.minutes += duration;

      if (ym === monthKey) {
        monthCalls += 1;
        monthMinutes += duration;
        monthDays[c.date] = true;
        monthContactIds[c.contactId] = true;
        p.monthCalls += 1;
        p.monthMinutes += duration;
      }
    });

    people.forEach(function (p) {
      p.daysSince = p.lastKey ? daysBetween(p.lastKey, today) : null;
      p.avgMinutes = p.totalCalls ? Math.round(p.totalMinutes / p.totalCalls) : 0;
    });
    people.sort(function (a, b) {
      return (b.monthCalls - a.monthCalls) ||
        (b.totalCalls - a.totalCalls) ||
        String(a.name).localeCompare(String(b.name), 'zh-Hans-CN');
    });

    var trend = [];
    for (var i = trendMonths - 1; i >= 0; i--) {
      var ym2 = shiftMonth(monthKey, -i);
      var m2 = months[ym2] || { calls: 0, minutes: 0 };
      trend.push({
        monthKey: ym2,
        label: (+ym2.slice(5, 7)) + '月',
        calls: m2.calls,
        minutes: m2.minutes
      });
    }

    var reminders = people.filter(function (p) {
      return p.lastKey && p.daysSince !== null && p.daysSince >= reminderDays && reminderDays > 0;
    }).sort(function (a, b) { return b.daysSince - a.daysSince; });

    return {
      today: today,
      monthKey: monthKey,
      monthLabel: monthLabel(monthKey),
      totals: {
        calls: monthCalls,
        minutes: monthMinutes,
        activeDays: Object.keys(monthDays).length,
        contacts: Object.keys(monthContactIds).length
      },
      overall: {
        calls: totalCalls,
        minutes: totalMinutes,
        contacts: people.length
      },
      people: people,
      byDay: byDay,
      trend: trend,
      reminders: reminders,
      reminderDays: reminderDays
    };
  }

  return {
    RELATIONS: RELATIONS,
    DIRECTIONS: DIRECTIONS,
    COLORS: COLORS,
    WEEKDAYS: WEEKDAYS,
    REMINDER_OPTIONS: REMINDER_OPTIONS,
    pad2: pad2,
    clampDuration: clampDuration,
    dateKey: dateKey,
    parseDateKey: parseDateKey,
    isValidDateKey: isValidDateKey,
    todayKey: todayKey,
    addDays: addDays,
    daysBetween: daysBetween,
    monthKeyOf: monthKeyOf,
    monthKeyOfDate: monthKeyOfDate,
    shiftMonth: shiftMonth,
    monthLabel: monthLabel,
    formatDayCN: formatDayCN,
    monthGrid: monthGrid,
    durationText: durationText,
    relativeDays: relativeDays,
    directionLabel: directionLabel,
    uid: uid,
    makeEmptyData: makeEmptyData,
    validateContact: validateContact,
    validateCall: validateCall,
    normalizeData: normalizeData,
    compareCallsDesc: compareCallsDesc,
    summarize: summarize
  };
});

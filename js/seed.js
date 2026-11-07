/*
 * 微录 · 示例数据（仅在 ?demo=1 或用户主动载入时使用）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./core.js'));
  } else {
    root.WeiLuSeed = factory(root.WeiLuCore);
  }
})(typeof self !== 'undefined' ? self : this, function (C) {
  'use strict';

  var CONTACTS = [
    { id: 'p_demo_bao', name: '小宝', relation: '孙子', phone: '138 0013 8000', color: '#2F5D50' },
    { id: 'p_demo_duo', name: '朵朵', relation: '孙女', phone: '139 0013 9000', color: '#C96F4A' },
    { id: 'p_demo_qiang', name: '志强', relation: '侄子', phone: '137 0013 7000', color: '#3F6E8A' },
    { id: 'p_demo_yuan', name: '圆圆', relation: '侄女', phone: '', color: '#8A5A9E' }
  ];

  var PLANS = [
    {
      id: 'p_demo_bao', start: 0, every: [6, 9], duration: [14, 42], morningChance: 0.35,
      notes: ['说幼儿园得了小红花', '问我今天吃了什么', '让我看他新学的字', '说想爷爷奶奶了', '提醒我天冷加衣', '背了新学的古诗']
    },
    {
      id: 'p_demo_duo', start: 1, every: [9, 14], duration: [8, 30], morningChance: 0.2,
      notes: ['视频里给我跳舞', '说考试考了 98 分', '缠着要听故事', '说妈妈买了新书包', '画了一幅画要给我看']
    },
    {
      id: 'p_demo_qiang', start: 19, every: [18, 26], duration: [6, 24], morningChance: 0,
      notes: ['问了问工作顺不顺', '说周末回来吃饭', '聊了聊家里的事', '说给我寄了点茶叶']
    },
    {
      id: 'p_demo_yuan', start: 6, every: [20, 30], duration: [5, 18], morningChance: 0,
      notes: ['说学校运动会拿了名次', '问我身体怎么样', '聊了会儿家常']
    }
  ];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function build(todayKey) {
    var today = C.parseDateKey(todayKey || C.todayKey());
    var rnd = mulberry32(20261029);
    var calls = [];
    var seq = 0;

    function record(contactId, dayOffset, opts) {
      opts = opts || {};
      var date = C.addDays(today, -dayOffset);
      var hour, minute;
      if (opts.time) {
        hour = +opts.time.slice(0, 2);
        minute = +opts.time.slice(3, 5);
      } else {
        var morning = rnd() < (opts.morningChance || 0);
        hour = morning ? 8 + Math.floor(rnd() * 3) : 18 + Math.floor(rnd() * 3);
        minute = Math.floor(rnd() * 60);
      }
      var duration = Math.round(opts.duration || 10);
      calls.push({
        id: 'c_demo_' + (++seq),
        contactId: contactId,
        date: C.dateKey(date),
        time: C.pad2(hour) + ':' + C.pad2(minute),
        duration: duration,
        direction: rnd() < 0.68 ? 'out' : 'in',
        note: opts.note !== undefined ? opts.note : null,
        createdAt: C.dateKey(date) + 'T' + C.pad2(hour) + ':' + C.pad2(minute) + ':00'
      });
    }

    PLANS.forEach(function (plan) {
      var offset = plan.start;
      var guard = 0;
      while (offset <= 200 && guard++ < 60) {
        var duration = Math.round(plan.duration[0] + rnd() * (plan.duration[1] - plan.duration[0]));
        var note = rnd() < 0.42 ? plan.notes[Math.floor(rnd() * plan.notes.length)] : null;
        var fixed = offset === 0 ? '08:40' : null;
        record(plan.id, offset, {
          duration: offset === 0 ? 12 : duration,
          morningChance: plan.morningChance,
          note: offset === 0 ? '问我吃早饭了没有' : note,
          time: fixed
        });
        var span = plan.every[0] + rnd() * (plan.every[1] - plan.every[0]);
        offset += Math.max(3, Math.round(span));
      }
    });

    calls.sort(C.compareCallsDesc);

    return {
      version: 1,
      contacts: CONTACTS.map(function (c) {
        return { id: c.id, name: c.name, relation: c.relation, phone: c.phone, color: c.color, createdAt: null };
      }),
      calls: calls,
      settings: { reminderDays: 10 },
      updatedAt: null
    };
  }

  return { build: build, CONTACTS: CONTACTS };
});

/*
 * PlanLoop · storage.js —— 数据层（localStorage 持久化 + 所有写操作）
 * 写操作统一维护 lifetimeTotal（累计完成数）：某「任务-天」由未完成->完成则 +1，反向 -1。
 * 手动清理只删旧 completion，不动 lifetimeTotal。
 * 数据层独立封装，将来换成云同步只需替换 load/save。
 */
(function (global) {
  'use strict';
  var M = global.PlanLoopModel;
  var KEY = 'planloop:v1';

  function id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function now() { return Date.now(); }

  function defaultState() {
    return { schemaVersion: 1, profile: {}, settings: { weekStartsOn: 1, tipSeen: false }, lifetimeTotal: 0, tasks: [], completions: [], blackouts: [] };
  }

  // ---------- 首启起步任务（全新、无历史；三类任务兼作新手引导）----------
  function seedState() {
    var s = defaultState();
    s.tasks = [
      mk('water', '喝水', { kind: 'quantitative', unit: 'ml', target: 2000, direction: 'atLeast', multiAdd: true,
        quickAdds: [{ label: '一口', amount: 30 }, { label: '几口', amount: 90 }, { label: '半杯', amount: 120 }, { label: '一杯', amount: 240 }],
        recurrence: { type: 'daily' } }),                                  // 定量·多次累加
      mk('read', '读书 30 分钟', { kind: 'qualitative', recurrence: { type: 'daily' } }), // 定性·每天
      mk('run', '晨跑', { kind: 'quantitative', unit: '公里', target: 3, direction: 'atLeast', recurrence: { type: 'weekdays', weekdays: [1, 3, 5] } }) // 定量·每周固定几天
    ];
    return s; // 无打卡历史、无屏蔽、累计为 0
  }

  function mk(fixedId, title, opts) {
    return Object.assign({
      id: fixedId, title: title, kind: 'qualitative', unit: null, target: null,
      direction: 'atLeast', multiAdd: false, quickAdds: null, blackouts: [],
      recurrence: { type: 'daily' }, createdAt: now(), archived: false
    }, opts);
  }

  function migrate(s) {
    if (!s || s.schemaVersion !== 1) return Object.assign(defaultState(), s || {}, { schemaVersion: 1 });
    if (!s.blackouts) s.blackouts = [];
    if (!s.settings) s.settings = { weekStartsOn: 1, tipSeen: false };
    return s;
  }

  function load() {
    try {
      var raw = global.localStorage && localStorage.getItem(KEY);
      if (!raw) { var seed = seedState(); save(seed); return seed; }
      return migrate(JSON.parse(raw));
    } catch (e) { return defaultState(); }
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  // ---------- 完成数增量包装：执行 mutate，并按完成状态翻转维护 lifetimeTotal ----------
  function withDoneDelta(state, task, date, mutate) {
    var was = M.isTaskDoneOn(state, task, date);
    mutate();
    var is = M.isTaskDoneOn(state, task, date);
    state.lifetimeTotal += (is ? 1 : 0) - (was ? 1 : 0);
    if (state.lifetimeTotal < 0) state.lifetimeTotal = 0;
    save(state);
  }

  // 定性：切换完成
  function toggleQualitative(state, task, date) {
    withDoneDelta(state, task, date, function () {
      var existing = M.dayCompletions(state, task.id, date);
      if (existing.length) {
        state.completions = state.completions.filter(function (x) { return !(x.taskId === task.id && x.date === date); });
      } else {
        state.completions.push({ id: id(), taskId: task.id, date: date, value: null, ts: now() });
      }
    });
  }

  // 定量·单次：设定/替换当天数值（少做超额都照实记）
  function setQuantitative(state, task, date, value) {
    withDoneDelta(state, task, date, function () {
      state.completions = state.completions.filter(function (x) { return !(x.taskId === task.id && x.date === date); });
      if (value != null) state.completions.push({ id: id(), taskId: task.id, date: date, value: +value, ts: now() });
    });
  }

  // 定量·多次累加（喝水）：追加一条
  function addQuantitative(state, task, date, amount) {
    withDoneDelta(state, task, date, function () {
      state.completions.push({ id: id(), taskId: task.id, date: date, value: +amount, ts: now() });
    });
  }
  // 撤销当天最后一条
  function undoLast(state, task, date) {
    withDoneDelta(state, task, date, function () {
      var mine = state.completions.filter(function (x) { return x.taskId === task.id && x.date === date; });
      if (!mine.length) return;
      var last = mine[mine.length - 1];
      state.completions = state.completions.filter(function (x) { return x.id !== last.id; });
    });
  }
  // 清空当天
  function clearDay(state, task, date) {
    withDoneDelta(state, task, date, function () {
      state.completions = state.completions.filter(function (x) { return !(x.taskId === task.id && x.date === date); });
    });
  }

  // ---------- 任务增删改 ----------
  function upsertTask(state, task) {
    if (!task.id) { task.id = id(); task.createdAt = now(); state.tasks.push(task); }
    else {
      var i = state.tasks.findIndex(function (t) { return t.id === task.id; });
      if (i >= 0) state.tasks[i] = task; else { task.createdAt = now(); state.tasks.push(task); }
    }
    save(state); return task;
  }
  function deleteTask(state, taskId) {
    state.tasks = state.tasks.filter(function (t) { return t.id !== taskId; });
    state.completions = state.completions.filter(function (c) { return c.taskId !== taskId; });
    save(state);
  }

  // ---------- 备份 / 清理 ----------
  function exportJSON(state) { return JSON.stringify(state, null, 2); }
  function importJSON(text) { var s = migrate(JSON.parse(text)); save(s); return s; }
  function cleanupOlderThan(state, months) {
    var d = new Date(); d.setMonth(d.getMonth() - months);
    var cutoff = M.toDateStr(d);
    var before = state.completions.length;
    state.completions = state.completions.filter(function (c) { return c.date >= cutoff; });
    save(state);
    return before - state.completions.length; // 删除条数（lifetimeTotal 不变）
  }
  function resetAll() { try { localStorage.removeItem(KEY); } catch (e) {} return load(); }

  // ---------- 屏蔽时段 ----------
  function addBlackout(state, b) {
    state.blackouts = state.blackouts || [];
    state.blackouts.push(Object.assign({ id: id() }, b)); // 支持 range / weekly / monthly 各种形态
    save(state);
  }
  function deleteBlackout(state, bid) {
    state.blackouts = (state.blackouts || []).filter(function (x) { return x.id !== bid; });
    save(state);
  }

  // ---------- 个人资料（用于模板个性化，仅存本机）----------
  function setProfile(state, profile) {
    state.profile = Object.assign({}, state.profile, profile);
    save(state);
  }

  var Store = {
    load: load, save: save, newId: id,
    toggleQualitative: toggleQualitative, setQuantitative: setQuantitative,
    addQuantitative: addQuantitative, undoLast: undoLast, clearDay: clearDay,
    upsertTask: upsertTask, deleteTask: deleteTask,
    addBlackout: addBlackout, deleteBlackout: deleteBlackout, setProfile: setProfile,
    exportJSON: exportJSON, importJSON: importJSON, cleanupOlderThan: cleanupOlderThan, resetAll: resetAll
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
  global.PlanLoopStore = Store;
})(typeof globalThis !== 'undefined' ? globalThis : this);

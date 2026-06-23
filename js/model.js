/*
 * PlanLoop · model.js —— 纯逻辑层（无 DOM、无存储依赖）
 * 负责：日期工具、循环规则判定、完成判定、本周/周期进度统计。
 * 同时可在浏览器与 Node 下运行（便于单元自测）。
 */
(function (global) {
  'use strict';

  var WD_CN = ['一', '二', '三', '四', '五', '六', '日']; // index 0..6 => 周一..周日

  // ---------- 日期工具（一律按本地时间，避免时区偏移）----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function toDateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayStr() { return toDateStr(new Date()); }
  function parseDate(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parseDate(s); d.setDate(d.getDate() + n); return toDateStr(d); }
  function weekdayOf(s) { var d = parseDate(s).getDay(); return d === 0 ? 7 : d; } // 1..7 (周一..周日)
  function startOfWeek(s) { return addDays(s, -(weekdayOf(s) - 1)); }            // 以周一为一周起点
  function weekDates(s) { var st = startOfWeek(s); var a = []; for (var i = 0; i < 7; i++) a.push(addDays(st, i)); return a; }
  function startOfMonth(s) { var p = String(s).split('-'); return p[0] + '-' + p[1] + '-01'; }
  function monthDates(s) {
    var d = parseDate(startOfMonth(s)); var m = d.getMonth(); var a = [];
    while (d.getMonth() === m) { a.push(toDateStr(d)); d.setDate(d.getDate() + 1); }
    return a;
  }

  // ---------- 完成判定 ----------
  function dayCompletions(state, taskId, dateStr) {
    return state.completions.filter(function (c) { return c.taskId === taskId && c.date === dateStr; });
  }
  function daySum(state, taskId, dateStr) {
    return dayCompletions(state, taskId, dateStr).reduce(function (s, c) { return s + (+c.value || 0); }, 0);
  }
  // 给定某天的全部打卡记录，判断这天该任务是否“算完成”
  function isDayComplete(task, comps) {
    if (!comps || !comps.length) return false;
    if (task.kind === 'qualitative') return true;
    var sum = comps.reduce(function (s, c) { return s + (+c.value || 0); }, 0);
    if (task.target == null) return true;                 // 没设目标 => 有记录即完成
    return task.direction === 'atMost' ? sum <= task.target : sum >= task.target;
  }
  function isTaskDoneOn(state, task, dateStr) {
    return isDayComplete(task, dayCompletions(state, task.id, dateStr));
  }
  function completedDaysIn(state, task, dates) {
    return dates.filter(function (d) { return isTaskDoneOn(state, task, d); }).length;
  }

  // ---------- 屏蔽 / 休息（放假、受伤、经期等）：被屏蔽的日子不参与任何统计 ----------
  function dateInRange(d, a, b) { return d >= a && d <= b; }
  // 一条屏蔽是否命中某天：支持一次性(range) / 每周(weekly) / 每月(monthly) 循环
  function matchesBlackout(b, dateStr) {
    if (!b) return false;
    if (b.kind === 'weekly') return (b.weekdays || []).indexOf(weekdayOf(dateStr)) >= 0;
    if (b.kind === 'monthly') { var dom = +String(dateStr).split('-')[2]; return dom >= b.fromDay && dom <= b.toDay; }
    return !!(b.start && b.end) && dateInRange(dateStr, b.start, b.end); // 默认：一次性日期段
  }
  function globalBlackoutOn(state, dateStr) {
    var bs = state.blackouts || [];
    for (var i = 0; i < bs.length; i++) if (matchesBlackout(bs[i], dateStr)) return bs[i];
    return null;
  }
  function taskRestingOn(task, dateStr) {
    var bs = (task && task.blackouts) || [];
    for (var i = 0; i < bs.length; i++) if (matchesBlackout(bs[i], dateStr)) return true;
    return false;
  }
  function isActiveDay(state, task, dateStr) {
    return !globalBlackoutOn(state, dateStr) && !taskRestingOn(task, dateStr);
  }
  function activeCompletedDaysIn(state, task, dates) {
    return dates.filter(function (d) { return isActiveDay(state, task, d) && isTaskDoneOn(state, task, d); }).length;
  }
  function completedCountOnDate(state, dateStr) {
    var n = 0; state.tasks.forEach(function (t) { if (isActiveDay(state, t, dateStr) && isTaskDoneOn(state, t, dateStr)) n++; }); return n;
  }

  // ---------- 今天分类：'active'（待办）| 'done'（今天已完成）| 'hidden'（今天不涉及）----------
  function classifyForToday(state, task, today) {
    if (task.archived) return 'hidden';
    if (task.isLog) return 'hidden'; // 记录型不进“习惯”待办流（今天页单独成区）
    if (!isActiveDay(state, task, today)) return 'hidden'; // 放假/受伤/休息中 => 今天不出现
    var r = task.recurrence || {};
    var doneToday = isTaskDoneOn(state, task, today);
    switch (r.type) {
      case 'daily':
        return doneToday ? 'done' : 'active';
      case 'weekdays':
        if ((r.weekdays || []).indexOf(weekdayOf(today)) < 0) return 'hidden';
        return doneToday ? 'done' : 'active';
      case 'once':
        if (r.date !== today) return 'hidden';
        return doneToday ? 'done' : 'active';
      case 'weeklyCount':
      case 'monthlyCount': {
        var dates = r.type === 'weeklyCount' ? weekDates(today) : monthDates(today);
        var times = completedDaysIn(state, task, dates);
        var N = r.count || 1;
        if (doneToday) return 'done';        // 今天做过 => 落入已完成区（可撤销）
        return times >= N ? 'hidden' : 'active'; // 配额已满则今天不再出现
      }
      default:
        return 'hidden';
    }
  }

  // ---------- 周期进度（用于「计划」「我的」页的 x/y 与详情）----------
  function periodProgress(state, task, ref) {
    if (task.isLog) return { done: 0, planned: 0, label: '记录' }; // 记录型不算达成率
    var r = task.recurrence || {};
    if (r.type === 'daily') {
      var wd = weekDates(ref).filter(function (d) { return isActiveDay(state, task, d); });
      return { done: activeCompletedDaysIn(state, task, wd), planned: wd.length, label: '本周' };
    }
    if (r.type === 'weekdays') {
      var set = r.weekdays || [];
      var wd2 = weekDates(ref).filter(function (d) { return set.indexOf(weekdayOf(d)) >= 0 && isActiveDay(state, task, d); });
      return { done: activeCompletedDaysIn(state, task, wd2), planned: wd2.length, label: '本周' };
    }
    if (r.type === 'weeklyCount') { var wd3 = weekDates(ref); return { done: Math.min(activeCompletedDaysIn(state, task, wd3), r.count || 1), planned: r.count || 1, label: '本周' }; }
    if (r.type === 'monthlyCount') { var md = monthDates(ref); return { done: Math.min(activeCompletedDaysIn(state, task, md), r.count || 1), planned: r.count || 1, label: '本月' }; }
    if (r.type === 'once') { return { done: (isActiveDay(state, task, r.date) && isTaskDoneOn(state, task, r.date)) ? 1 : 0, planned: 1, label: '单次' }; }
    return { done: 0, planned: 0, label: '' };
  }

  // ---------- 本周完成总数（headline）：本周内所有“任务-天”完成计数 ----------
  function weeklyCompletedTotal(state, ref) {
    var wd = weekDates(ref); var n = 0;
    state.tasks.forEach(function (t) { if (t.isLog) return; wd.forEach(function (d) { if (isActiveDay(state, t, d) && isTaskDoneOn(state, t, d)) n++; }); });
    return n;
  }

  // ---------- 本周达成率（已完成任务-天 / 计划任务-天）----------
  function weeklyCompletionRate(state, ref) {
    var done = 0, planned = 0;
    state.tasks.forEach(function (t) {
      if (t.archived || t.isLog) return;
      var p = periodProgress(state, t, ref);
      if (p.label === '本周') { done += p.done; planned += p.planned; }
    });
    return planned ? Math.round((done / planned) * 100) : 0;
  }

  // ---------- 文案 ----------
  function recurrenceLabel(task) {
    var r = task.recurrence || {};
    switch (r.type) {
      case 'daily': return '每天';
      case 'weekdays': {
        var set = (r.weekdays || []).slice().sort(function (a, b) { return a - b; });
        if (set.length === 7) return '每天';
        return '每周' + set.map(function (w) { return WD_CN[w - 1]; }).join('');
      }
      case 'weeklyCount': return '每周 ' + (r.count || 1) + ' 次';
      case 'monthlyCount': return '每月 ' + (r.count || 1) + ' 次';
      case 'once': return '单次 · ' + (r.date || '');
      default: return '';
    }
  }
  function kindLabel(task) {
    if (task.kind === 'quantitative') {
      var dir = task.direction === 'atMost' ? '≤' : '≥';
      return '定量 · ' + (task.target != null ? dir + task.target + (task.unit || '') : (task.unit || ''));
    }
    return '定性 · 完成即可';
  }

  var Model = {
    WD_CN: WD_CN,
    pad: pad, toDateStr: toDateStr, todayStr: todayStr, parseDate: parseDate, addDays: addDays,
    weekdayOf: weekdayOf, startOfWeek: startOfWeek, weekDates: weekDates, startOfMonth: startOfMonth, monthDates: monthDates,
    dayCompletions: dayCompletions, daySum: daySum, isDayComplete: isDayComplete, isTaskDoneOn: isTaskDoneOn,
    completedDaysIn: completedDaysIn, classifyForToday: classifyForToday, periodProgress: periodProgress,
    weeklyCompletedTotal: weeklyCompletedTotal, weeklyCompletionRate: weeklyCompletionRate,
    matchesBlackout: matchesBlackout, globalBlackoutOn: globalBlackoutOn, taskRestingOn: taskRestingOn, isActiveDay: isActiveDay, completedCountOnDate: completedCountOnDate,
    recurrenceLabel: recurrenceLabel, kindLabel: kindLabel
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Model;
  global.PlanLoopModel = Model;
})(typeof globalThis !== 'undefined' ? globalThis : this);

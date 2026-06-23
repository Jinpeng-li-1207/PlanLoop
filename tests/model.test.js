/* 临时自测：node tests/model.test.js */
var M = require('../js/model.js');
var fail = 0, pass = 0;
function eq(actual, expected, msg) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.log('  FAIL: ' + msg + '\n    expected ' + e + '\n    got      ' + a); }
}

// --- 日期工具 ---
eq(M.weekdayOf('2026-06-21'), 7, '2026-06-21 是周日');     // 周日 => 7
eq(M.weekdayOf('2026-06-22'), 1, '2026-06-22 是周一');
eq(M.startOfWeek('2026-06-21'), '2026-06-15', '本周一 = 06-15');
eq(M.weekDates('2026-06-21')[0], '2026-06-15', '周一是 15 号');
eq(M.weekDates('2026-06-21')[6], '2026-06-21', '周日是 21 号');
eq(M.monthDates('2026-06-10').length, 30, '6 月有 30 天');
eq(M.addDays('2026-12-31', 1), '2027-01-01', '跨年 +1 天');

// --- 完成判定 ---
var qual = { id: 'q', kind: 'qualitative' };
eq(M.isDayComplete(qual, [{ value: null }]), true, '定性有记录即完成');
eq(M.isDayComplete(qual, []), false, '定性无记录未完成');

var water = { id: 'w', kind: 'quantitative', target: 2000, direction: 'atLeast' };
eq(M.isDayComplete(water, [{ value: 1200 }, { value: 600 }]), false, '喝水 1800<2000 未完成');
eq(M.isDayComplete(water, [{ value: 1200 }, { value: 900 }]), true, '喝水 2100>=2000 完成');

var phone = { id: 'p', kind: 'quantitative', target: 60, direction: 'atMost' };
eq(M.isDayComplete(phone, [{ value: 45 }]), true, '刷手机 45<=60 达标(越少越好)');
eq(M.isDayComplete(phone, [{ value: 80 }]), false, '刷手机 80>60 超标');

// --- 今天分类 ---
var today = '2026-06-21'; // 周日
function st(tasks, comps) { return { tasks: tasks, completions: comps || [] }; }

var daily = { id: 'd', kind: 'qualitative', recurrence: { type: 'daily' } };
eq(M.classifyForToday(st([daily]), daily, today), 'active', '每天任务今天待办');
eq(M.classifyForToday(st([daily], [{ taskId: 'd', date: today, value: null }]), daily, today), 'done', '每天任务打卡后已完成');

var sun = { id: 's', kind: 'qualitative', recurrence: { type: 'weekdays', weekdays: [7] } };
var mon = { id: 'm', kind: 'qualitative', recurrence: { type: 'weekdays', weekdays: [1] } };
eq(M.classifyForToday(st([sun]), sun, today), 'active', '每周日任务在周日显示');
eq(M.classifyForToday(st([mon]), mon, today), 'hidden', '每周一任务在周日隐藏');

// 每周 1 次：本周其它天已完成 => 今天隐藏；今天完成 => done
var wk = { id: 'wk', kind: 'qualitative', recurrence: { type: 'weeklyCount', count: 1 } };
eq(M.classifyForToday(st([wk]), wk, today), 'active', '周1次未做时今天待办');
eq(M.classifyForToday(st([wk], [{ taskId: 'wk', date: '2026-06-17', value: null }]), wk, today), 'hidden', '周1次本周已达标 => 今天隐藏');
eq(M.classifyForToday(st([wk], [{ taskId: 'wk', date: today, value: null }]), wk, today), 'done', '周1次今天完成 => 已完成区');

var once = { id: 'o', kind: 'qualitative', recurrence: { type: 'once', date: today } };
eq(M.classifyForToday(st([once]), once, today), 'active', '一次性任务当天待办');
eq(M.classifyForToday(st([once]), { id: 'o2', kind: 'qualitative', recurrence: { type: 'once', date: '2026-06-30' } }, today), 'hidden', '一次性任务非当天隐藏');

// --- 统计 ---
var sAll = st([daily, sun], [
  { taskId: 'd', date: '2026-06-15', value: null },
  { taskId: 'd', date: '2026-06-16', value: null },
  { taskId: 's', date: '2026-06-21', value: null }
]);
eq(M.weeklyCompletedTotal(sAll, today), 3, '本周完成总数 = 3');
eq(M.periodProgress(sAll, daily, today), { done: 2, planned: 7, label: '本周' }, '每天任务本周 2/7');
eq(M.periodProgress(sAll, sun, today), { done: 1, planned: 1, label: '本周' }, '每周日任务本周 1/1');

// --- 屏蔽 / 休息（被屏蔽的日子不计入统计）---
var bdaily = { id: 'd', kind: 'qualitative', recurrence: { type: 'daily' } };
var sBlk = {
  tasks: [bdaily],
  completions: [
    { taskId: 'd', date: '2026-06-15', value: null },
    { taskId: 'd', date: '2026-06-16', value: null },
    { taskId: 'd', date: '2026-06-17', value: null }
  ],
  blackouts: [{ id: 'b1', start: '2026-06-18', end: '2026-06-21', reason: 'vacation', label: '放假' }]
};
eq(M.globalBlackoutOn(sBlk, '2026-06-19').label, '放假', '06-19 命中放假屏蔽');
eq(M.globalBlackoutOn(sBlk, '2026-06-17'), null, '06-17 不在屏蔽内');
eq(M.classifyForToday(sBlk, bdaily, '2026-06-21'), 'hidden', '放假期间今天任务隐藏');
eq(M.periodProgress(sBlk, bdaily, '2026-06-21'), { done: 3, planned: 3, label: '本周' }, '屏蔽天不计入：本周 3/3');
eq(M.weeklyCompletedTotal(sBlk, '2026-06-21'), 3, '屏蔽不影响已完成计数 = 3');

var rtask = { id: 'r', kind: 'qualitative', recurrence: { type: 'daily' }, blackouts: [{ start: '2026-06-20', end: '2026-06-21' }] };
eq(M.taskRestingOn(rtask, '2026-06-20'), true, '任务在 06-20 休息');
eq(M.isActiveDay({ blackouts: [] }, rtask, '2026-06-20'), false, '休息日非活跃');
eq(M.classifyForToday({ tasks: [rtask], completions: [], blackouts: [] }, rtask, '2026-06-21'), 'hidden', '任务休息日今天隐藏');
eq(M.completedCountOnDate(sBlk, '2026-06-16'), 1, '06-16 当天完成数 = 1');
eq(M.completedCountOnDate(sBlk, '2026-06-19'), 0, '放假日当天完成数 = 0');

// --- 循环屏蔽（每周 / 每月）---
var bw = { kind: 'weekly', weekdays: [6, 7], reason: 'vacation', label: '周末休息' };
eq(M.matchesBlackout(bw, '2026-06-20'), true, '每周六日命中周六 06-20');
eq(M.matchesBlackout(bw, '2026-06-22'), false, '每周六日不命中周一');
var bm = { kind: 'monthly', fromDay: 1, toDay: 5, reason: 'custom', label: '经期' };
eq(M.matchesBlackout(bm, '2026-06-03'), true, '每月1–5号命中 3 号');
eq(M.matchesBlackout(bm, '2026-06-10'), false, '每月1–5号不命中 10 号');
eq(M.matchesBlackout({ start: '2026-06-10', end: '2026-06-12' }, '2026-06-11'), true, '一次性段命中');
var rt2 = { id: 'r2', kind: 'qualitative', recurrence: { type: 'daily' }, blackouts: [{ kind: 'monthly', fromDay: 1, toDay: 5 }] };
eq(M.classifyForToday({ tasks: [rt2], completions: [], blackouts: [] }, rt2, '2026-06-03'), 'hidden', '每月1–5号休息：3号今天隐藏');
eq(M.classifyForToday({ tasks: [rt2], completions: [], blackouts: [] }, rt2, '2026-06-09'), 'active', '每月1–5号休息：9号正常');

// --- 记录型(isLog) 不计入习惯统计 ---
var logT = { id: 'lg', kind: 'quantitative', unit: '次', isLog: true, recurrence: { type: 'daily' } };
var sLog = {
  tasks: [{ id: 'h', kind: 'qualitative', recurrence: { type: 'daily' } }, logT],
  completions: [
    { taskId: 'h', date: '2026-06-21', value: null },
    { taskId: 'lg', date: '2026-06-21', value: 1 },
    { taskId: 'lg', date: '2026-06-21', value: 1 }
  ], blackouts: []
};
eq(M.classifyForToday(sLog, logT, '2026-06-21'), 'hidden', '记录型不进今天习惯流');
eq(M.periodProgress(sLog, logT, '2026-06-21').label, '记录', '记录型周期进度标签=记录');
eq(M.weeklyCompletedTotal(sLog, '2026-06-21'), 1, '记录型不计入本周完成（只算习惯 h=1）');

console.log('\nPlanLoop model 自测：' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);

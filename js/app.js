/*
 * PlanLoop · app.js —— 界面层（渲染 + 交互）
 * 依赖：PlanLoopModel（逻辑）、PlanLoopStore（数据）。
 */
(function (global) {
  'use strict';
  var M = global.PlanLoopModel, S = global.PlanLoopStore;
  var state = S.load();
  var tab = 'today';
  var ui = { doneOpen: false, addOpen: {}, calMonthRef: null, blackoutSel: null };
  var swipeSuppress = false;

  // ---------- 小工具 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function fmt(n) { return Math.round(n).toLocaleString('zh-CN'); }
  var ICON = {
    check: 'M5 12l4.5 4.5L19 7', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M6 18L18 6',
    user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM5 20a7 7 0 0114 0', droplet: 'M12 3.5s6 5.5 6 10.5a6 6 0 01-12 0c0-5 6-10.5 6-10.5z',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', calendar: 'M4 7h16M4 7v12a1 1 0 001 1h14a1 1 0 001-1V7M8 3v4M16 3v4',
    trash: 'M5 7h14M9 7V5h6v2M6 7l1 13h10l1-13', chevron: 'M9 6l6 6-6 6', edit: 'M4 20h4L18 10l-4-4L4 16v4zM14 6l4 4', moon: 'M20 13a7 7 0 11-7.5-9 5.6 5.6 0 007.5 9z'
  };
  function icon(name, size) { size = size || 22; return '<svg class="ic" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="' + ICON[name] + '"/></svg>'; }

  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); setTimeout(function () { t.remove(); }, 300); }, 1800);
  }

  // 低压力激励：完成时给一句温柔反馈（只在“未完成→完成”时触发）
  var PRAISE = ['做到了，真好 🌿', '又往前一点点', '记一笔，为今天的你', '稳稳的，不急不躁', '好样的，保持轻松', '今天也照顾了自己', '这一下，值得'];
  var ALLCLEAR = ['今天的都做完啦，去好好歇着 🌿', '全部搞定，给自己鼓个掌 👏', '今天圆满，剩下的时间是你的'];
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function celebrate(task, today, wasDone) {
    if (wasDone || !M.isTaskDoneOn(state, task, today)) return;
    var active = state.tasks.filter(function (t) { return M.classifyForToday(state, t, today) === 'active'; }).length;
    toast(active === 0 ? pick(ALLCLEAR) : pick(PRAISE));
  }

  // 屏蔽理由（颜色用于日历着色，两种模式下半透明叠加都可读）
  var REASONS = {
    travel: { label: '旅行', color: '#378add' },
    injury: { label: '受伤', color: '#d85a30' },
    vacation: { label: '放假', color: '#7f77dd' },
    custom: { label: '自定义', color: '#888780' }
  };
  function reasonColor(r) { return (REASONS[r] || REASONS.custom).color; }
  function reasonLabel(b) { return b.reason === 'custom' ? (b.label || '自定义') : ((REASONS[b.reason] || {}).label || '休息'); }
  function blackoutWhen(b) {
    if (b.kind === 'weekly') return '每周' + (b.weekdays || []).slice().sort(function (a, c) { return a - c; }).map(function (w) { return M.WD_CN[w - 1]; }).join('');
    if (b.kind === 'monthly') return '每月 ' + b.fromDay + '–' + b.toDay + ' 号';
    return b.start + ' ~ ' + b.end;
  }
  function shiftMonth(ref, delta) { var d = M.parseDate(ref); d.setDate(1); d.setMonth(d.getMonth() + delta); return M.toDateStr(d); }

  // 智能模板库（新建任务时快速开始）
  var TEMPLATES = [
    { key: 'water', title: '喝水', kind: 'quantitative', unit: 'ml', target: 2000, direction: 'atLeast', multiAdd: true,
      quickAdds: [{ label: '一口', amount: 30 }, { label: '几口', amount: 90 }, { label: '半杯', amount: 120 }, { label: '一杯', amount: 240 }],
      recurrence: { type: 'daily' }, personalize: 'water', desc: '多次累加 · 个性化目标' },
    { key: 'sleep', title: '睡眠', kind: 'quantitative', unit: '小时', target: 8, direction: 'atLeast', isLog: true, logKind: 'sleep', personalize: 'sleep', recurrence: { type: 'daily' }, desc: '记上床/起床 · 看趋势' },
    { key: 'fly', title: '起飞 🚀', kind: 'quantitative', unit: '次', multiAdd: true, isLog: true, logKind: 'count', recurrence: { type: 'daily' }, desc: '随手记 · 趣味统计' },
    { key: 'walk', title: '走路', kind: 'quantitative', unit: '步', target: 6000, direction: 'atLeast', recurrence: { type: 'daily' }, desc: '参考 6000–8000 步' },
    { key: 'run', title: '跑步', kind: 'quantitative', unit: '公里', target: 5, direction: 'atLeast', recurrence: { type: 'weekdays', weekdays: [1, 3, 5] }, desc: '每周一三五' },
    { key: 'meditate', title: '冥想', kind: 'quantitative', unit: '分钟', target: 10, direction: 'atLeast', recurrence: { type: 'daily' }, desc: '每天 10 分钟' },
    { key: 'phone', title: '少刷手机', kind: 'quantitative', unit: '小时', target: 1, direction: 'atMost', recurrence: { type: 'daily' }, desc: '越少越好' },
    { key: 'read', title: '读书', kind: 'qualitative', recurrence: { type: 'daily' }, desc: '完成即可' }
  ];
  function sexLabel(s) { return s === 'female' ? '女' : s === 'male' ? '男' : ''; }
  // 喝水个性化推荐：参考 EFSA(2010) 适宜摄入 + 30–35ml/kg 体重法（单口量按生理均值≈30ml 固定，个性化只作用于每日目标）
  function recommendWater(profile) {
    profile = profile || {};
    var base, src;
    if (profile.weight) { base = Math.round(profile.weight * 33 / 50) * 50; src = '30–35 ml/kg 体重法'; }
    else if (profile.sex === 'male') { base = 2500; src = 'EFSA(2010) 适宜摄入量'; }
    else if (profile.sex === 'female') { base = 2000; src = 'EFSA(2010) 适宜摄入量'; }
    else { base = 2000; src = null; }
    if (profile.activity === 'high') base += 500; else if (profile.activity === 'mid') base += 250;
    var who = []; if (sexLabel(profile.sex)) who.push(sexLabel(profile.sex)); if (profile.weight) who.push(profile.weight + 'kg'); if (profile.activity === 'high') who.push('高运动量');
    var note = src ? ('根据你的资料（' + (who.join(' · ') || '默认') + '）推荐 · 参考 ' + src) : '设置「我的→个人资料」可个性化推荐（现用通用默认 2000ml）';
    return { target: base, note: note };
  }
  // 睡眠个性化：按年龄推荐时长（参考 National Sleep Foundation 区间）
  function recommendSleep(profile) {
    profile = profile || {};
    var a = profile.age, t = 8, who = '成人';
    if (a) { who = a + ' 岁'; if (a < 14) t = 9; else if (a < 18) t = 8.5; else if (a < 65) t = 8; else t = 7.5; }
    var note = a ? ('根据你的资料（' + who + '）推荐 · 参考 National Sleep Foundation') : '成人参考 7–9 小时 · 参考 National Sleep Foundation';
    return { target: t, note: note };
  }

  // ---------- 视图：今天 ----------
  function renderToday() {
    var today = M.todayStr();
    var weekly = M.weeklyCompletedTotal(state, today);
    var rate = M.weeklyCompletionRate(state, today);
    var wd = M.WD_CN[M.weekdayOf(today) - 1];
    var d = M.parseDate(today);

    var active = [], done = [], logs = [];
    state.tasks.forEach(function (t) {
      if (t.isLog) { if (M.isActiveDay(state, t, today)) logs.push(t); return; }
      var cls = M.classifyForToday(state, t, today);
      if (cls === 'active') active.push(t); else if (cls === 'done') done.push(t);
    });

    var html = '<header class="top"><div class="h-row">' +
      '<div><h1>今天</h1><p class="sub">' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · 周' + wd + '</p></div>' +
      '<button class="iconbtn" data-action="add" aria-label="新建任务">' + icon('plus', 20) + '</button></div>' +
      '<div class="weekcard"><div><span>本周完成</span><b>' + weekly + '</b></div>' +
      '<div class="divider"></div><div><span>本周达成</span><b>' + rate + '%</b></div></div></header>';

    if (!(state.settings && state.settings.tipSeen)) {
      html += '<div class="tip"><button class="tip-x" data-action="dismisstip" aria-label="知道了">' + icon('x', 16) + '</button>' +
        '<p class="tip-t">三步上手 👋</p>' +
        '<p class="tip-l">· 点左侧圆圈完成打卡；喝水点 <b>＋</b> 快捷加量</p>' +
        '<p class="tip-l">· 任务行<b>向左滑</b> → 今天休息 / 删除</p>' +
        '<p class="tip-l">·「计划」是<b>日历</b>，可屏蔽休息时段（旅行 / 经期…）</p></div>';
    }
    html += '<section class="list">';
    if (!active.length) html += '<p class="empty">今天的都做完了，去歇会儿 ☕</p>';
    active.forEach(function (t) { html += taskRowToday(t, today, false); });
    html += '</section>';

    if (logs.length) {
      html += '<h2 class="sec">随手记</h2><section class="list">';
      logs.forEach(function (t) { html += logRowToday(t, today); });
      html += '</section>';
    }

    if (done.length) {
      html += '<section class="donefold"><button class="fold-btn" data-action="togglefold">' +
        '<span>已完成 ' + done.length + '</span>' + icon('chevron', 18) + '</button>' +
        '<div class="fold-body' + (ui.doneOpen ? ' open' : '') + '">';
      done.forEach(function (t) { html += taskRowToday(t, today, true); });
      html += '</div></section>';
    }
    return html;
  }

  function sleepHours(bed, wake) {
    if (!bed || !wake) return null;
    var b = bed.split(':'), w = wake.split(':');
    var bm = (+b[0]) * 60 + (+b[1]), wm = (+w[0]) * 60 + (+w[1]);
    var d = wm - bm; if (d <= 0) d += 1440; // 跨午夜
    return Math.round(d / 60 * 10) / 10;
  }
  // 今天页“随手记”区的记录型行
  function logRowToday(t, today) {
    var inner;
    if (t.logKind === 'sleep') {
      var has = M.dayCompletions(state, t.id, today).length;
      var sub = has ? (fmt(M.daySum(state, t.id, today)) + ' 小时') : '今天还没记';
      inner = '<div class="task logrow" data-id="' + t.id + '"><span class="logicon">' + icon('moon', 18) + '</span>' +
        '<div class="task-main" data-action="logsleep"><p class="task-title">' + esc(t.title) + '</p><p class="task-meta">记录 · ' + sub + '</p></div>' +
        '<button class="addbtn" data-action="logsleep" aria-label="记录睡眠">' + icon('edit', 16) + '</button></div>';
    } else {
      var n = M.dayCompletions(state, t.id, today).length;
      inner = '<div class="task logrow" data-id="' + t.id + '"><span class="logicon big">🚀</span>' +
        '<div class="task-main"><p class="task-title">' + esc(t.title) + '</p><p class="task-meta">今天 ' + n + ' 次</p></div>' +
        (n ? '<button class="chip ghost" data-action="undo">撤销</button>' : '') +
        '<button class="addbtn" data-action="flyplus" aria-label="记一次">' + icon('plus', 18) + '</button></div>';
    }
    return wrapSwipe(t.id, inner);
  }
  function wrapSwipe(id, inner) {
    return '<div class="swipe" data-id="' + id + '">' +
      '<div class="swipe-actions">' +
      '<button class="sw-act rest" data-action="restday">' + icon('moon', 18) + '今天休息</button>' +
      '<button class="sw-act del" data-action="deltask">' + icon('trash', 18) + '删除</button>' +
      '</div><div class="swipe-content">' + inner + '</div></div>';
  }
  function taskRowToday(t, today, isDone) { return wrapSwipe(t.id, taskRowInner(t, today, isDone)); }
  function taskRowInner(t, today, isDone) {
    var meta = M.recurrenceLabel(t);
    // 定量·多次累加（喝水式）
    if (t.kind === 'quantitative' && t.multiAdd) {
      var sum = M.daySum(state, t.id, today), target = t.target || 0;
      var pct = target ? Math.min(100, Math.round(sum / target * 100)) : 0;
      var open = !!ui.addOpen[t.id];
      var unit = t.unit || '';
      var qaList = (t.quickAdds && t.quickAdds.length) ? t.quickAdds : (function () {
        var tg = t.target || 0; if (!tg) return [];
        var seen = {}, out = [];
        [0.1, 0.25, 0.5].forEach(function (f) { var a = Math.max(1, Math.round(tg * f)); if (!seen[a]) { seen[a] = 1; out.push({ label: '', amount: a }); } });
        return out;
      })();
      var qa = qaList.map(function (q) {
        var txt = q.label ? (esc(q.label) + ' (' + fmt(q.amount) + esc(unit) + ')') : ('+' + fmt(q.amount) + esc(unit));
        return '<button class="chip" data-action="quickadd" data-amt="' + q.amount + '">' + txt + '</button>';
      }).join('');
      var hasToday = M.dayCompletions(state, t.id, today).length > 0;
      var mark = isDone ? ' <span class="ok">' + icon('check', 14) + '</span>' : '';
      return '<div class="task task--stack" data-id="' + t.id + '">' +
        '<div class="task-row-main">' +
        '<div class="task-main">' +
        '<p class="task-title">' + esc(t.title) + mark + '</p>' +
        '<p class="task-meta">' + esc(meta) + ' · ' + fmt(sum) + '/' + fmt(target) + ' ' + esc(unit) + '</p>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div></div>' +
        '<button class="addbtn' + (open ? ' on' : '') + '" data-action="toggleadd" aria-label="添加打卡">' + icon(open ? 'x' : 'plus', 18) + '</button>' +
        '</div>' +
        '<div class="quickadds-panel' + (open ? ' open' : '') + '">' + qa +
        '<button class="chip ghost" data-action="custom">自定义</button>' +
        (hasToday ? '<button class="chip ghost" data-action="undo">撤销</button>' : '') +
        '</div></div>';
    }
    // 定量·单次（跑步式）
    if (t.kind === 'quantitative') {
      var v = M.daySum(state, t.id, today);
      var has = M.dayCompletions(state, t.id, today).length > 0;
      var sub = has ? (fmt(v) + ' ' + esc(t.unit || '')) : ('目标 ' + (t.direction === 'atMost' ? '≤' : '') + fmt(t.target || 0) + ' ' + esc(t.unit || ''));
      return '<div class="task" data-id="' + t.id + '">' +
        '<button class="check' + (isDone ? ' on' : '') + '" data-action="logvalue" aria-label="记录数值">' + (isDone ? icon('check', 16) : '') + '</button>' +
        '<div class="task-main" data-action="logvalue"><p class="task-title' + (isDone ? ' strike' : '') + '">' + esc(t.title) + '</p>' +
        '<p class="task-meta">' + esc(meta) + ' · ' + sub + '</p></div></div>';
    }
    // 定性
    return '<div class="task" data-id="' + t.id + '">' +
      '<button class="check' + (isDone ? ' on' : '') + '" data-action="toggle" aria-label="完成">' + (isDone ? icon('check', 16) : '') + '</button>' +
      '<div class="task-main" data-action="toggle"><p class="task-title' + (isDone ? ' strike' : '') + '">' + esc(t.title) + '</p>' +
      '<p class="task-meta">' + esc(meta) + ' · 定性</p></div></div>';
  }

  // ---------- 视图：计划（月历 + 任务清单）----------
  function renderPlans() {
    var today = M.todayStr();
    var html = '<header class="top"><div class="h-row"><div><h1>计划</h1><p class="sub">点日期看当天 · 可屏蔽一段时间</p></div>' +
      '<button class="iconbtn" data-action="add" aria-label="新建任务">' + icon('plus', 20) + '</button></div></header>';
    html += renderCalendar(today);
    html += '<h2 class="sec">任务清单</h2><section class="list">';
    if (!state.tasks.length) html += '<p class="empty">还没有任务，点右上角 ＋ 新建一个</p>';
    state.tasks.forEach(function (t) {
      var tag = (t.blackouts && t.blackouts.length) ? ' <span class="rest-tag">' + (M.taskRestingOn(t, today) ? '休息中' : '含休息') + '</span>' : '';
      var meta = t.isLog ? '记录' : (M.recurrenceLabel(t) + ' · ' + M.kindLabel(t));
      var prog;
      if (t.isLog) { prog = '<b>' + state.completions.filter(function (c) { return c.taskId === t.id; }).length + '</b><span>累计</span>'; }
      else { var p = M.periodProgress(state, t, today); prog = '<b>' + p.done + '/' + p.planned + '</b><span>' + p.label + '</span>'; }
      html += '<div class="task plan-row" data-id="' + t.id + '">' +
        '<div class="task-main" data-action="detail"><p class="task-title">' + esc(t.title) + tag + '</p>' +
        '<p class="task-meta">' + esc(meta) + '</p></div>' +
        '<div class="prog">' + prog + '</div>' +
        '<button class="iconbtn sm" data-action="edit" aria-label="编辑">' + icon('edit', 18) + '</button></div>';
    });
    html += '</section>';
    return html;
  }

  function renderCalendar(today) {
    var ref = ui.calMonthRef || M.startOfMonth(today);
    var first = M.parseDate(ref);
    var label = (first.getMonth() + 1) + '月 ' + first.getFullYear();
    var days = M.monthDates(ref);
    var lead = M.weekdayOf(days[0]) - 1;
    var sel = ui.blackoutSel;

    var html = '<section class="cal">';
    if (sel) {
      var tip = !sel.start ? '点选休息的【开始日】' : ('已选开始 ' + sel.start + '，再点【结束日】');
      html += '<div class="blk-banner"><span>' + tip + '</span><button class="chip ghost" data-action="cancelblackout">取消</button></div>';
    }
    html += '<div class="cal-head"><button class="iconbtn sm flip" data-action="prevmonth" aria-label="上个月">' + icon('chevron', 18) + '</button>' +
      '<b>' + label + '</b>' +
      '<button class="iconbtn sm" data-action="nextmonth" aria-label="下个月">' + icon('chevron', 18) + '</button></div>';
    html += '<div class="cal-grid cal-wd">' + ['一', '二', '三', '四', '五', '六', '日'].map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>';
    html += '<div class="cal-grid">';
    var i;
    for (i = 0; i < lead; i++) html += '<span class="cell empty-cell"></span>';
    days.forEach(function (d) {
      var blk = M.globalBlackoutOn(state, d);
      var cnt = M.completedCountOnDate(state, d);
      var cls = 'cell', style = '', dot = '';
      if (d === today) cls += ' today';
      if (sel && sel.start === d) cls += ' sel';
      if (blk) { style = 'background:' + reasonColor(blk.reason) + '22;'; dot = '<i class="bdot" style="background:' + reasonColor(blk.reason) + '"></i>'; }
      else if (cnt >= 3) cls += ' h2';
      else if (cnt >= 1) cls += ' h1';
      html += '<button class="' + cls + '" data-action="daycell" data-date="' + d + '" style="' + style + '"><span class="cell-num">' + M.parseDate(d).getDate() + '</span>' + dot + '</button>';
    });
    html += '</div>';
    html += '<div class="cal-actions"><button class="chip ' + (sel ? 'on' : 'ghost') + '" data-action="startblackout">' + (sel ? '退出屏蔽选择' : '＋ 屏蔽时间') + '</button></div>';

    var bs = (state.blackouts || []).slice().sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    if (bs.length) {
      html += '<div class="blk-list">';
      bs.forEach(function (b) {
        html += '<div class="blk-item"><i class="bdot" style="background:' + reasonColor(b.reason) + '"></i>' +
          '<span>' + esc(reasonLabel(b)) + '</span><span class="muted small">' + esc(blackoutWhen(b)) + '</span>' +
          '<button class="iconbtn sm" data-action="delblackout" data-id="' + b.id + '" aria-label="删除">' + icon('x', 16) + '</button></div>';
      });
      html += '</div>';
    }
    html += '</section>';
    return html;
  }

  // ---------- 视图：我的 ----------
  function renderMe() {
    var today = M.todayStr();
    var weekly = M.weeklyCompletedTotal(state, today);
    var rate = M.weeklyCompletionRate(state, today);
    var html = '<header class="top"><h1>我的</h1></header>';
    var touched = state.tasks.filter(function (t) { return !t.isLog && M.weekDates(today).some(function (d) { return M.isActiveDay(state, t, d) && M.isTaskDoneOn(state, t, d); }); }).length;
    var recap = weekly === 0 ? '新的一周，慢慢来就好——做一点，就是一点。' : ('这周你已经为自己完成了 ' + weekly + ' 件事，照顾了 ' + touched + ' 个习惯，挺好的。');
    html += '<div class="recap"><p class="recap-t">本周回顾</p><p class="recap-l">' + recap + '</p></div>';
    html += '<div class="lifecard"><span>累计完成（一直以来）</span><b>' + fmt(state.lifetimeTotal) + '</b></div>';
    html += '<div class="metrics"><div class="metric"><span>本周完成</span><b>' + weekly + '</b></div>' +
      '<div class="metric"><span>本周达成</span><b>' + rate + '%</b></div></div>';
    html += '<h2 class="sec">本周各任务</h2><section class="list">';
    if (!state.tasks.length) html += '<p class="empty">暂无任务</p>';
    state.tasks.forEach(function (t) {
      if (t.isLog) {
        var c = state.completions.filter(function (x) { return x.taskId === t.id; }).length;
        html += '<div class="statrow" data-id="' + t.id + '" data-action="detail"><div class="statrow-head"><span>' + esc(t.title) + ' <em>记录</em></span><span class="muted">累计 ' + c + '</span></div></div>';
        return;
      }
      var p = M.periodProgress(state, t, today);
      var pct = p.planned ? Math.round(p.done / p.planned * 100) : 0;
      html += '<div class="statrow" data-id="' + t.id + '" data-action="detail"><div class="statrow-head"><span>' + esc(t.title) +
        ' <em>' + esc(M.recurrenceLabel(t)) + '</em></span><span class="muted">' + p.done + '/' + p.planned + '</span></div>' +
        '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
    });
    html += '</section>';
    var pf = state.profile || {};
    var pfSum = (sexLabel(pf.sex) || pf.weight) ? '（' + [sexLabel(pf.sex), pf.weight ? pf.weight + 'kg' : ''].filter(Boolean).join(' · ') + '）' : '（未设置）';
    html += '<h2 class="sec">个性化</h2><div class="settings"><button class="setbtn" data-action="profile">个人资料 <span class="muted small">' + pfSum + '</span></button></div>';
    html += '<h2 class="sec">数据</h2><div class="settings">' +
      '<button class="setbtn" data-action="export">导出备份</button>' +
      '<button class="setbtn" data-action="import">导入备份</button>' +
      '<button class="setbtn" data-action="cleanup">清理旧记录</button>' +
      '<button class="setbtn danger" data-action="reset">清空全部数据</button></div>';
    html += '<p class="hint">数据仅保存在本机浏览器。换设备、卸载或清空浏览器数据都会丢失，建议定期“导出备份”。</p>';
    html += '<p class="hint dim">PlanLoop · 本地版 v1</p>';
    return html;
  }

  // ---------- 主渲染 ----------
  function render(anim) {
    var view = $('#view');
    view.innerHTML = tab === 'today' ? renderToday() : tab === 'plans' ? renderPlans() : renderMe();
    Array.prototype.forEach.call(document.querySelectorAll('.tabbtn'), function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    view.scrollTop = 0;
    if (anim) { view.classList.remove('vfade'); void view.offsetWidth; view.classList.add('vfade'); }
    attachSwipe();
  }

  function getTask(id) { return state.tasks.find(function (t) { return t.id === id; }); }

  // 今天页：左滑任务行露出「今天休息 / 删除」
  function attachSwipe() {
    if (tab !== 'today') return;
    var rows = document.querySelectorAll('#view .swipe');
    Array.prototype.forEach.call(rows, function (row) {
      var content = row.querySelector('.swipe-content');
      var actions = row.querySelector('.swipe-actions');
      var W = actions.offsetWidth || 160;
      var startX = null, startY = null, dragging = false, decided = false, openState = false;
      content.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        startX = e.clientX; startY = e.clientY; dragging = false; decided = false; content.style.transition = 'none';
      });
      content.addEventListener('pointermove', function (e) {
        if (startX == null) return;
        var dx = e.clientX - startX, dy = e.clientY - startY;
        if (!decided) { if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { decided = true; dragging = Math.abs(dx) > Math.abs(dy); } else return; }
        if (!dragging) return;
        e.preventDefault();
        var base = openState ? -W : 0;
        content.style.transform = 'translateX(' + Math.max(-W, Math.min(0, base + dx)) + 'px)';
      });
      function end(e) {
        if (startX == null) return;
        content.style.transition = '';
        if (dragging) {
          var dx = e.clientX - startX, base = openState ? -W : 0;
          openState = (base + dx) < -W / 2;
          content.style.transform = 'translateX(' + (openState ? -W : 0) + 'px)';
          swipeSuppress = true; setTimeout(function () { swipeSuppress = false; }, 60);
        }
        startX = null;
      }
      content.addEventListener('pointerup', end);
      content.addEventListener('pointercancel', end);
      content.addEventListener('click', function (e) {
        if (swipeSuppress) { e.stopPropagation(); e.preventDefault(); return; }
        if (openState) { e.stopPropagation(); e.preventDefault(); content.style.transform = ''; openState = false; }
      }, true);
    });
  }

  // ---------- 视图内事件委托 ----------
  function onViewClick(e) {
    var actEl = e.target.closest('[data-action]');
    if (!actEl) return;
    var action = actEl.dataset.action;
    var taskEl = e.target.closest('.task, .plan-row, .statrow, .swipe');
    var task = taskEl ? getTask(taskEl.dataset.id) : null;
    var today = M.todayStr();

    switch (action) {
      case 'add': openTemplatePicker(); break;
      case 'edit': if (task) openEditor(task); break;
      case 'profile': openProfile(); break;
      case 'detail': if (task) openTaskDetail(task); break;
      case 'togglefold': ui.doneOpen = !ui.doneOpen; render(); break;
      case 'dismisstip': state.settings = state.settings || {}; state.settings.tipSeen = true; S.save(state); render(); break;
      case 'toggleadd': if (task) { ui.addOpen[task.id] = !ui.addOpen[task.id]; render(); } break;
      case 'toggle': if (task) { var w0 = M.isTaskDoneOn(state, task, today); S.toggleQualitative(state, task, today); render(); celebrate(task, today, w0); } break;
      case 'logvalue': if (task) openValue(task); break;
      case 'quickadd': if (task) { var wq = M.isTaskDoneOn(state, task, today); S.addQuantitative(state, task, today, +actEl.dataset.amt); render(); celebrate(task, today, wq); } break;
      case 'custom': if (task) openCustom(task); break;
      case 'undo': if (task) { S.undoLast(state, task, today); render(); } break;
      case 'flyplus': if (task) { S.addQuantitative(state, task, today, 1); render(); toast(pick(['记下了 🚀', '+1，起飞 🚀', '收到 🚀'])); } break;
      case 'logsleep': if (task) openSleepLog(task, today); break;
      case 'restday': if (task) { task.blackouts = (task.blackouts || []).concat([{ kind: 'range', start: today, end: today }]); S.upsertTask(state, task); render(); toast('今天休息，明天见'); } break;
      case 'deltask': if (task) openConfirm('删除「' + task.title + '」？相关打卡记录也会一并删除。', function () { S.deleteTask(state, task.id); render(); toast('已删除'); }); break;
      case 'prevmonth': ui.calMonthRef = shiftMonth(ui.calMonthRef || M.startOfMonth(today), -1); render(); break;
      case 'nextmonth': ui.calMonthRef = shiftMonth(ui.calMonthRef || M.startOfMonth(today), 1); render(); break;
      case 'startblackout': if (ui.blackoutSel) { ui.blackoutSel = null; render(); } else { openBlackoutType(); } break;
      case 'cancelblackout': ui.blackoutSel = null; render(); break;
      case 'delblackout': S.deleteBlackout(state, actEl.dataset.id); render(); break;
      case 'daycell': {
        var date = actEl.dataset.date;
        if (ui.blackoutSel) {
          if (!ui.blackoutSel.start) { ui.blackoutSel.start = date; render(); }
          else { var a = ui.blackoutSel.start, b = date; if (a > b) { var tmp = a; a = b; b = tmp; } openReason({ kind: 'range', start: a, end: b }, a + ' ~ ' + b); }
        } else { openDayDetail(date); }
        break;
      }
      case 'export': doExport(); break;
      case 'import': doImport(); break;
      case 'cleanup': openCleanup(); break;
      case 'reset': openConfirm('确定清空全部数据吗？会恢复到起步任务（喝水 / 读书 / 晨跑），此操作不可撤销。', function () { state = S.resetAll(); render(); toast('已重置'); }); break;
    }
  }

  // ---------- 模态框 ----------
  function openModal(node) {
    var root = $('#modal-root');
    root.innerHTML = '';
    var back = document.createElement('div'); back.className = 'backdrop';
    var sheet = document.createElement('div'); sheet.className = 'sheet';
    sheet.appendChild(node); back.appendChild(sheet); root.appendChild(back);
    back.addEventListener('click', function (e) { if (e.target === back) closeModal(); });
    requestAnimationFrame(function () { back.classList.add('show'); });
  }
  function closeModal() { var r = $('#modal-root'); r.innerHTML = ''; }

  function field(label, inner) { return '<label class="fld"><span>' + label + '</span>' + inner + '</label>'; }

  // 任务编辑器（新建 / 编辑）
  function openEditor(task) {
    var existing = !!(task && task.id);
    var t = task ? JSON.parse(JSON.stringify(task)) : { title: '', kind: 'qualitative', unit: '', target: '', direction: 'atLeast', multiAdd: false, quickAdds: null, recurrence: { type: 'daily', weekdays: [1], count: 1, date: M.todayStr() } };
    var wrap = document.createElement('div'); wrap.className = 'editor';
    wrap.innerHTML =
      '<div class="sheet-head"><b>' + (existing ? '编辑任务' : '新建任务') + '</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      field('标题', '<input id="f-title" type="text" placeholder="例如：晨跑、喝水、读书" value="' + esc(t.title) + '">') +
      field('类型', '<div class="seg" id="f-kind"><button data-k="qualitative">定性（完成即可）</button><button data-k="quantitative">定量（有数值）</button></div>') +
      '<div id="quant-block">' +
      '<div class="row2">' + field('单位', '<input id="f-unit" type="text" placeholder="ml/公里/分钟" value="' + esc(t.unit || '') + '">') +
      field('目标', '<input id="f-target" type="number" inputmode="decimal" placeholder="数值" value="' + (t.target == null ? '' : t.target) + '">') + '</div>' +
      field('方向', '<div class="seg" id="f-dir"><button data-d="atLeast">越多越好 ≥</button><button data-d="atMost">越少越好 ≤</button></div>') +
      '<label class="check-line"><input id="f-multi" type="checkbox" ' + (t.multiAdd ? 'checked' : '') + '> 允许一天内多次累加打卡（如喝水）</label>' +
      '<p class="muted small" id="f-note"></p>' +
      '</div>' +
      field('循环', '<select id="f-rtype"><option value="daily">每天</option><option value="weekdays">每周固定几天</option><option value="weeklyCount">每周 N 次</option><option value="monthlyCount">每月 N 次</option><option value="once">一次性</option></select>') +
      '<div id="r-weekdays" class="hide"><div class="seg wrap" id="f-wd"></div></div>' +
      '<div id="r-count" class="hide">' + field('每周期次数 N', '<input id="f-count" type="number" min="1" value="' + (t.recurrence.count || 1) + '">') + '</div>' +
      '<div id="r-date" class="hide">' + field('日期', '<input id="f-date" type="date" value="' + (t.recurrence.date || M.todayStr()) + '">') + '</div>' +
      '<div class="fld"><span>休息时段（这些日子该任务自动暂停，不计入统计）</span>' +
      '<div class="seg" id="rest-mode"><button type="button" data-rm="range">一段日期</button><button type="button" data-rm="monthly">每月固定</button><button type="button" data-rm="weekly">每周固定</button></div>' +
      '<div id="rm-range" class="rest-add"><input id="rest-s" type="date"><span>~</span><input id="rest-e" type="date"></div>' +
      '<div id="rm-monthly" class="rest-add hide"><span>每月</span><input id="rest-mf" type="number" min="1" max="31" placeholder="从"><span>–</span><input id="rest-mt" type="number" min="1" max="31" placeholder="到"><span>号</span></div>' +
      '<div id="rm-weekly" class="hide"><div class="seg wrap" id="rest-wd"></div></div>' +
      '<button type="button" class="btn rest-addbtn" data-addrest>添加休息时段</button>' +
      '<div id="rest-list" class="rest-list"></div></div>' +
      '<div class="sheet-actions">' + (existing ? '<button class="btn danger" data-del>删除</button>' : '<span></span>') +
      '<div><button class="btn" data-x>取消</button><button class="btn primary" data-save>保存</button></div></div>';

    // 状态
    var kind = t.kind, dir = t.direction, wdSet = (t.recurrence.weekdays || [1]).slice();
    function paintSeg() {
      wrap.querySelectorAll('#f-kind button').forEach(function (b) { b.classList.toggle('on', b.dataset.k === kind); });
      wrap.querySelectorAll('#f-dir button').forEach(function (b) { b.classList.toggle('on', b.dataset.d === dir); });
      $('#quant-block', wrap).classList.toggle('hide', kind !== 'quantitative');
    }
    function paintRecur() {
      var rt = $('#f-rtype', wrap).value;
      $('#r-weekdays', wrap).classList.toggle('hide', rt !== 'weekdays');
      $('#r-count', wrap).classList.toggle('hide', rt !== 'weeklyCount' && rt !== 'monthlyCount');
      $('#r-date', wrap).classList.toggle('hide', rt !== 'once');
    }
    // 星期 chips
    var wdBox = $('#f-wd', wrap);
    M.WD_CN.forEach(function (label, i) {
      var w = i + 1; var b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.className = wdSet.indexOf(w) >= 0 ? 'on' : '';
      b.addEventListener('click', function () { var k = wdSet.indexOf(w); if (k >= 0) wdSet.splice(k, 1); else wdSet.push(w); b.classList.toggle('on'); });
      wdBox.appendChild(b);
    });
    $('#f-rtype', wrap).value = t.recurrence.type;
    paintSeg(); paintRecur();
    if (t._note) $('#f-note', wrap).textContent = t._note;

    // 休息时段（单任务屏蔽，支持 一段日期 / 每月 / 每周）
    var restRanges = (t.blackouts || []).slice();
    var restMode = 'range', rwdSet = [];
    var rwdBox = $('#rest-wd', wrap);
    M.WD_CN.forEach(function (label, i) { var w = i + 1, b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', function () { var k = rwdSet.indexOf(w); if (k >= 0) rwdSet.splice(k, 1); else rwdSet.push(w); b.classList.toggle('on'); }); rwdBox.appendChild(b); });
    function paintRestMode() {
      wrap.querySelectorAll('#rest-mode button').forEach(function (b) { b.classList.toggle('on', b.dataset.rm === restMode); });
      $('#rm-range', wrap).classList.toggle('hide', restMode !== 'range');
      $('#rm-monthly', wrap).classList.toggle('hide', restMode !== 'monthly');
      $('#rm-weekly', wrap).classList.toggle('hide', restMode !== 'weekly');
    }
    wrap.querySelector('#rest-mode').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { restMode = b.dataset.rm; paintRestMode(); } });
    paintRestMode();
    function paintRest() {
      $('#rest-list', wrap).innerHTML = restRanges.length ? restRanges.map(function (b, i) {
        return '<span class="rest-chip">' + esc(blackoutWhen(b)) + '<button type="button" data-delrest="' + i + '" aria-label="删除">' + icon('x', 14) + '</button></span>';
      }).join('') : '<span class="muted small">暂无（例如锻炼任务可加每月经期休息）</span>';
    }
    paintRest();
    wrap.querySelector('[data-addrest]').addEventListener('click', function () {
      if (restMode === 'range') {
        var s = $('#rest-s', wrap).value, e = $('#rest-e', wrap).value;
        if (!s || !e) { toast('请选起止日期'); return; }
        if (s > e) { var t2 = s; s = e; e = t2; }
        restRanges.push({ kind: 'range', start: s, end: e }); $('#rest-s', wrap).value = ''; $('#rest-e', wrap).value = '';
      } else if (restMode === 'monthly') {
        var f = +$('#rest-mf', wrap).value, tt = +$('#rest-mt', wrap).value;
        if (!f || !tt || f < 1 || tt > 31 || f > tt) { toast('请输入有效起止日（1–31）'); return; }
        restRanges.push({ kind: 'monthly', fromDay: f, toDay: tt }); $('#rest-mf', wrap).value = ''; $('#rest-mt', wrap).value = '';
      } else {
        if (!rwdSet.length) { toast('请至少选一天'); return; }
        restRanges.push({ kind: 'weekly', weekdays: rwdSet.slice().sort(function (a, c) { return a - c; }) });
        rwdSet = []; wrap.querySelectorAll('#rest-wd button').forEach(function (b) { b.classList.remove('on'); });
      }
      paintRest();
    });
    $('#rest-list', wrap).addEventListener('click', function (e) {
      var b = e.target.closest('[data-delrest]'); if (!b) return;
      restRanges.splice(+b.dataset.delrest, 1); paintRest();
    });

    wrap.querySelector('#f-kind').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { kind = b.dataset.k; paintSeg(); } });
    wrap.querySelector('#f-dir').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { dir = b.dataset.d; paintSeg(); } });
    $('#f-rtype', wrap).addEventListener('change', paintRecur);
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    if (existing) wrap.querySelector('[data-del]').addEventListener('click', function () {
      openConfirm('删除「' + t.title + '」？相关打卡记录也会一并删除。', function () { S.deleteTask(state, task.id); render(); toast('已删除'); });
    });
    wrap.querySelector('[data-save]').addEventListener('click', function () {
      var title = $('#f-title', wrap).value.trim();
      if (!title) { toast('请填写标题'); return; }
      var rt = $('#f-rtype', wrap).value;
      var out = {
        id: existing ? task.id : null, title: title, kind: kind,
        unit: kind === 'quantitative' ? ($('#f-unit', wrap).value.trim() || null) : null,
        target: kind === 'quantitative' && $('#f-target', wrap).value !== '' ? +$('#f-target', wrap).value : null,
        direction: dir, multiAdd: kind === 'quantitative' ? $('#f-multi', wrap).checked : false,
        quickAdds: t.quickAdds || null, blackouts: restRanges, isLog: t.isLog || false, logKind: t.logKind || null, archived: false,
        recurrence: { type: rt, weekdays: wdSet.slice().sort(function (a, b) { return a - b; }), count: Math.max(1, +$('#f-count', wrap).value || 1), date: $('#f-date', wrap).value || M.todayStr() }
      };
      if (rt === 'weekdays' && !out.recurrence.weekdays.length) { toast('请至少选一天'); return; }
      S.upsertTask(state, out); closeModal(); render(); toast(existing ? '已保存' : '已添加');
    });
    openModal(wrap);
    setTimeout(function () { $('#f-title', wrap).focus(); }, 50);
  }

  // 定量·单次：记录数值（date 默认今天，也可补录任意一天）
  function openValue(task, date) {
    date = date || M.todayStr();
    var cur = M.dayCompletions(state, task.id, date);
    var v = cur.length ? M.daySum(state, task.id, date) : (task.target || '');
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="sheet-head"><b>' + esc(task.title) + '</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      '<p class="muted small">' + esc(M.kindLabel(task)) + ' · ' + date + '（可填真实值，少做/超额都行）</p>' +
      field('数值' + (task.unit ? '（' + esc(task.unit) + '）' : ''), '<input id="v-val" type="number" inputmode="decimal" value="' + v + '">') +
      '<div class="sheet-actions">' + (cur.length ? '<button class="btn danger" data-clear>清除</button>' : '<span></span>') +
      '<div><button class="btn" data-x>取消</button><button class="btn primary" data-ok>完成</button></div></div>';
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    if (cur.length) wrap.querySelector('[data-clear]').addEventListener('click', function () { S.setQuantitative(state, task, date, null); closeModal(); render(); });
    wrap.querySelector('[data-ok]').addEventListener('click', function () {
      var val = $('#v-val', wrap).value; if (val === '') { toast('请输入数值'); return; }
      var w0 = M.isTaskDoneOn(state, task, date);
      S.setQuantitative(state, task, date, +val); closeModal(); render();
      if (date === M.todayStr()) celebrate(task, date, w0); else toast('已记录');
    });
    openModal(wrap); setTimeout(function () { $('#v-val', wrap).select(); }, 50);
  }

  // 定量·多次：自定义增量
  function openCustom(task, date) {
    date = date || M.todayStr();
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="sheet-head"><b>' + esc(task.title) + ' · 自定义</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      field('增加（' + esc(task.unit || '') + '）', '<input id="c-val" type="number" inputmode="decimal" placeholder="例如 150">') +
      '<div class="sheet-actions"><span></span><div><button class="btn" data-x>取消</button><button class="btn primary" data-ok>添加</button></div></div>';
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    wrap.querySelector('[data-ok]').addEventListener('click', function () {
      var val = $('#c-val', wrap).value; if (val === '' || +val <= 0) { toast('请输入正数'); return; }
      var w0 = M.isTaskDoneOn(state, task, date);
      S.addQuantitative(state, task, date, +val); closeModal(); render();
      if (date === M.todayStr()) celebrate(task, date, w0);
    });
    openModal(wrap); setTimeout(function () { $('#c-val', wrap).focus(); }, 50);
  }

  // 睡眠记录器：上床/起床 → 自动算时长（也可直接填小时）
  function openSleepLog(task, date) {
    date = date || M.todayStr();
    var cur = M.dayCompletions(state, task.id, date);
    var curH = cur.length ? M.daySum(state, task.id, date) : '';
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="sheet-head"><b>' + esc(task.title) + ' · ' + date + '</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      '<div class="row2">' + field('上床时间', '<input id="sl-bed" type="time">') + field('起床时间', '<input id="sl-wake" type="time">') + '</div>' +
      '<p class="muted small" id="sl-calc">—</p>' +
      field('或直接填（小时）', '<input id="sl-h" type="number" inputmode="decimal" step="0.5" value="' + curH + '">') +
      (task.target ? '<p class="muted small">参考：约 ' + fmt(task.target) + ' 小时（仅供参考，不评判）</p>' : '') +
      '<div class="sheet-actions">' + (cur.length ? '<button class="btn danger" data-clear>清除</button>' : '<span></span>') +
      '<div><button class="btn" data-x>取消</button><button class="btn primary" data-ok>保存</button></div></div>';
    function calc() {
      var hh = sleepHours($('#sl-bed', wrap).value, $('#sl-wake', wrap).value);
      if (hh != null) { $('#sl-h', wrap).value = hh; $('#sl-calc', wrap).textContent = '约 ' + hh + ' 小时'; }
    }
    $('#sl-bed', wrap).addEventListener('change', calc);
    $('#sl-wake', wrap).addEventListener('change', calc);
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    if (cur.length) wrap.querySelector('[data-clear]').addEventListener('click', function () { S.setQuantitative(state, task, date, null); closeModal(); render(); });
    wrap.querySelector('[data-ok]').addEventListener('click', function () {
      var v = $('#sl-h', wrap).value; if (v === '' || +v <= 0) { toast('请填时长，或上床/起床时间'); return; }
      S.setQuantitative(state, task, date, +v); closeModal(); render(); toast('记下了，好梦 🌙');
    });
    openModal(wrap);
  }

  // 选择屏蔽方式：一次性 / 每周 / 每月
  function openBlackoutType() {
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="sheet-head"><b>屏蔽时间</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      '<p class="muted small">屏蔽期间所有任务自动放假，不计入统计。</p>' +
      '<div class="settings"><button class="setbtn" data-bt="range">选一段日期（一次性）</button>' +
      '<button class="setbtn" data-bt="weekly">每周固定几天（循环）</button>' +
      '<button class="setbtn" data-bt="monthly">每月固定日期段（循环）</button></div>';
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    wrap.querySelector('[data-bt="range"]').addEventListener('click', function () { closeModal(); ui.blackoutSel = {}; render(); toast('在日历上点开始日，再点结束日'); });
    wrap.querySelector('[data-bt="weekly"]').addEventListener('click', openWeeklyBlackout);
    wrap.querySelector('[data-bt="monthly"]').addEventListener('click', openMonthlyBlackout);
    openModal(wrap);
  }
  function openWeeklyBlackout() {
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="sheet-head"><b>每周固定休息</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      '<p class="muted small">选择每周要休息的日子（例如周末）</p><div class="seg wrap" id="wb-wd"></div>' +
      '<div class="sheet-actions"><span></span><div><button class="btn" data-x>取消</button><button class="btn primary" data-next>下一步</button></div></div>';
    var set = [], box = wrap.querySelector('#wb-wd');
    M.WD_CN.forEach(function (label, i) { var w = i + 1, b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', function () { var k = set.indexOf(w); if (k >= 0) set.splice(k, 1); else set.push(w); b.classList.toggle('on'); }); box.appendChild(b); });
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    wrap.querySelector('[data-next]').addEventListener('click', function () {
      if (!set.length) { toast('请至少选一天'); return; }
      var s = set.slice().sort(function (a, c) { return a - c; });
      openReason({ kind: 'weekly', weekdays: s }, '每周' + s.map(function (w) { return M.WD_CN[w - 1]; }).join(''));
    });
    openModal(wrap);
  }
  function openMonthlyBlackout() {
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="sheet-head"><b>每月固定休息</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      '<p class="muted small">每月这段日子自动休息（例如经期）</p>' +
      '<div class="rest-add"><span>每月</span><input id="mb-f" type="number" min="1" max="31" placeholder="从"><span>–</span><input id="mb-t" type="number" min="1" max="31" placeholder="到"><span>号</span></div>' +
      '<div class="sheet-actions"><span></span><div><button class="btn" data-x>取消</button><button class="btn primary" data-next>下一步</button></div></div>';
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    wrap.querySelector('[data-next]').addEventListener('click', function () {
      var f = +$('#mb-f', wrap).value, t = +$('#mb-t', wrap).value;
      if (!f || !t || f < 1 || t > 31 || f > t) { toast('请输入有效起止日（1–31，从≤到）'); return; }
      openReason({ kind: 'monthly', fromDay: f, toDay: t }, '每月 ' + f + '–' + t + ' 号');
    });
    openModal(wrap);
  }
  // 选择屏蔽理由并保存（spec = 不含 reason 的屏蔽形态）
  function openReason(spec, whenLabel) {
    var wrap = document.createElement('div');
    var btns = Object.keys(REASONS).map(function (k) {
      return '<button class="reason-btn" data-r="' + k + '"><i class="bdot" style="background:' + REASONS[k].color + '"></i>' + REASONS[k].label + '</button>';
    }).join('');
    wrap.innerHTML = '<div class="sheet-head"><b>屏蔽 ' + esc(whenLabel) + '</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      '<p class="muted small">这段时间所有任务自动放假：不出现、不计入达成率、不打断配额，绝不制造亏欠感。</p>' +
      '<div class="reason-grid">' + btns + '</div>' +
      '<div id="custom-label" class="hide">' + field('自定义理由', '<input id="cl-label" type="text" placeholder="例如：出差、考试周">') +
      '<div class="sheet-actions"><span></span><button class="btn primary" data-savecustom>确定</button></div></div>';
    function done(reason, label) { S.addBlackout(state, Object.assign({}, spec, { reason: reason, label: label })); ui.blackoutSel = null; closeModal(); render(); toast('已屏蔽 · ' + label); }
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', function () { ui.blackoutSel = null; closeModal(); render(); }); });
    wrap.querySelectorAll('.reason-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = b.dataset.r;
        if (r === 'custom') { $('#custom-label', wrap).classList.remove('hide'); setTimeout(function () { $('#cl-label', wrap).focus(); }, 30); return; }
        done(r, REASONS[r].label);
      });
    });
    wrap.querySelector('[data-savecustom]').addEventListener('click', function () { done('custom', $('#cl-label', wrap).value.trim() || '休息'); });
    openModal(wrap);
  }

  // 某天详情：列出当天任务，可补打卡
  function openDayDetail(date) {
    var blk = M.globalBlackoutOn(state, date);
    var dd = M.parseDate(date), wd = M.WD_CN[M.weekdayOf(date) - 1];
    function scheduledOn(t) {
      var r = t.recurrence || {};
      if (r.type === 'daily') return true;
      if (r.type === 'weekdays') return (r.weekdays || []).indexOf(M.weekdayOf(date)) >= 0;
      if (r.type === 'once') return r.date === date;
      if (r.type === 'weeklyCount' || r.type === 'monthlyCount') return true;
      return false;
    }
    function body() {
      var rows = state.tasks.filter(scheduledOn).map(function (t) {
        var done = M.isTaskDoneOn(state, t, date);
        var resting = !!blk || M.taskRestingOn(t, date);
        var extra = t.kind === 'quantitative' ? ' · ' + fmt(M.daySum(state, t.id, date)) + ' ' + esc(t.unit || '') : '';
        return '<div class="day-row" data-id="' + t.id + '">' +
          '<button class="check' + (done ? ' on' : '') + '"' + (resting ? ' disabled' : ' data-action="dtoggle"') + '>' + (done ? icon('check', 15) : '') + '</button>' +
          '<div class="task-main"><p class="task-title' + (done ? ' strike' : '') + '">' + esc(t.title) + '</p>' +
          '<p class="task-meta">' + esc(M.recurrenceLabel(t)) + extra + (resting ? ' · 休息中' : '') + '</p></div></div>';
      }).join('');
      return rows || '<p class="empty">这天没有安排</p>';
    }
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="sheet-head"><b>' + (dd.getMonth() + 1) + '月' + dd.getDate() + '日 · 周' + wd + '</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      (blk ? '<div class="blk-banner static"><i class="bdot" style="background:' + reasonColor(blk.reason) + '"></i>' + esc(reasonLabel(blk)) + ' · 这天所有任务放假</div>' : '') +
      '<div class="day-list">' + body() + '</div>';
    wrap.querySelector('[data-x]').addEventListener('click', closeModal);
    wrap.querySelector('.day-list').addEventListener('click', function (e) {
      var a = e.target.closest('[data-action="dtoggle"]'); if (!a) return;
      var row = e.target.closest('.day-row'); var t = getTask(row.dataset.id);
      if (t.kind === 'qualitative') { S.toggleQualitative(state, t, date); wrap.querySelector('.day-list').innerHTML = body(); render(); }
      else { closeModal(); openValue(t, date); }
    });
    openModal(wrap);
  }

  // ---------- 任务详情：可视化（定量柱状图 / 定性圆点 + 月度热力）----------
  function occursOn(task, date) {
    var r = task.recurrence || {};
    if (r.type === 'daily') return true;
    if (r.type === 'weekdays') return (r.weekdays || []).indexOf(M.weekdayOf(date)) >= 0;
    if (r.type === 'once') return r.date === date;
    if (r.type === 'weeklyCount' || r.type === 'monthlyCount') return true;
    return false;
  }
  function lifetimeDoneFor(task) {
    var seen = {};
    state.completions.forEach(function (c) { if (c.taskId === task.id) seen[c.date] = true; });
    return Object.keys(seen).filter(function (d) { return M.isTaskDoneOn(state, task, d); }).length;
  }
  function logDetailHTML(task) {
    var today = M.todayStr(), wk = M.weekDates(today);
    var head = '<div class="sheet-head"><b>' + esc(task.title) + '</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      '<p class="muted small">记录型 · 只看趋势，不评判</p>';
    if (task.logKind === 'sleep') {
      var vals = wk.map(function (d) { return M.daySum(state, task.id, d); });
      var recDays = wk.filter(function (d) { return M.dayCompletions(state, task.id, d).length; });
      var avg = recDays.length ? recDays.reduce(function (s, d) { return s + M.daySum(state, task.id, d); }, 0) / recDays.length : 0;
      var target = task.target || 0, H = 84;
      var maxv = Math.max(target, Math.max.apply(null, vals.concat([1])));
      var bars = wk.map(function (d, i) {
        var v = vals[i], h = v > 0 ? Math.max(3, Math.round(v / maxv * H)) : 0;
        var cls = v === 0 ? 'b-zero' : (target && v < target ? 'b-mid' : 'b-met');
        return '<div class="bcol"><span class="bval">' + (v ? fmt(v) : '') + '</span><i class="bar2 ' + cls + '" style="height:' + h + 'px"></i></div>';
      }).join('');
      var tline = target ? Math.round(target / maxv * H) : 0;
      var chart = '<div class="chart">' + (target ? '<div class="tline" style="bottom:' + tline + 'px"></div><span class="tlabel" style="bottom:' + (tline + 1) + 'px">参考 ' + fmt(target) + '</span>' : '') + '<div class="bars2">' + bars + '</div></div><div class="xrow">' + M.WD_CN.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>';
      var msg = (recDays.length && target && avg < target - 0.5) ? '<p class="muted small">最近睡得有点少，记得多歇歇 🌙</p>' : '';
      return head + '<div class="metrics"><div class="metric"><span>本周平均</span><b>' + (recDays.length ? avg.toFixed(1) : '—') + ' 小时</b></div><div class="metric"><span>本周已记</span><b>' + recDays.length + ' 天</b></div></div><div class="detail-card">' + chart + '</div>' + msg;
    }
    var counts = wk.map(function (d) { return M.dayCompletions(state, task.id, d).length; });
    var weekN = counts.reduce(function (s, c) { return s + c; }, 0);
    var monthN = M.monthDates(M.startOfMonth(today)).reduce(function (s, d) { return s + M.dayCompletions(state, task.id, d).length; }, 0);
    var lifeN = state.completions.filter(function (c) { return c.taskId === task.id; }).length;
    var maxc = Math.max.apply(null, counts.concat([1])), H2 = 84;
    var bars2 = wk.map(function (d, i) { var c = counts[i], h = c > 0 ? Math.max(3, Math.round(c / maxc * H2)) : 0; return '<div class="bcol"><span class="bval">' + (c || '') + '</span><i class="bar2 b-met" style="height:' + h + 'px"></i></div>'; }).join('');
    var chart2 = '<div class="chart"><div class="bars2">' + bars2 + '</div></div><div class="xrow">' + M.WD_CN.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>';
    return head + '<div class="metrics"><div class="metric"><span>本周</span><b>' + weekN + ' 次</b></div><div class="metric"><span>本月</span><b>' + monthN + ' 次</b></div></div><div class="detail-card">' + chart2 + '<p class="muted small center">累计 ' + lifeN + ' 次 🚀</p></div>';
  }
  function taskDetailHTML(task) {
    if (task.isLog) return logDetailHTML(task);
    var today = M.todayStr();
    var wk = M.weekDates(today);
    var p = M.periodProgress(state, task, today);
    var life = lifetimeDoneFor(task);
    var head = '<div class="sheet-head"><b>' + esc(task.title) + '</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      '<p class="muted small">' + esc(M.recurrenceLabel(task)) + ' · ' + esc(M.kindLabel(task)) + '</p>';
    var stats = '<div class="metrics"><div class="metric"><span>' + p.label + '完成</span><b>' + p.done + '/' + p.planned + '</b></div>' +
      '<div class="metric"><span>累计完成</span><b>' + life + ' 次</b></div></div>';

    if (task.kind === 'quantitative') {
      var target = task.target || 0;
      var sums = wk.map(function (d) { return M.daySum(state, task.id, d); });
      var maxv = Math.max(target, Math.max.apply(null, sums.concat([1])));
      var H = 84;
      var bars = wk.map(function (d, i) {
        var v = sums[i]; var h = v > 0 ? Math.max(3, Math.round(v / maxv * H)) : 0;
        var active = M.isActiveDay(state, task, d);
        var met = active && v > 0 && (task.direction === 'atMost' ? v <= target : v >= target);
        var cls = !active ? 'b-rest' : v === 0 ? 'b-zero' : met ? 'b-met' : 'b-mid';
        return '<div class="bcol"><span class="bval">' + (v ? fmt(v) : '') + '</span><i class="bar2 ' + cls + '" style="height:' + h + 'px"></i></div>';
      }).join('');
      var tline = target ? Math.round(target / maxv * H) : 0;
      var weekSum = sums.reduce(function (a, b) { return a + b; }, 0);
      var schedDays = wk.filter(function (d) { return occursOn(task, d) && M.isActiveDay(state, task, d); }).length;
      var chart = '<div class="chart">' + (target ? '<div class="tline" style="bottom:' + tline + 'px"></div><span class="tlabel" style="bottom:' + (tline + 1) + 'px">目标 ' + fmt(target) + '</span>' : '') +
        '<div class="bars2">' + bars + '</div></div>' +
        '<div class="xrow">' + M.WD_CN.map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>';
      var note = '<p class="muted small center">本周累计 ' + fmt(weekSum) + ' ' + esc(task.unit || '') + (target && schedDays ? ' · 目标 ' + fmt(target * schedDays) + ' ' + esc(task.unit || '') : '') + '</p>';
      return head + stats + '<div class="detail-card">' + chart + note + '</div>';
    }

    var dots = wk.map(function (d, i) {
      var sched = occursOn(task, d), active = M.isActiveDay(state, task, d), done = M.isTaskDoneOn(state, task, d);
      var cls = done ? 'dot done' : (!active ? 'dot rest' : sched ? 'dot' : 'dot off');
      return '<div class="dotcol"><span class="' + cls + '">' + (done ? icon('check', 13) : '') + '</span><span class="dotx">' + M.WD_CN[i] + '</span></div>';
    }).join('');
    var month = M.monthDates(M.startOfMonth(today));
    var lead = M.weekdayOf(month[0]) - 1, hm = '', k;
    for (k = 0; k < lead; k++) hm += '<i class="hcell off"></i>';
    month.forEach(function (d) {
      var sched = occursOn(task, d), active = M.isActiveDay(state, task, d), done = M.isTaskDoneOn(state, task, d), future = d > today;
      var cls = done ? 'done' : (!active ? 'rest' : (future || !sched) ? 'off' : 'miss');
      hm += '<i class="hcell ' + cls + '"></i>';
    });
    return head + stats +
      '<div class="detail-card"><p class="muted small">本周</p><div class="dots">' + dots + '</div></div>' +
      '<div class="detail-card"><p class="muted small">本月坚持（绿 = 完成 · 不显示连续天数，断了不掉色）</p><div class="hm">' + hm + '</div></div>';
  }
  function openTaskDetail(task) {
    var wrap = document.createElement('div');
    wrap.innerHTML = taskDetailHTML(task) +
      '<div class="sheet-actions"><button class="btn" data-edit>编辑任务</button><div><button class="btn" data-x>关闭</button></div></div>';
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    wrap.querySelector('[data-edit]').addEventListener('click', function () { closeModal(); openEditor(task); });
    openModal(wrap);
  }

  // 新建：先选模板（或空白）
  function openTemplatePicker() {
    var wrap = document.createElement('div');
    var cards = TEMPLATES.map(function (t) { return '<button class="tpl" data-tpl="' + t.key + '"><b>' + esc(t.title) + '</b><span>' + esc(t.desc || '') + '</span></button>'; }).join('');
    wrap.innerHTML = '<div class="sheet-head"><b>新建任务</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      '<button class="setbtn" data-blank>＋ 空白任务（自己设）</button>' +
      '<p class="muted small" style="margin:14px 2px 8px">或从模板快速开始</p>' +
      '<div class="tpl-grid">' + cards + '</div>';
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    wrap.querySelector('[data-blank]').addEventListener('click', function () { closeModal(); openEditor(null); });
    wrap.querySelectorAll('.tpl').forEach(function (b) {
      b.addEventListener('click', function () {
        var tpl = TEMPLATES.filter(function (x) { return x.key === b.dataset.tpl; })[0];
        if (tpl.isLog) { // 记录型直接添加，不走习惯编辑器
          var lt = Object.assign({ kind: 'qualitative', unit: null, target: null, direction: 'atLeast', multiAdd: false, quickAdds: null, blackouts: [], isLog: false, logKind: null, recurrence: { type: 'daily' }, archived: false }, tpl);
          delete lt.key; delete lt.desc; delete lt.personalize;
          if (tpl.personalize === 'sleep') lt.target = recommendSleep(state.profile).target;
          S.upsertTask(state, lt); closeModal(); render(); toast('已添加：' + tpl.title);
          return;
        }
        var prefill = JSON.parse(JSON.stringify(tpl));
        delete prefill.key; delete prefill.desc;
        var rec = tpl.personalize === 'water' ? recommendWater(state.profile) : null;
        if (rec) { prefill.target = rec.target; prefill._note = rec.note; }
        delete prefill.personalize;
        closeModal(); openEditor(prefill);
      });
    });
    openModal(wrap);
  }

  // 个人资料（用于个性化推荐）
  function openProfile() {
    var p = state.profile || {};
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="sheet-head"><b>个人资料</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      '<p class="muted small">全部可选，仅存本机。用于「喝水」等模板的个性化目标推荐。</p>' +
      field('性别', '<div class="seg" id="p-sex"><button data-s="female">女</button><button data-s="male">男</button><button data-s="">不设</button></div>') +
      '<div class="row2">' + field('体重（kg）', '<input id="p-weight" type="number" inputmode="decimal" value="' + (p.weight || '') + '">') + field('年龄', '<input id="p-age" type="number" value="' + (p.age || '') + '">') + '</div>' +
      field('运动量', '<div class="seg" id="p-act"><button data-a="low">低</button><button data-a="mid">中</button><button data-a="high">高</button></div>') +
      '<div class="sheet-actions"><span></span><div><button class="btn" data-x>取消</button><button class="btn primary" data-save>保存</button></div></div>';
    var sex = p.sex || '', act = p.activity || '';
    function paint() {
      wrap.querySelectorAll('#p-sex button').forEach(function (b) { b.classList.toggle('on', b.dataset.s === sex); });
      wrap.querySelectorAll('#p-act button').forEach(function (b) { b.classList.toggle('on', b.dataset.a === act); });
    }
    paint();
    wrap.querySelector('#p-sex').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { sex = b.dataset.s; paint(); } });
    wrap.querySelector('#p-act').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) { act = b.dataset.a; paint(); } });
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    wrap.querySelector('[data-save]').addEventListener('click', function () {
      S.setProfile(state, { sex: sex || null, weight: $('#p-weight', wrap).value !== '' ? +$('#p-weight', wrap).value : null, age: $('#p-age', wrap).value !== '' ? +$('#p-age', wrap).value : null, activity: act || null });
      closeModal(); render(); toast('已保存资料');
    });
    openModal(wrap);
  }

  function openCleanup() {
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="sheet-head"><b>清理旧记录</b><button class="iconbtn sm" data-x>' + icon('x', 18) + '</button></div>' +
      '<p class="muted small">删除较早的打卡明细，让 app 轻装上阵。<b>累计完成数会保留。</b></p>' +
      '<div class="seg col" id="cl-opts"><button data-m="3">保留最近 3 个月</button><button data-m="6">保留最近 6 个月</button><button data-m="12">保留最近 12 个月</button></div>' +
      '<div class="sheet-actions"><span></span><button class="btn" data-x>取消</button></div>';
    wrap.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', closeModal); });
    wrap.querySelector('#cl-opts').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return; var m = +b.dataset.m;
      var n = S.cleanupOlderThan(state, m); closeModal(); render(); toast(n ? ('已清理 ' + n + ' 条') : '没有更早的记录');
    });
    openModal(wrap);
  }

  function openConfirm(msg, onYes) {
    var wrap = document.createElement('div');
    wrap.innerHTML = '<p class="confirm-msg">' + esc(msg) + '</p><div class="sheet-actions"><span></span><div><button class="btn" data-x>取消</button><button class="btn danger" data-y>确定</button></div></div>';
    wrap.querySelector('[data-x]').addEventListener('click', closeModal);
    wrap.querySelector('[data-y]').addEventListener('click', function () { closeModal(); onYes(); });
    openModal(wrap);
  }

  // ---------- 备份 ----------
  function doExport() {
    var text = S.exportJSON(state);
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'planloop-backup-' + M.todayStr() + '.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出备份');
  }
  function doImport() {
    var input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json,.json';
    input.onchange = function () {
      var f = input.files[0]; if (!f) return; var r = new FileReader();
      r.onload = function () { try { state = S.importJSON(r.result); render(); toast('已导入'); } catch (e) { toast('导入失败：文件格式不对'); } };
      r.readAsText(f);
    };
    input.click();
  }

  // ---------- 初始化 ----------
  function init() {
    document.getElementById('view').addEventListener('click', onViewClick);
    Array.prototype.forEach.call(document.querySelectorAll('.tabbtn'), function (b) {
      b.addEventListener('click', function () { tab = b.dataset.tab; ui.doneOpen = false; ui.blackoutSel = null; render(true); });
    });
    render();
    if ('serviceWorker' in navigator) { navigator.serviceWorker.register('./service-worker.js').catch(function () {}); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof globalThis !== 'undefined' ? globalThis : this);

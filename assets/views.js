/* 视图层：把状态渲染成 HTML，并挂载交互 */
(function (global) {
  'use strict';

  var S = global.Store;
  var C = global.Charts;

  /* 下拉箭头在几个控件里出现，形状只写一份 */
  var CHEVRON = '<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.4 3.8L5 6.4l2.6-2.6"/></svg>';

  var ICONS = {
    overview: '<rect x="2.2" y="2.2" width="5" height="5" rx="1.2"/><rect x="8.8" y="2.2" width="5" height="5" rx="1.2"/><rect x="2.2" y="8.8" width="5" height="5" rx="1.2"/><rect x="8.8" y="8.8" width="5" height="5" rx="1.2"/>',
    subjects: '<path d="M2 12.2l3.4-3.8 2.9 2.4L14 4.6"/><path d="M2 14.2h12"/>',
    compare: '<rect x="2.4" y="8.6" width="4" height="5.6" rx="1.1"/><rect x="9.6" y="2.6" width="4" height="11.6" rx="1.1"/>',
    exams: '<path d="M3 4.2h10M3 8h10M3 11.8h6.2"/>',
    settings: '<path d="M2 5h5M11.5 5H14M2 11h2.5M9 11h5"/><circle cx="9.2" cy="5" r="1.8"/><circle cx="6.7" cy="11" r="1.8"/>'
  };

  function icon(name, size) {
    return '<svg class="ico" width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  /* 内嵌进 script 标签的 JSON：尖括号转成转义序列，
     否则名称里的 </script> 会提前结束标签，剩下的内容当成 HTML 解析 */
  function embedJSON(value) {
    return JSON.stringify(value)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026');
  }

  /* 差值的三种颜色；没有可比的数据时用 muted */
  function deltaClass(n) {
    if (n === null || n === undefined || isNaN(n)) return 'muted';
    return n > 0 ? 'good' : n < 0 ? 'bad' : 'flat';
  }

  /* 一块指标格，四个页面共用同一个结构 */
  function kpiCell(o) {
    return '<div class="kpi">' +
      '<span class="kpi-label">' + o.label + '</span>' +
      (o.state || '') +
      '<span class="kpi-value num' + (o.valueClass ? ' ' + o.valueClass : '') + '"' +
      (o.id ? ' id="' + o.id + '"' : '') + '>' + o.value + '</span>' +
      '<span class="kpi-unit">' + (o.unit || '') + '</span>' +
      '<span class="kpi-foot">' + (o.foot || '') + '</span>' +
      '</div>';
  }

  function kpiStrip(cells) {
    return '<div class="kpi-strip" style="--kpi-cols:' + cells.length + '">' + cells.join('') + '</div>';
  }

  function shortMd(iso) {
    if (!iso) return '—';
    var p = String(iso).split('-');
    return p.length >= 3 ? Number(p[1]) + '/' + Number(p[2]) : iso;
  }

  /* 脚注里指代上一场考试：用名字，带学期前缀的只留后面那一段 */
  function examLabel(exam) {
    var text = String((exam && exam.name) || '').trim();
    if (!text) return exam && exam.date ? shortMd(exam.date) : '上一场';
    var parts = text.split(/\s*[·・]\s*/).filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 1] : text;
  }

  /* 名字太长就省略，鼠标停上去能看全称 */
  function examTag(exam) {
    var label = examLabel(exam);
    var full = String((exam && exam.name) || '').trim() || label;
    return '<span class="kpi-exam" title="' + S.esc(full) + '">' + S.esc(label) + '</span>';
  }

  function weekday(iso) {
    var names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    var d = S.parseISO(iso);
    return d ? names[d.getDay()] : '';
  }

  function rankWord(delta) {
    if (delta === null || delta === undefined || isNaN(delta)) return { text: '—', cls: 'flat' };
    if (delta === 0) return { text: '持平', cls: 'flat' };
    /* 排名数值变小 = 名次上升 */
    return delta < 0
      ? { text: '↑ ' + Math.abs(delta), cls: 'good' }
      : { text: '↓ ' + Math.abs(delta), cls: 'bad' };
  }

  /* ---- 自建下拉与日期控件 ---- */

  /* 表单里能选到的类型：配置里的，加上这场自己带的 */
  function typesOf(config, exam) {
    var list = (config.types || []).slice();
    if (exam && exam.type && list.indexOf(exam.type) < 0) list.push(exam.type);
    if (!list.length) list = [S.DEFAULT_TYPE];
    return list;
  }

  function selectHTML(options, value, attrs) {
    var opts = options.map(function (o) {
      return '<button type="button" class="sel-opt' + (o === value ? ' is-on' : '') + '" role="option" aria-selected="' + (o === value) + '" data-value="' + S.esc(o) + '">' + S.esc(o) + '</button>';
    }).join('');
    var current = options.indexOf(value) >= 0 ? value : options[0];
    return '<div class="sel" data-value="' + S.esc(current) + '"' + (attrs || '') + '>' +
      '<button type="button" class="sel-btn" aria-haspopup="listbox" aria-expanded="false">' +
      '<span class="sel-text">' + S.esc(current) + '</span>' +
      CHEVRON +
      '</button>' +
      '<div class="sel-pop" role="listbox" hidden>' + opts + '</div>' +
      '</div>';
  }

  /* 考试选择器：选项显示日期 + 名称 */
  function examSelectHTML(list, value, attrs) {
    var opts = list.map(function (e) {
      return '<button type="button" class="sel-opt' + (e.id === value ? ' is-on' : '') + '" role="option" aria-selected="' + (e.id === value) + '" data-value="' + S.esc(e.id) + '" data-label="' + S.esc(e.name) + '">' +
        '<span class="opt-date num">' + S.esc(e.date) + '</span>' + S.esc(e.name) + '</button>';
    }).join('');
    var current = list.find(function (e) { return e.id === value; }) || list[0];
    return '<div class="sel sel-wide" data-value="' + S.esc(current ? current.id : '') + '"' + (attrs || '') + '>' +
      '<button type="button" class="sel-btn" aria-haspopup="listbox" aria-expanded="false">' +
      '<span class="sel-text">' + S.esc(current ? current.name : '') + '</span>' +
      '<svg class="sel-arrow" width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.4 3.8L5 6.4l2.6-2.6"/></svg>' +
      '</button>' +
      '<div class="sel-pop" role="listbox" hidden>' + opts + '</div>' +
      '</div>';
  }

  function dateHTML(iso, id) {
    var arrowL = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.6 3.6L5.2 8l4.4 4.4"/></svg>';
    var arrowR = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.4 3.6L10.8 8l-4.4 4.4"/></svg>';
    return '<div class="datep" data-value="' + S.esc(iso) + '"' + (id ? ' id="' + id + '"' : '') + '>' +
      '<button type="button" class="date-btn" aria-haspopup="dialog" aria-expanded="false">' +
      '<span class="date-text"></span>' +
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">' +
      '<rect x="2.2" y="3.4" width="11.6" height="10.4" rx="1.6"/><path d="M2.2 6.6h11.6M5.4 2v2.2M10.6 2v2.2"/></svg>' +
      '</button>' +
      '<div class="cal-pop" role="dialog" aria-label="选择日期" hidden>' +
      '<div class="cal-head">' +
      '<button type="button" class="cal-nav" data-step="-1" aria-label="上一页">' + arrowL + '</button>' +
      '<button type="button" class="cal-title-btn" aria-label="切换年月">' +
      '<span class="cal-title"></span>' + CHEVRON +
      '</button>' +
      '<button type="button" class="cal-nav" data-step="1" aria-label="下一页">' + arrowR + '</button>' +
      '</div>' +
      '<div class="cal-type-row"><input class="cal-type num" type="text" inputmode="numeric" placeholder="2026-11-05" aria-label="直接输入日期"></div>' +
      '<div class="cal-panel" data-panel="day">' +
      '<div class="cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>' +
      '<div class="cal-grid"></div>' +
      '</div>' +
      '<div class="cal-panel" data-panel="month" hidden><div class="cal-months"></div></div>' +
      '<div class="cal-panel" data-panel="year" hidden><div class="cal-years"></div></div>' +
      '<div class="cal-foot"><button type="button" class="cal-today" data-today>回到今天</button></div>' +
      '</div>' +
      '</div>';
  }

  /* ================= 侧栏 ================= */

  function themeToggleHTML() {
    return '  <button type="button" class="theme-toggle" id="themeToggle">' +
      '    <svg class="ico" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '      <path class="theme-moon" d="M13.4 9.6A5.6 5.6 0 1 1 6.4 2.6 4.4 4.4 0 0 0 13.4 9.6Z"/>' +
      '      <g class="theme-sun"><circle cx="8" cy="8" r="2.8"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"/></g>' +
      '    </svg>' +
      '    <span class="theme-label">深色</span>' +
      '  </button>';
  }

  function sidebar(state, active) {
    var list = S.sorted(state);
    var last = list.length ? list[list.length - 1] : null;
    var total = last ? S.examTotal(state, last) : 0;
    var goal = S.targetTotal(state);
    var pct = goal ? Math.max(0, Math.min(100, (total / goal) * 100)) : 0;
    var gap = goal - total;

    var nav = [
      { id: 'overview', label: '总览' },
      { id: 'subjects', label: '单科分析' },
      { id: 'compare', label: '两次对比' },
      { id: 'exams', label: '考试记录' },
      { id: 'settings', label: '设置' }
    ];

    return '' +
      '<aside class="side" id="sidebar">' +
      '  <div class="brand">' +
      '    <svg class="brand-mark" width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '      <path d="M2.4 15.2 L7 8.6 L11.2 11.4 L17.6 3.4"/>' +
      '      <circle cx="17.6" cy="3.4" r="1.9" fill="currentColor" stroke="none"/>' +
      '    </svg>' +
      '    <div class="brand-text"><span class="brand-name">成迹</span><span class="brand-scope">' + S.esc(state.config.className) + '</span></div>' +
      '  </div>' +
      '  <nav class="nav" aria-label="主导航">' +
      nav.map(function (item) {
        return '<a class="nav-item' + (item.id === active ? ' is-active' : '') + '" href="#/' + S.esc(item.id) + '">' +
          icon(item.id) + '<span>' + item.label + '</span></a>';
      }).join('') +
      '  </nav>' +
      '  <div class="goal-block">' +
      '    <div class="goal-top"><span class="goal-label">目标分数线</span><span class="goal-value num">' + goal + '</span></div>' +
      '    <div class="goal-track"><div class="goal-fill" style="--pct:' + pct.toFixed(1) + '%"></div></div>' +
      '    <div class="goal-foot num">' + (last ? '最近 ' + total + ' 分' : '还没有记录') + (last && gap > 0 ? ' · 差 ' + gap + ' 分' : last ? ' · 已达标' : '') + '</div>' +
      '  </div>' +
      (S.themeToggleOn() ? themeToggleHTML() : '') +
      '</aside>' +
      '<div class="mobile-bar">' +
      '  <div class="mobile-brand">成迹</div>' +
      '  <button class="icon-btn" id="navToggle" aria-label="打开导航" aria-expanded="false">' +
      '    <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2 4.5h12M2 8h12M2 11.5h12"/></svg>' +
      '  </button>' +
      '</div>';
  }

  /* ================= 总览 ================= */

  function emptyState() {
    return '' +
      '<header class="page-head">' +
      '  <div><h1>总览</h1><p class="page-sub">还没有任何成绩记录。记录第一次考试之后，这里会生成走势、名次和差距。</p></div>' +
      '  <button class="btn btn-primary" data-action="new-exam">记录一次考试</button>' +
      '</header>' +
      '<div class="block-empty">' +
      '  <p>第一次记录只需要考试名称、日期和各科分数，之后每次录入都会自动接到走势后面。</p>' +
      '  <button class="btn btn-primary" data-action="new-exam">记录一次考试</button>' +
      '</div>';
  }

  function overview(state) {
    var list = S.sorted(state);
    if (!list.length) return emptyState();

    var last = list[list.length - 1];
    var prev = list.length > 1 ? list[list.length - 2] : null;
    var total = S.examTotal(state, last);
    var full = S.fullTotal(state);
    var goal = S.targetTotal(state);
    var gap = goal - total;
    var diff = S.changeSince(state, last);
    var rows = S.subjectRows(state, last);
    var rankClass = Number(last.ranks.class) || null;
    var rankGrade = Number(last.ranks.grade) || null;
    var goalGrade = Number(state.config.targetRankGrade) || null;
    var goalClass = Number(state.config.targetRankClass) || null;

    /* KPI：没填名次的那几格整块不出，每格右上角给一句判断 */
    var ins = S.insight(state);
    var road = S.pace(state);
    var kpiCells = [];

    function stateTag(s) {
      return s ? '<span class="kpi-state is-' + s.tone + '">' + S.esc(s.text) + '</span>' : '';
    }

    kpiCells.push(kpiCell({
      label: '总分',
      state: stateTag(ins && ins.totalState),
      id: 'kpiTotal',
      value: total,
      unit: '/ ' + full,
      foot: (diff ? '<em class="delta ' + deltaClass(diff.total) + ' num">' + S.signed(diff.total) + '</em> 较 ' + examTag(prev) : '首次记录') +
        ' · 得分率 ' + S.pctText(S.rate(total, full))
    }));

    var gradeSize = Number(state.config.gradeSize) || 0;
    var classSize = Number(state.config.classSize) || 0;

    if (rankGrade) {
      kpiCells.push(kpiCell({
        label: '年级排名',
        state: stateTag(ins && ins.gradeState),
        id: 'kpiGrade',
        value: rankGrade,
        unit: '/ ' + gradeSize,
        foot: (diff && prev.ranks.grade ? '<em class="delta ' + deltaClass(diff.gradeRank) + '">' + rankWord(diff.gradeRank).text + '</em> 较 ' + examTag(prev) : '首次记录') +
          (gradeSize ? ' · 前 ' + Math.round((rankGrade / gradeSize) * 100) + '%' : '') +
          (goalGrade ? ' · 目标 ' + goalGrade : '')
      }));
    }

    if (rankClass) {
      kpiCells.push(kpiCell({
        label: '班级排名',
        state: stateTag(ins && ins.classState),
        id: 'kpiClass',
        value: rankClass,
        unit: '/ ' + classSize,
        foot: (diff && prev.ranks.class ? '<em class="delta ' + deltaClass(diff.classRank) + '">' + rankWord(diff.classRank).text + '</em> 较 ' + examTag(prev) : '首次记录') +
          (classSize ? ' · 前 ' + Math.round((rankClass / classSize) * 100) + '%' : '') +
          (goalClass ? ' · 目标 ' + goalClass : '')
      }));
    }

    kpiCells.push(kpiCell({
      label: '距目标',
      state: stateTag(ins && ins.gapState),
      id: 'kpiGap',
      valueClass: gap <= 0 ? 'is-hit' : 'is-gap',
      value: gap > 0 ? gap : Math.abs(gap),
      unit: gap > 0 ? '分' : '分超出',
      foot: '目标 ' + goal + ' 分' + (gap <= 0 ? ' · 已跨过' : ' · 已完成 ' + Math.min(100, Math.round((total / goal) * 100)) + '%')
    }));

    var kpi = kpiStrip(kpiCells);

    /* 主图：没有名次数据就不出那两档 */
    var hasGrade = list.some(function (e) { return Number(e.ranks.grade); });
    var hasClass = list.some(function (e) { return Number(e.ranks.class); });

    var trendCard = '' +
      '<section class="card card-trend">' +
      '  <div class="card-head">' +
      '    <div class="card-title-wrap"><h2 class="card-title" id="trendTitle">总分走势</h2><p class="card-sub" id="trendSub">共 ' + list.length + ' 次考试，虚线是目标分数线</p></div>' +
      '    <div class="seg seg-metric" role="group" aria-label="显示指标">' +
      '      <button class="seg-btn is-on" data-metric="total">总分</button>' +
      '      <button class="seg-btn" data-metric="rate">得分率</button>' +
      (hasGrade ? '      <button class="seg-btn" data-metric="grade">年级名次</button>\n' : '') +
      (hasClass ? '      <button class="seg-btn" data-metric="classRank">班级名次</button>\n' : '') +
      '    </div>' +
      '  </div>' +
      '  <div class="chart-wrap" id="trendChart"></div>' +
      '  <div class="chart-foot">' +
      '    <span class="chart-note num" id="chartNote">' + list.length + ' 次记录</span>' +
      '    <div class="seg seg-sm" role="group" aria-label="显示范围">' +
      '      <button class="seg-btn is-on" data-range="all">全部</button>' +
      '      <button class="seg-btn" data-range="term">本学期</button>' +
      '      <button class="seg-btn" data-range="recent">最近 6 次</button>' +
      '    </div>' +
      '  </div>' +
      '</section>';

    /* 右栏：考试记录 */
    var recent = list.slice(-4).reverse();
    function recordRow(exam, i) {
      var t = S.examTotal(state, exam);
      var idx = list.findIndex(function (e) { return e.id === exam.id; });
      var before = idx > 0 ? S.examTotal(state, list[idx - 1]) : null;
      var d = before === null ? null : t - before;
      return '<a class="record" href="#/exam/' + S.esc(exam.id) + '">' +
        '<span class="record-main"><span class="record-name">' + S.esc(exam.name) + '</span>' +
        '<span class="record-meta">' + S.esc(exam.date) + (Number(exam.ranks.grade) ? ' · 年级 ' + exam.ranks.grade : '') + '</span></span>' +
        '<span class="record-side"><span class="record-total num">' + t + '</span>' +
        '<span class="record-delta num ' + (d > 0 ? 'good' : d < 0 ? 'bad' : 'flat') + '">' + (d === null ? '首次' : S.signed(d)) + '</span></span>' +
        '</a>';
    }
    var records = '' +
      '<section class="card card-records">' +
      '  <div class="card-head"><h2 class="card-title">考试记录</h2><a class="text-link" href="#/exams">全部 ' + list.length + ' 次</a></div>' +
      '  <div class="record-list">' + recent.map(recordRow).join('') + '</div>' +
      '</section>';

    /* 各科对照 */
    var bullets = rows.map(function (r) {
      var hit = r.score !== null && r.target ? r.score >= r.target : false;
      return {
        label: r.subject.name,
        valueText: r.score === null ? '—' : r.score + ' / ' + r.full,
        rate: r.rate === null ? 0 : r.rate,
        targetRate: r.targetRate,
        hit: hit,
        note: r.gap === null ? '' : (r.gap >= 0 ? '超目标 ' + r.gap : '差 ' + Math.abs(r.gap)),
        noteHit: hit
      };
    });

    var subjectsCard = '' +
      '<section class="card card-subjects">' +
      '  <div class="card-head">' +
      '    <div class="card-title-wrap"><h2 class="card-title">各科对照</h2><p class="card-sub">横条是本次得分率，竖线是该科目标；蓝条过线，灰条还差一点</p></div>' +
      '    <a class="text-link" href="#/subjects">逐科分析</a>' +
      '  </div>' +
      '  <div id="subjectBullets"></div>' +
      '</section>';

    /* 强弱 */
    var bestRow = rows.slice().filter(function (r) { return r.rate !== null; }).sort(function (a, b) { return b.rate - a.rate; })[0];
    var worstRow = rows.slice().filter(function (r) { return r.rate !== null; }).sort(function (a, b) { return a.rate - b.rate; })[0];

    var peers = S.examVsPeers(state, last);
    var spread = S.subjectSpread(state, last);
    var smooth = S.smoothMovers(state);

    /* 偏科这两年在收敛还是在扩大 */
    var spreadTrend = (function () {
      var hist = S.spreadHistory(state);
      if (hist.length < 3) return '';
      var first = hist[0].sd;
      var lastSd = hist[hist.length - 1].sd;
      var d = lastSd - first;
      if (Math.abs(d) < 0.5) return '一直在 ' + lastSd.toFixed(1) + ' 附近';
      return d < 0
        ? '从 ' + first.toFixed(1) + ' 收到 ' + lastSd.toFixed(1)
        : '从 ' + first.toFixed(1) + ' 扩到 ' + lastSd.toFixed(1);
    })();

    /* 和平均分、最高分的距离 */
    var peerRows = '';
    if (peers.vsClass !== null) {
      peerRows += '<div class="analysis-row">' +
        '<span class="analysis-label">班级平均</span>' +
        '<span class="analysis-value num">' + peers.classAvg + '<em class="' + (peers.vsClass >= 0 ? 'good' : 'bad') + '"> ' + S.signed(peers.vsClass) + '</em></span></div>';
    }
    if (peers.vsGrade !== null) {
      peerRows += '<div class="analysis-row">' +
        '<span class="analysis-label">年级平均</span>' +
        '<span class="analysis-value num">' + peers.gradeAvg + '<em class="' + (peers.vsGrade >= 0 ? 'good' : 'bad') + '"> ' + S.signed(peers.vsGrade) + '</em></span></div>';
    }
    if (peers.toTop !== null) {
      peerRows += '<div class="analysis-row">' +
        '<span class="analysis-label">年级最高</span>' +
        '<span class="analysis-value num">' + peers.top + '<em class="muted"> 距 ' + peers.toTop + '</em></span></div>';
    }

    var hasPeers = peers.vsClass !== null || peers.vsGrade !== null || peers.toTop !== null;

    var analyseCard = '' +
      '<section class="card card-analysis">' +
      (hasPeers
        ? '  <div class="card-head"><h2 class="card-title">这次的位置</h2></div>' +
          '  <div class="analysis">' + peerRows + '</div>' +
          (peers.diagnosis ? '  <p class="diagnosis is-' + peers.diagnosis.tone + '">' + S.esc(peers.diagnosis.text) + '</p>' : '') +
          '  <div class="analysis-gap"></div>' +
          '  <div class="card-head card-head-tight"><h2 class="card-title">强弱与偏科</h2>' +
          (spread ? '<span class="card-meta">' + spread.level.text + '</span>' : '') + '</div>'
        : '  <div class="card-head"><h2 class="card-title">强弱与偏科</h2>' +
          (spread ? '<span class="card-meta">' + spread.level.text + '</span>' : '') + '</div>') +
      '  <div class="analysis">' +
      '    <div class="analysis-row">' +
      '      <span class="analysis-label">最强一科</span>' +
      '      <span class="analysis-value">' + (bestRow ? S.esc(bestRow.subject.name) + ' <em class="num">' + (bestRow.rate * 100).toFixed(1) + '%</em>' : '—') + '</span>' +
      '    </div>' +
      '    <div class="analysis-row">' +
      '      <span class="analysis-label">最弱一科</span>' +
      '      <span class="analysis-value">' + (worstRow ? S.esc(worstRow.subject.name) + ' <em class="num">' + (worstRow.rate * 100).toFixed(1) + '%</em>' : '—') + '</span>' +
      '    </div>' +
      '    <div class="analysis-row">' +
      '      <span class="analysis-label">科间差距</span>' +
      '      <span class="analysis-value">' + (spread ? '<em class="num">' + spread.spread.toFixed(1) + '</em> 个百分点' : '—') + '</span>' +
      '    </div>' +
      (smooth.up.length
        ? '    <div class="analysis-row">' +
          '      <span class="analysis-label">三场进步</span>' +
          '      <span class="analysis-value">' + S.esc(smooth.up[0].subject.name) + ' <em class="num good">' + S.signed(smooth.up[0].delta) + '</em></span>' +
          '    </div>'
        : '') +
      (smooth.down.length
        ? '    <div class="analysis-row">' +
          '      <span class="analysis-label">三场回落</span>' +
          '      <span class="analysis-value">' + S.esc(smooth.down[0].subject.name) + ' <em class="num ' + (smooth.down[0].delta < 0 ? 'bad' : '') + '">' + S.signed(smooth.down[0].delta) + '</em></span>' +
          '    </div>'
        : '') +
      '    <div class="analysis-row">' +
      '      <span class="analysis-label">及格 / 优秀</span>' +
      '      <span class="analysis-value num">' + (spread ? spread.pass + ' / ' + spread.good + ' 科' : '—') + '</span>' +
      '    </div>' +
      (spreadTrend
        ? '    <div class="analysis-row">' +
          '      <span class="analysis-label">偏科趋势</span>' +
          '      <span class="analysis-value">' + spreadTrend + '</span>' +
          '    </div>'
        : '') +
      '  </div>' +
      '  <p class="analysis-note">' + buildNote(state, rows, gap) + '</p>' +
      '</section>';

    /* 各类型的表现放在一起比，能看出大考和小考到底谁更稳 */
    var byType = S.typeStats(state);
    var typeCard = '';
    if (byType.length > 1) {
      var topAvg = byType[0].avg;
      var lowAvg = byType[byType.length - 1].avg;
      typeCard = '<section class="card card-types">' +
        '  <div class="card-head"><h2 class="card-title">各类型考得怎么样</h2>' +
        '    <span class="card-meta num">' + byType.length + ' 种</span></div>' +
        '  <div class="type-bars">' +
        byType.map(function (g) {
          /* 把差距拉开，不然四条几乎一样长看不清 */
          var span = topAvg - lowAvg || 1;
          var w = (34 + ((g.avg - lowAvg) / span) * 66) / 100;
          return '<div class="type-bar-row">' +
            '<span class="type-bar-name">' + S.esc(g.type) + '</span>' +
            '<span class="type-bar-track"><span class="type-bar-fill" style="--w:' + w.toFixed(3) + '"></span></span>' +
            '<span class="type-bar-val num">' + g.avg.toFixed(0) + '</span>' +
            '<span class="type-bar-count num">' + g.count + ' 次</span>' +
            '</div>';
        }).join('') +
        '  </div>' +
        (byType.length > 1
          ? '<p class="analysis-note">最高的是' + S.esc(byType[0].type) + '，平均 ' + topAvg.toFixed(0) +
            ' 分；最低的是' + S.esc(byType[byType.length - 1].type) + '，平均 ' + lowAvg.toFixed(0) +
            ' 分，相差 ' + (topAvg - lowAvg).toFixed(0) + ' 分。</p>'
          : '') +
        '</section>';
    }

    /* 先补哪一科，以及补一科能换来什么 */
    var prio = S.priority(state, last);
    var leverSubject = prio.length ? prio[0].subject : null;
    var lever = leverSubject ? S.sensitivity(state, leverSubject.id, 10) : null;
    var prioCard = prio.length
      ? '<section class="card card-priority">' +
        '  <div class="card-head"><h2 class="card-title">先补哪一科</h2></div>' +
        '  <div class="analysis">' +
        prio.slice(0, 3).map(function (x) {
          return '<div class="analysis-row">' +
            '<span class="analysis-label">' + S.esc(x.subject.name) + '</span>' +
            '<span class="analysis-value">缺 <em class="num">' + x.gap + '</em> 分<span class="prio-sub num"> · ' + (x.gapRate * 100).toFixed(0) + '%</span></span>' +
            '</div>';
        }).join('') +
        '  </div>' +
        (lever
          ? '  <p class="analysis-note">' + S.esc(lever.subject.name) + ' 再多考 10 分，总分到 ' + lever.after +
            (lever.rankAfter ? '，年级大约进 ' + Math.max(0, lever.rankDelta) + ' 名' : '') + '。</p>'
          : '') +
        '</section>'
      : '';

    /* 本学期还会走到哪 */
    var term = S.termForecast(state);
    var termLine = term
      ? (Math.abs(Math.round(term.next) - Math.round(term.end)) < 1
        ? '按' + term.term + '这几场的速度，下次和学期末都大约 ' + Math.round(term.next) + ' 分'
        : '按' + term.term + '这几场的速度，下次大约 ' + Math.round(term.next) + ' 分，学期末大约 ' + Math.round(term.end) + ' 分')
      : '';

    return '' +
      '<header class="page-head">' +
      '  <div><h1>总览</h1><p class="page-sub">' + S.esc(last.name) + ' · ' + S.cnDate(last.date) + ' ' + weekday(last.date) + '</p></div>' +
      '  <div class="head-actions">' +
      '    <button class="btn btn-primary" data-action="new-exam">记录一次考试</button>' +
      '  </div>' +
      '</header>' +
      (ins && ins.headlines.length ? '<p class="verdict">' + ins.headlines.map(S.esc).join('，') + '</p>' : '') +
      (road && road.predict !== null
        ? '<p class="verdict-sub">' + (termLine ? termLine + '；按最近六次算，' : '按最近六次的速度，') + '下次大约 ' + Math.round(road.predict) + ' 分' +
          (road.needPerExam !== null
            ? '；剩 ' + road.remaining + ' 场，每场要涨 ' + (road.needPerExam > 0 ? road.needPerExam.toFixed(1) : '0') + ' 分才够' +
              (road.onTrack ? '，现在的速度跟得上' : '，现在的速度还不够')
            : '') + '</p>'
        : '') +
      kpi +
      '<div class="grid-main">' +
      '  <div class="col-main">' + trendCard + '</div>' +
      '  <div class="col-rail">' + records + '</div>' +
      '  <div class="col-main">' + subjectsCard + '</div>' +
      '  <div class="col-rail">' + analyseCard + '</div>' +
      '  <div class="col-main">' + typeCard + '</div>' +
      '  <div class="col-rail">' + prioCard + '</div>' +
      '</div>' +
      '<script type="application/json" id="chartData">' + embedJSON(chartSeries(state, list)) + '</script>' +
      '<script type="application/json" id="bulletData">' + embedJSON(bullets) + '</script>';
  }

  /* 走势图需要的全部指标，一次算好交给前端 */
  function chartSeries(state, list) {
    var full = S.fullTotal(state);
    var goal = S.targetTotal(state);
    return {
      exams: list.map(function (e) {
        var total = S.examTotal(state, e);
        return {
          id: e.id,
          name: e.name,
          date: e.date,
          /* 轴标签用考试类型，两个字，挤得下更多场；完整名称在悬停提示里 */
          label: String(e.type || '').trim() || S.DEFAULT_TYPE,
          dateLabel: shortMd(e.date),
          ts: S.dateTs(e.date),
          total: total,
          rate: full ? (total / full) * 100 : null,
          grade: Number(e.ranks.grade) || null,
          classRank: Number(e.ranks.class) || null
        };
      }),
      target: {
        total: goal,
        rate: full ? (goal / full) * 100 : null,
        grade: Number(state.config.targetRankGrade) || null,
        classRank: Number(state.config.targetRankClass) || null
      },
      forecast: (function () {
        var p = S.pace(state);
        if (!p || p.predict === null || p.slope === null) return null;
        return { value: Math.round(p.predict), label: '下次约 ' + Math.round(p.predict) };
      })(),
      bands: S.semesterBands(state)
    };
  }

  function buildSubjectNote(state, stats, subject, target) {
    if (!stats.count) return '还没有这科的记录。';
    if (stats.count === 1) return '只考过一次，还看不出走势。';
    var diff = stats.last.score - target;
    var trend = stats.slope >= 0.4 ? '一直在往上走' : stats.slope <= -0.4 ? '在往下掉' : '基本平着走';
    var volatility = stats.sdRate > 0.055 ? '，起伏偏大' : stats.sdRate < 0.028 ? '，很稳' : '';
    return '这一科' + trend + volatility + '。' +
      (diff > 0 ? '最近一次高出目标 ' + diff + ' 分。' : diff === 0 ? '最近一次刚好达到目标。' : '最近一次离目标还差 ' + Math.abs(diff) + ' 分。');
  }

  function buildNote(state, rows, gap) {
    var filled = rows.filter(function (r) {
      return r.score !== null && r.score !== undefined && !isNaN(Number(r.score));
    });
    if (!filled.length) return '这一场还没有填分数。';

    /* 没填的科目不算达标，也不该被当成缺口 */
    var missing = rows.length - filled.length;
    var lack = missing ? '，另有 ' + missing + ' 科没填' : '';
    var weak = filled.filter(function (r) { return r.gap !== null && r.gap < 0; })
      .sort(function (a, b) { return a.gap - b.gap; });

    if (!weak.length) {
      return (missing ? '填了的 ' + filled.length + ' 科都站上目标线' : '全部科目都已站上目标线') + lack + '。';
    }
    var top = weak[0];
    var loss = Math.abs(top.gap);
    if (gap > 0) {
      return '离目标还差 ' + gap + ' 分' + lack + '，其中 ' + S.esc(top.subject.name) + ' 差 ' + loss + ' 分，是缺口最大的一科。';
    }
    return '总分已过目标线，' + S.esc(top.subject.name) + ' 还差 ' + loss + ' 分，是唯一没达标的科目' + lack + '。';
  }

  /* ================= 单科分析 ================= */

  /* 一科的 KPI、走势卡、统计卡、表格，切科时只换这几块 */
  function subjectParts(state, active) {
    var list = S.sorted(state);
    var stats = S.subjectStats(state, active.id);
    var lastExam = list[list.length - 1];
    var lastScore = Number(lastExam.scores[active.id]);
    var target = Number(active.target) || 0;
    var rateNow = isNaN(lastScore) ? null : S.rate(lastScore, active.full);

    var points = stats.series.map(function (p) {
      return {
        label: shortMd(p.exam.date),
        full: S.cnDate(p.exam.date) + ' · ' + p.exam.name,
        value: p.score,
        sub: '满分 ' + p.full,
        ts: S.dateTs(p.exam.date)
      };
    });

    var rankNow = S.subjectRankOf(state, lastExam, active.id);
    var classAvg = Number((lastExam.subjectAverages || {})[active.id]) || null;
    var vsAvg = classAvg === null || isNaN(lastScore) ? null : lastScore - classAvg;
    var avgText = classAvg === null
      ? '得分率 ' + (rateNow === null ? '—' : S.pctText(rateNow))
      : '班平 ' + classAvg + ' <em class="' + (vsAvg >= 0 ? 'good' : 'bad') + '">' + S.signed(vsAvg) + '</em>';

    var kpiCells = [
      kpiCell({
        label: '本次得分',
        state: rankNow ? '<span class="kpi-state is-flat">' + S.esc(rankNow.label) + '</span>' : '',
        value: isNaN(lastScore) ? '—' : lastScore,
        unit: '/ ' + active.full,
        foot: avgText
      }),
      kpiCell({
        label: '历次平均',
        value: stats.mean.toFixed(1),
        unit: '分',
        foot: '共 ' + stats.count + ' 次记录'
      }),
      kpiCell({
        label: '波动',
        value: '±' + stats.sd.toFixed(1),
        unit: '分',
        foot: stats.flips >= 3 ? '来回跳 ' + stats.flips + ' 次' : stats.sd < 4 ? '很稳' : stats.sd < 8 ? '正常起伏' : '起伏偏大'
      }),
      kpiCell({
        label: '距目标',
        valueClass: isNaN(lastScore) ? '' : lastScore >= target ? 'is-hit' : '',
        value: isNaN(lastScore) ? '—' : Math.abs(lastScore - target),
        unit: isNaN(lastScore) ? '' : lastScore >= target ? '分超出' : '分',
        foot: '目标 ' + target + ' 分'
      })
    ];

    var kpiItems = kpiCells.join('');
    var kpi = kpiStrip(kpiCells);

    var chartCard = '' +
      '<section class="card card-chart">' +
      '  <div class="card-head">' +
      '    <div class="card-title-wrap"><h2 class="card-title" id="subjectChartTitle">' + S.esc(active.name) + '走势</h2><p class="card-sub">每次考试的得分，虚线是目标分</p></div>' +
      '  </div>' +
      '  <div class="chart-wrap" id="subjectChart"></div>' +
      '</section>';

    var sideBody = '' +
      '<div class="analysis">' +
      '  <div class="analysis-row"><span class="analysis-label">最高</span><span class="analysis-value num">' + (stats.best ? stats.best.score + ' <span class="muted">' + shortMd(stats.best.exam.date) + '</span>' : '—') + '</span></div>' +
      '  <div class="analysis-row"><span class="analysis-label">最低</span><span class="analysis-value num">' + (stats.worst ? stats.worst.score + ' <span class="muted">' + shortMd(stats.worst.exam.date) + '</span>' : '—') + '</span></div>' +
      '  <div class="analysis-row"><span class="analysis-label">平均得分率</span><span class="analysis-value num">' + S.pctText(stats.meanRate) + '</span></div>' +
      '  <div class="analysis-row"><span class="analysis-label">目标得分率</span><span class="analysis-value num">' + S.pctText(active.full ? S.rate(target, active.full) : 0) + '</span></div>' +
      '  <div class="analysis-row"><span class="analysis-label">每场平均推进</span><span class="analysis-value num ' + (stats.slope >= 0 ? 'good' : 'bad') + '">' + (stats.slope >= 0 ? '+' : '−') + Math.abs(stats.slope).toFixed(1) + '%</span></div>' +
      '</div>' +
      '<p class="analysis-note">' + buildSubjectNote(state, stats, active, target) + '</p>';

    var sideCard = '' +
      '<section class="card card-side">' +
      '  <div class="card-head"><h2 class="card-title">这科的样子</h2></div>' +
      '  <div class="card-body" data-block="side">' + sideBody + '</div>' +
      '</section>';

    var withRank = list.some(function (e) { return Number((e.subjectRanks || {})[active.id]); });

    var rowsHtml = list.slice().reverse().map(function (exam) {
      var before = S.prevExamOf(list, exam);
      var beforeScore = before ? Number(before.scores[active.id]) : null;
      var score = Number(exam.scores[active.id]);
      var d = beforeScore === null || isNaN(beforeScore) || isNaN(score) ? null : score - beforeScore;
      var r = isNaN(score) ? null : S.rate(score, active.full);
      var sr = Number((exam.subjectRanks || {})[active.id]) || null;
      var rankCells = withRank
        ? '<span class="cell-num num">' + (sr || '—') + '</span>'
        : '';
      return '<a class="row-link ' + (withRank ? 'row-subject-5' : 'row-subject-4') + '" href="#/exam/' + S.esc(exam.id) + '">' +
        '<span class="cell-main"><span class="cell-title">' + S.esc(exam.name) + '</span><span class="cell-sub">' + S.esc(exam.date) + '</span></span>' +
        '<span class="cell-num num">' + (isNaN(score) ? '—' : score) + '</span>' +
        '<span class="cell-num num muted">' + (r === null ? '—' : S.pctText(r)) + '</span>' +
        '<span class="cell-num num ' + deltaClass(d) + '">' + (d === null ? '—' : S.signed(d)) + '</span>' +
        rankCells +
        '</a>';
    }).join('');

    var tableHead = withRank
      ? '<div class="table-head table-head-subject-5"><span>考试</span><span class="cell-num">得分</span><span class="cell-num">得分率</span><span class="cell-num">较上次</span><span class="cell-num">班内名次</span></div>'
      : '<div class="table-head table-head-subject-4"><span>考试</span><span class="cell-num">得分</span><span class="cell-num">得分率</span><span class="cell-num">较上次</span></div>';

    var tableCard = '' +
      '<section class="card card-table">' +
      '  <div class="card-head"><h2 class="card-title">逐次记录</h2><span class="card-meta num" data-count>' + stats.count + ' 次</span></div>' +
      tableHead +
      '  <div class="list-rows" data-block="rows">' + rowsHtml + '</div>' +
      '</section>';

    return {
      kpi: kpi,
      kpiItems: kpiItems,
      chartCard: chartCard,
      sideCard: sideCard,
      sideBody: sideBody,
      tableCard: tableCard,
      tableRows: rowsHtml,
      tableCount: stats.count,
      points: points,
      target: target,
      subjectForecast: (function () {
        var vals = stats.series.map(function (p) { return p.score; });
        if (vals.length < 3) return null;
        var slope = S.indexSlope(vals);
        var cap = Number(active.full) || Infinity;
        var est = Math.max(0, Math.min(cap, vals[vals.length - 1] + slope));
        return { value: Math.round(est), label: '下次约 ' + Math.round(est) };
      })(),
      bands: S.semesterBands(state)
    };
  }

  function subjects(state, subjectId) {
    var list = S.sorted(state);
    var subjectList = state.config.subjects;
    var active = subjectList.find(function (s) { return s.id === subjectId; }) || subjectList[0];

    if (!list.length) {
      return '<header class="page-head"><div><h1>单科分析</h1><p class="page-sub">记录成绩之后，这里会显示每一科的曲线、波动和目标差距。</p></div></header>' +
        '<div class="block-empty"><p>还没有成绩记录。</p><button class="btn btn-primary" data-action="new-exam">记录一次考试</button></div>';
    }

    var tabs = '<div class="tabs" role="tablist">' + subjectList.map(function (s) {
      return '<a class="tab' + (s.id === active.id ? ' is-active' : '') + '" role="tab" aria-selected="' + (s.id === active.id) + '" data-subject-tab="' + S.esc(s.id) + '" href="#/subjects/' + S.esc(s.id) + '">' + S.esc(s.name) + '</a>';
    }).join('') + '</div>';

    var parts = subjectParts(state, active);

    return '' +
      '<header class="page-head"><div><h1>单科分析</h1><p class="page-sub">挑一科，看它自己的走势与稳定程度</p></div></header>' +
      tabs + parts.kpi +
      '<div class="grid-main">' +
      '  <div class="col-main">' + parts.chartCard + parts.tableCard + '</div>' +
      '  <div class="col-rail">' + parts.sideCard + '</div>' +
      '</div>';
  }

  /* ================= 考试记录 ================= */

  function examRow(state, exam, total, sortedList, withRank) {
    var before = S.prevExamOf(sortedList, exam);
    var t = S.examTotal(state, exam);
    var d = before ? t - S.examTotal(state, before) : null;
    var rc = Number(exam.ranks.class) || null;
    var rg = Number(exam.ranks.grade) || null;
    var dg = before && before.ranks.grade && rg ? rg - before.ranks.grade : null;
    var rankCells = withRank
      ? '<span class="cell-num num">' + (rg || '—') + '</span>' +
      '<span class="cell-num num ' + deltaClass(dg) + '">' + (dg === null ? '—' : rankWord(dg).text) + '</span>' +
      '<span class="cell-num num">' + (rc || '—') + '</span>'
      : '';
    return '<a class="row-link ' + (withRank ? 'row-exam' : 'row-exam-3') + '" href="#/exam/' + S.esc(exam.id) + '">' +
      '<span class="cell-main"><span class="cell-title">' + S.esc(exam.name) + '</span><span class="cell-sub">' + S.esc(exam.date) + ' · ' + S.esc(exam.type || '考试') + '</span></span>' +
      '<span class="cell-num num">' + t + '<span class="cell-sub-inline"> / ' + total + '</span></span>' +
      rankCells +
      '<span class="cell-num num ' + deltaClass(d) + '">' + (d === null ? '—' : S.signed(d)) + '</span>' +
      '</a>';
  }

  function exams(state) {
    var sortedList = S.sorted(state);
    var list = sortedList.slice().reverse();
    if (!list.length) {
      return '<header class="page-head"><div><h1>考试记录</h1><p class="page-sub">每一次考试都在这里，点一行看当时的全部分数。</p></div><button class="btn btn-primary" data-action="new-exam">记录一次考试</button></header>' +
        '<div class="block-empty"><p>还没有成绩记录。</p></div>';
    }

    var filter = state.filter || 'all';
    var facets = S.typeFacets(state);
    var shown = sortedList;
    var total = S.fullTotal(state);
    var groups = S.groupBySemester(state).map(function (g) {
      var totalsIn = g.exams.map(function (e) { return S.examTotal(state, e); });
      return {
        label: g.label,
        exams: g.exams,
        count: g.exams.length,
        avgTotal: S.mean(totalsIn),
        best: Math.max.apply(null, totalsIn),
        worst: Math.min.apply(null, totalsIn)
      };
    }).reverse();

    var withRank = shown.some(function (e) { return Number(e.ranks.grade) || Number(e.ranks.class); });

    var head = withRank
      ? '<div class="table-head table-head-6"><span>考试</span><span class="cell-num">总分</span><span class="cell-num">年级</span><span class="cell-num">名次变化</span><span class="cell-num">班级</span><span class="cell-num">总分变化</span></div>'
      : '<div class="table-head table-head-3"><span>考试</span><span class="cell-num">总分</span><span class="cell-num">总分变化</span></div>';

    var sections = groups.map(function (g) {
      var rows = g.exams.slice().reverse().map(function (exam) {
        return examRow(state, exam, total, sortedList, withRank);
      }).join('');
      var meta = g.count + ' 次 · 平均 ' + g.avgTotal.toFixed(1) + ' 分' +
        ' · 最高 ' + g.best + ' · 最低 ' + g.worst;
      return '<div class="sem-block">' +
        '  <div class="sem-head">' +
        '    <h2 class="card-title">' + S.esc(g.label) + '</h2>' +
        '    <p class="card-sub num">' + meta + '</p>' +
        '  </div>' +
        '  <div class="list-rows">' + rows + '</div>' +
        '</div>';
    }).join('');

    var chips = '<div class="filter-chips" role="group" aria-label="按考试类型筛选">' +
      '<button class="chip' + (filter === 'all' ? ' is-on' : '') + '" data-exam-filter="all">全部 <em class="num">' + S.allSorted(state).length + '</em></button>' +
      facets.map(function (f) {
        return '<button class="chip' + (filter === f.type ? ' is-on' : '') + '" data-exam-filter="' + S.esc(f.type) + '">' + S.esc(f.type) + ' <em class="num">' + f.count + '</em></button>';
      }).join('') +
      '</div>';

    var totals = shown.map(function (e) { return S.examTotal(state, e); });
    var avgTotal = S.mean(totals);

    return '' +
      '<header class="page-head"><div><h1>考试记录</h1><p class="page-sub num">共 ' + shown.length + ' 次' + (filter === 'all' ? '' : '（只看' + S.esc(filter) + '）') + '，跨 ' + groups.length + ' 个学期，从近到远排列</p></div><button class="btn btn-primary" data-action="new-exam">记录一次考试</button></header>' +
      chips +
      '<section class="card card-semester">' +
      head +
      sections +
      '</section>' +
      (totals.length
        ? '<div class="table-foot">' +
          '  <span>' + shown.length + ' 次考试</span>' +
          '  <span>平均 <em class="num">' + avgTotal.toFixed(1) + '</em></span>' +
          '  <span>最高 <em class="num">' + Math.max.apply(null, totals) + '</em></span>' +
          '  <span>最低 <em class="num">' + Math.min.apply(null, totals) + '</em></span>' +
          '</div>'
        : '');
  }

  /* ================= 两次考试对比 ================= */

  function compare(state, aId, bId) {
    var list = S.sorted(state);
    if (list.length < 2) {
      return '<header class="page-head"><div><h1>两次考试对比</h1><p class="page-sub">至少要有两次考试才能比较。</p></div>' +
        '<button class="btn btn-primary" data-action="new-exam">记录一次考试</button></header>' +
        '<div class="block-empty"><p>现在只有 ' + list.length + ' 次记录。</p></div>';
    }

    var a = list.find(function (e) { return e.id === aId; }) || list[list.length - 2];
    var b = list.find(function (e) { return e.id === bId; }) || list[list.length - 1];
    if (a.id === b.id) {
      var idx = list.findIndex(function (e) { return e.id === a.id; });
      b = idx === 0 ? list[1] : list[idx - 1];
    }

    var full = S.fullTotal(state);
    var totalA = S.examTotal(state, a);
    var totalB = S.examTotal(state, b);
    var rateA = S.rate(totalA, full) * 100;
    var rateB = S.rate(totalB, full) * 100;

    var rows = state.config.subjects.map(function (s) {
      var va = Number(a.scores[s.id]);
      var vb = Number(b.scores[s.id]);
      var hasA = !isNaN(va);
      var hasB = !isNaN(vb);
      var fullScore = Number(s.full) || 1;
      return {
        name: s.name,
        a: hasA ? va : null,
        b: hasB ? vb : null,
        aRate: hasA ? va / fullScore : null,
        bRate: hasB ? vb / fullScore : null,
        delta: hasA && hasB ? vb - va : null
      };
    });

    var maxDelta = Math.max.apply(null, rows.map(function (r) { return r.delta === null ? 0 : Math.abs(r.delta); }).concat([5]));

    var cmpRows = rows.map(function (r) {
      var d = r.delta || 0;
      var pct = Math.min(48, (Math.abs(d) / maxDelta) * 48);
      var left = d >= 0 ? 50 : 50 - pct;
      var cls = deltaClass(r.delta);
      return '<div class="cmp-row">' +
        '<span class="cmp-sub">' + S.esc(r.name) + '</span>' +
        '<span class="cmp-pair num"><span>' + (r.a === null ? '—' : r.a) + '</span>' +
        '<span class="cmp-arrow-sm" aria-hidden="true">→</span>' +
        '<span class="is-b">' + (r.b === null ? '—' : r.b) + '</span></span>' +
        '<div class="cmp-diff">' +
        '<span class="cmp-dbar' + (d < 0 ? ' is-down' : '') + '" style="left:' + left.toFixed(1) + '%;width:' + pct.toFixed(1) + '%"></span>' +
        '<span class="cmp-zero"></span>' +
        '</div>' +
        '<span class="cmp-delta num ' + cls + '">' + (r.delta === null ? '—' : S.signed(r.delta)) + '</span>' +
        '</div>';
    }).join('');

    var rankCls = function (d) { return d === null ? 'flat' : d < 0 ? 'good' : d > 0 ? 'bad' : 'flat'; };
    var dGrade = (Number(b.ranks.grade) && Number(a.ranks.grade)) ? Number(b.ranks.grade) - Number(a.ranks.grade) : null;
    var dClass = (Number(b.ranks.class) && Number(a.ranks.class)) ? Number(b.ranks.class) - Number(a.ranks.class) : null;

    var cmpCells = [];

    cmpCells.push(kpiCell({
      label: '总分',
      value: totalB,
      unit: '/ ' + full,
      foot: '<em class="delta ' + deltaClass(totalB - totalA) + ' num">' + S.signed(totalB - totalA) + '</em> 较起点'
    }));

    if (Number(b.ranks.grade)) {
      cmpCells.push(kpiCell({
        label: '年级排名',
        value: b.ranks.grade,
        unit: '/ ' + state.config.gradeSize,
        foot: dGrade === null ? '—' : '<em class="delta ' + rankCls(dGrade) + '">' + rankWord(dGrade).text + '</em> 名 较起点'
      }));
    }

    if (Number(b.ranks.class)) {
      cmpCells.push(kpiCell({
        label: '班级排名',
        value: b.ranks.class,
        unit: '/ ' + state.config.classSize,
        foot: dClass === null ? '—' : '<em class="delta ' + rankCls(dClass) + '">' + rankWord(dClass).text + '</em> 名 较起点'
      }));
    }

    cmpCells.push(kpiCell({
      label: '得分率',
      value: rateB.toFixed(1),
      unit: '%',
      foot: '<em class="delta ' + deltaClass(rateB - rateA) + ' num">' + S.signed(rateB - rateA, 1) + '</em> 个百分点'
    }));

    var kpi = kpiStrip(cmpCells);

    var legend = '' +
      '<div class="legend">' +
      '<span class="legend-item"><span class="legend-dot is-a"></span>' + shortMd(a.date) + '</span>' +
      '<span class="legend-item"><span class="legend-dot is-b"></span>' + shortMd(b.date) + '</span>' +
      '</div>';

    var radarCard = '' +
      '<section class="card card-side card-radar">' +
      '  <div class="card-head"><h2 class="card-title">各科形状</h2>' + legend + '</div>' +
      '  <div class="radar-wrap" id="cmpRadar"></div>' +
      '  <p class="analysis-note">每条边是一个科目，越靠外得分率越高。虚线是起点，实线是终点。</p>' +
      '</section>';

    var listCard = '' +
      '<section class="card card-cmp">' +
      '  <div class="card-head">' +
      '    <div class="card-title-wrap"><h2 class="card-title">逐科进退</h2><p class="card-sub">中间是零线，向右是进步，向左是回落</p></div>' +
      '    <button class="btn btn-ghost btn-sm" data-action="swap-pair">交换先后</button>' +
      '  </div>' +
      '  <div class="cmp-rows">' + cmpRows + '</div>' +
      '</section>';

    /* 各学期之间横向比一次，比只看两场更能看出趋势 */
    var semesterRows = S.groupBySemester(state).map(function (g) {
      return { label: g.label, count: g.count, avg: g.avgTotal, best: g.best, worst: g.worst };
    });
    var semesterCard = semesterRows.length > 1
      ? '<section class="card card-semesters">' +
        '  <div class="card-head"><h2 class="card-title">各学期平均</h2>' +
        '    <span class="card-meta num">' + semesterRows.length + ' 个学期</span></div>' +
        '  <div class="table-head table-head-sem"><span>学期</span><span class="cell-num">次数</span><span class="cell-num">平均</span><span class="cell-num">较上学期</span></div>' +
        '  <div class="list-rows">' +
        semesterRows.map(function (g, i) {
          var prev = i > 0 ? semesterRows[i - 1].avg : null;
          var d = prev === null ? null : g.avg - prev;
          return '<div class="row-link row-sem">' +
            '<span class="cell-main"><span class="cell-title">' + S.esc(g.label) + '</span></span>' +
            '<span class="cell-num num">' + g.count + '</span>' +
            '<span class="cell-num num">' + g.avg.toFixed(1) + '</span>' +
            '<span class="cell-num num ' + deltaClass(d) + '">' + (d === null ? '—' : S.signed(d)) + '</span>' +
            '</div>';
        }).join('') +
        '  </div>' +
        '</section>'
      : '';

    return '' +
      '<header class="page-head"><div><h1>两次考试对比</h1><p class="page-sub">挑两次考试，看每一科进退多少</p></div></header>' +
      '<section class="card cmp-bar">' +
      '  <div class="cmp-field"><span class="cmp-label">起点</span>' + examSelectHTML(list, a.id, ' data-pick="a"') + '</div>' +
      '  <span class="cmp-arrow" aria-hidden="true">→</span>' +
      '  <div class="cmp-field"><span class="cmp-label">终点</span>' + examSelectHTML(list, b.id, ' data-pick="b"') + '</div>' +
      '</section>' +
      kpi +
      '<div class="grid-main">' +
      '  <div class="col-main">' + listCard + '</div>' +
      '  <div class="col-rail">' + radarCard + '</div>' +
      '</div>' +
      semesterCard +
      '<script type="application/json" id="compareData">' + embedJSON({
        labels: rows.map(function (r) { return r.name; }),
        a: { values: rows.map(function (r) { return r.aRate === null ? 0 : r.aRate; }) },
        b: { values: rows.map(function (r) { return r.bRate === null ? 0 : r.bRate; }) },
        pair: [a.id, b.id]
      }) + '</script>';
  }

  /* ================= 单次考试 ================= */

  function examDetail(state, id) {
    var list = S.allSorted(state);
    var exam = list.find(function (e) { return e.id === id; });
    if (!exam) return '<header class="page-head"><div><h1>没有这次考试</h1><p class="page-sub">它可能已经被删掉了。</p></div><a class="btn" href="#/exams">回到考试记录</a></header>';

    var total = S.examTotal(state, exam);
    var full = S.fullTotal(state);
    var goal = S.targetTotal(state);
    /* 详情页不受类型筛选影响，差值和诊断都按全部记录算 */
    var plain = Object.assign({}, state, { filter: 'all' });
    var diff = S.changeSince(plain, exam);
    var rows = S.subjectRows(state, exam);

    var cards = rows.map(function (r) {
      var d = diff && diff.per[r.subject.id] !== null && diff.per[r.subject.id] !== undefined ? diff.per[r.subject.id] : null;
      var pct = r.rate === null ? 0 : r.rate;
      var hit = r.score !== null && r.target ? r.score >= r.target : false;
      return '<div class="sub-card">' +
        '<div class="sub-card-top"><span class="sub-name">' + S.esc(r.subject.name) + '</span>' +
        '<span class="sub-score num">' + (r.score === null ? '—' : r.score) + '<span class="sub-full">/ ' + r.full + '</span></span></div>' +
        '<div class="sub-track"><div class="sub-fill' + (hit ? ' is-hit' : '') + '" style="--pct:' + S.pctText(pct) + '"></div>' +
        (r.targetRate ? '<div class="sub-tick" style="left:' + S.pctText(r.targetRate) + '"></div>' : '') + '</div>' +
        '<div class="sub-foot"><span class="num">' + (r.rate === null ? '—' : S.pctText(r.rate)) + '</span>' +
        '<span class="num ' + deltaClass(d) + '">' + (d === null ? '首次' : S.signed(d)) + '</span></div>' +
        '</div>';
    }).join('');

    var goalLine = total >= goal
      ? '总分 <em class="num">' + total + '</em>，比目标线 ' + goal + ' 高 <em class="num good">' + (total - goal) + '</em> 分。'
      : '总分 <em class="num">' + total + '</em>，离目标线 ' + goal + ' 还差 <em class="num">' + (goal - total) + '</em> 分。';

    var nav = '';
    var idx = list.findIndex(function (e) { return e.id === exam.id; });
    if (idx > 0) nav += '<a class="text-link" href="#/exam/' + S.esc(list[idx - 1].id) + '">← 上一次</a>';
    if (idx < list.length - 1) nav += '<a class="text-link" href="#/exam/' + S.esc(list[idx + 1].id) + '">下一次 →</a>';

    var positionPoints = list.map(function (e) {
      return {
        label: shortMd(e.date),
        full: S.cnDate(e.date) + ' · ' + e.name,
        value: S.examTotal(state, e),
        sub: e.name,
        ts: S.dateTs(e.date)
      };
    });

    var positionCard = '' +
      '<section class="card card-position">' +
      '  <div class="card-head">' +
      '    <div class="card-title-wrap"><h2 class="card-title">这一场在走势里的位置</h2><p class="card-sub">竖线停在这一场</p></div>' +
      '  </div>' +
      '  <div class="chart-wrap" id="positionChart"></div>' +
      '</section>';

    return '' +
      '<header class="page-head">' +
      '  <div><h1>' + S.esc(exam.name) + '</h1><p class="page-sub">' + S.cnDate(exam.date) + ' ' + weekday(exam.date) + ' · ' + S.esc(exam.type || '考试') + '</p></div>' +
      '  <div class="head-actions">' + nav +
      '<button class="btn btn-ghost" data-action="edit-exam" data-id="' + S.esc(exam.id) + '">修改这次</button>' +
      '<button class="btn btn-ghost" data-action="delete-exam" data-id="' + S.esc(exam.id) + '">删除这次</button></div>' +
      '</header>' +
      detailKpi(state, exam, total, full, goal, diff) +
      detailPeers(plain, exam) +
      '<p class="statement">' + goalLine + '</p>' +
      '<div class="sub-grid">' + cards + '</div>' +
      positionCard +
      '<script type="application/json" id="positionData">' + embedJSON({ points: positionPoints, index: idx, bands: S.semesterBands(plain) }) + '</script>';
  }

  /* 这一场和班平、年平、最高分的距离，以及一句判断 */
  function detailPeers(state, exam) {
    var p = S.examVsPeers(state, exam);
    var bits = [];
    if (p.vsClass !== null) bits.push('班级平均 <em class="num">' + p.classAvg + '</em><em class="num ' + (p.vsClass >= 0 ? 'good' : 'bad') + '"> ' + S.signed(p.vsClass) + '</em>');
    if (p.vsGrade !== null) bits.push('年级平均 <em class="num">' + p.gradeAvg + '</em><em class="num ' + (p.vsGrade >= 0 ? 'good' : 'bad') + '"> ' + S.signed(p.vsGrade) + '</em>');
    if (p.toTop !== null) bits.push('年级最高 <em class="num">' + p.top + '</em><em class="num muted"> 距 ' + p.toTop + '</em>');
    if (!bits.length) return '';

    return '<p class="detail-peers">' + bits.join('<span class="peer-dot">·</span>') + '</p>' +
      (p.diagnosis ? '<p class="diagnosis is-' + p.diagnosis.tone + '">' + S.esc(p.diagnosis.text) + '</p>' : '');
  }

  function detailKpi(state, exam, total, full, goal, diff) {
    var cells = [];
    cells.push(kpiCell({
      label: '总分',
      value: total,
      unit: '/ ' + full,
      foot: diff ? '<em class="delta ' + deltaClass(diff.total) + ' num">' + S.signed(diff.total) + '</em> 较上一场' : '首次记录'
    }));

    if (Number(exam.ranks.grade)) {
      cells.push(kpiCell({
        label: '年级排名',
        value: exam.ranks.grade,
        unit: '/ ' + state.config.gradeSize,
        foot: diff && diff.gradeRank ? rankWord(diff.gradeRank).text + ' 名 较上一场' : '—'
      }));
    }
    if (Number(exam.ranks.class)) {
      cells.push(kpiCell({
        label: '班级排名',
        value: exam.ranks.class,
        unit: '/ ' + state.config.classSize,
        foot: diff && diff.classRank ? rankWord(diff.classRank).text + ' 名 较上一场' : '—'
      }));
    }

    cells.push(kpiCell({
      label: '得分率',
      value: (S.rate(total, full) * 100).toFixed(1),
      unit: '%',
      foot: '目标 ' + S.pctText(S.rate(goal, full))
    }));

    return kpiStrip(cells);
  }

  /* ================= 设置 ================= */

  var SET_SECTIONS = [
    { id: 'goal', name: '目标' },
    { id: 'subjects', name: '科目与满分' },
    { id: 'types', name: '考试类型' },
    { id: 'appearance', name: '外观' },
    { id: 'data', name: '数据' },
    { id: 'storage', name: '存储' }
  ];

  /* 左栏每个分区下面那行当前值 */
  function sectionMeta(state, id) {
    var c = state.config;
    if (id === 'goal') return c.targetRankClass ? '班级前 ' + c.targetRankClass : '还没定';
    if (id === 'subjects') return c.subjects.length + ' 科 · ' + S.fullTotal(state) + ' 分';
    if (id === 'types') return (c.types || []).length + ' 个类型';
    if (id === 'appearance') return appearanceMeta();
    if (id === 'data') return state.exams.length + ' 次考试';
    if (id === 'storage') return Math.max(1, Math.round(S.footprint() / 1024)) + ' KB';
    return '';
  }

  /* 配色名加上深浅 */
  function appearanceMeta() {
    var mode = S.themeMode();
    var deep = mode === 'auto' ? '跟随系统' : mode === 'dark' ? '深色' : '浅色';
    return paletteLabel(S.paletteName()) + ' · ' + deep;
  }

  function settings(state, sec) {
    var cur = 'goal';
    SET_SECTIONS.forEach(function (s) { if (s.id === sec) cur = s.id; });

    var nav = SET_SECTIONS.map(function (s) {
      var on = s.id === cur;
      return '<button type="button" class="set-nav-item' + (on ? ' is-on' : '') + '" data-sec="' + s.id + '"' +
        (on ? ' aria-current="true"' : '') + '>' +
        '<span class="set-nav-name">' + s.name + '</span>' +
        '<span class="set-nav-meta" data-meta-for="' + s.id + '">' + S.esc(sectionMeta(state, s.id)) + '</span>' +
        '</button>';
    }).join('');

    return '' +
      '<header class="page-head"><div><h1>设置</h1><p class="page-sub">目标、科目和数据都保存在这台电脑的浏览器里</p></div>' +
      '<button class="btn btn-ghost" data-action="replay-tour">看一遍导览</button></header>' +
      '<div class="settings">' +
      '  <nav class="set-nav" aria-label="设置分区">' +
      '    <span class="set-nav-thumb"></span>' + nav +
      '  </nav>' +
      '  <div class="set-panel" id="settingsPanel">' + settingsPanel(state, cur) + '</div>' +
      '  <div class="set-foot">' + appFooter() + '</div>' +
      '</div>';
  }

  function settingsPanel(state, sec) {
    if (sec === 'subjects') return subjectsPanel(state);
    if (sec === 'types') return typesPanel(state);
    if (sec === 'appearance') return appearancePanel();
    if (sec === 'data') return dataPanel(state);
    if (sec === 'storage') return storagePanel();
    return goalPanel(state);
  }

  /* 一组设置：几张小卡片横排，卡片数决定列数 */
  function setCards(cards, cols) {
    return '<div class="set-cards" style="--cols:' + (cols || cards.length) + '">' + cards.join('') + '</div>';
  }

  function setCard(title, body, note) {
    return '<section class="set-card">' +
      '<h3 class="set-card-title">' + title + '</h3>' +
      '<div class="set-card-body">' + body + '</div>' +
      (note ? '<p class="set-card-note">' + note + '</p>' : '') +
      '</section>';
  }

  /* 卡片里的一项：名字和控件一行，说明另起一行 */
  function setField(label, control, hint) {
    return '<div class="set-field">' +
      '<span class="set-field-label">' + label + '</span>' +
      '<span class="set-field-control">' + control + '</span>' +
      (hint ? '<span class="set-field-hint">' + hint + '</span>' : '') +
      '</div>';
  }

  /* 页脚：版本、作者、仓库、许可证 */
  function appFooter() {
    return '<footer class="app-meta">' +
      '<span class="app-name">成迹</span>' +
      (S.VERSION ? '<span>v' + S.esc(S.VERSION) + '</span>' : '') +
      '<span class="app-dot">·</span>' +
      '<span>作者 <a href="https://github.com/nDhnzr6r" target="_blank" rel="noopener">nDhnzr6r</a></span>' +
      '<span class="app-dot">·</span>' +
      '<a href="https://github.com/nDhnzr6r/chengji" target="_blank" rel="noopener">仓库</a>' +
      '<span class="app-dot">·</span>' +
      '<a href="https://github.com/nDhnzr6r/chengji/blob/master/LICENSE" target="_blank" rel="noopener">GPL-3.0</a>' +
      '</footer>';
  }

  /* 目标：三张卡片并排，分数、班级、分界线各一张 */
  function goalPanel(state) {
    var c = state.config;
    var goalMate = S.goalCheck(state);
    var totalHint = goalMate.mismatch
      ? '各科目标加起来是 ' + goalMate.subjectSum + ' 分，和目标总分差 ' + Math.abs(goalMate.mismatch) + ' 分'
      : '填 0 时按各科目标分数相加';

    return setCards([
      setCard('目标分数',
        setField('目标总分',
          '<input class="input num set-num" data-cfg="targetTotal" type="number" min="0" max="' + Math.max(1, S.fullTotal(state)) + '" value="' + c.targetTotal + '">',
          totalHint) +
        setField('目标班级排名',
          '<input class="input num set-num" data-cfg="targetRankClass" type="number" min="1" max="' + (Number(c.classSize) || 1000) + '" value="' + c.targetRankClass + '">',
          '排名格右上角判断达标与否') +
        setField('目标年级排名',
          '<input class="input num set-num" data-cfg="targetRankGrade" type="number" min="1" max="' + (Number(c.gradeSize) || 5000) + '" value="' + c.targetRankGrade + '">',
          '写进走势图的目标名次') +
        setField('离目标还剩几场',
          '<input class="input num set-num" data-cfg="remainingExams" type="number" min="0" max="60" value="' + (c.remainingExams || 0) + '">',
          '用来算每场需要涨多少分')
      ),
      setCard('班级与年级',
        setField('班级',
          '<input class="input set-text" data-cfg="className" type="text" value="' + S.esc(c.className) + '">') +
        setField('班级人数',
          '<input class="input num set-num" data-cfg="classSize" type="number" min="1" max="200" value="' + c.classSize + '">',
          '用来算班级排名百分比') +
        setField('年级人数',
          '<input class="input num set-num" data-cfg="gradeSize" type="number" min="1" max="20000" value="' + c.gradeSize + '">',
          '用来算年级排名百分比') +
        setField('入学年份',
          '<input class="input num set-num" data-cfg="enrollYear" type="number" min="2000" max="2100" value="' + (c.enrollYear || '') + '">',
          '决定 2025 年 9 月算高一上还是别的')
      ),
      setCard('达标分界',
        setField('及格线',
          '<span class="input-suffix set-num"><input class="input num" data-cfg="passRate" type="number" min="10" max="100" value="' + (c.passRate || S.PASS_RATE_DEFAULT) + '"><span class="suffix num">%</span></span>',
          '低于这条线算未达标') +
        setField('优秀线',
          '<span class="input-suffix set-num"><input class="input num" data-cfg="goodRate" type="number" min="10" max="100" value="' + (c.goodRate || S.GOOD_RATE_DEFAULT) + '"><span class="suffix num">%</span></span>',
          '高于这条线算优秀')
      )
    ]);
  }

  /* 科目：固定四列，改完立刻重算 */
  function subjectsPanel(state) {
    var rows = state.config.subjects.map(function (s) {
      return '<tr data-subject="' + S.esc(s.id) + '">' +
        '<td><input class="input input-plain" data-field="name" value="' + S.esc(s.name) + '" aria-label="科目名称"></td>' +
        '<td class="num"><input class="input input-plain num" data-field="full" type="number" min="1" max="' + S.SUBJECT_FULL_MAX + '" value="' + S.esc(s.full) + '" aria-label="' + S.esc(s.name) + '满分"></td>' +
        '<td class="num"><input class="input input-plain num" data-field="target" type="number" min="0" max="' + S.esc(s.full) + '" value="' + (s.target || 0) + '" aria-label="' + S.esc(s.name) + '目标分"></td>' +
        '<td class="num muted">' + (s.full ? S.pctText(Number(s.target || 0) / Number(s.full)) : '—') + '</td>' +
        '</tr>';
    }).join('');

    return setCards([setCard('各科的满分与目标分',
      '<table class="table-form">' +
      '<thead><tr><th>科目</th><th class="num">满分</th><th class="num">目标分</th><th class="num">目标得分率</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>',
      '改名字、满分或目标分之后，所有走势和对照会跟着重算。')], 1);
  }

  function typesPanel(state) {
    var c = state.config;
    return setCards([setCard('记录考试时能选的类型',
      '<div class="type-manage">' +
      '  <div class="type-chips">' + (c.types || []).map(function (t) {
        return '<span class="type-chip">' +
          '<input class="type-name" type="text" value="' + S.esc(t) + '" data-type-old="' + S.esc(t) + '" maxlength="' + S.TYPE_NAME_MAX + '" aria-label="类型名称">' +
          '<button type="button" class="type-del" data-type-del="' + S.esc(t) + '" aria-label="删除 ' + S.esc(t) + '">×</button>' +
          '</span>';
      }).join('') + '</div>' +
      '  <div class="type-add">' +
      '    <input class="input" id="typeNew" type="text" placeholder="周测、摸底、联考…" maxlength="' + S.TYPE_NAME_MAX + '">' +
      '    <button type="button" class="btn" data-type-add>添加</button>' +
      '  </div>' +
      '</div>',
      '点名字可以直接改；改完之后，用过这个类型的考试会一起改成新名字。')], 1);
  }

  /* 数据：导出、导入、检查三张卡片并排 */
  function dataPanel(state) {
    var issues = S.audit(Object.assign({}, state, { filter: 'all' }));

    return setCards([
      setCard('导出',
        setField('备份（JSON）', '<button class="btn" data-action="export-json">导出</button>', '目标、科目和全部考试都在里面') +
        setField('表格（Excel）', '<button class="btn" data-action="export-xlsx">导出</button>', '各科分数、名次和平均分，每场一行') +
        setField('表格（CSV）', '<button class="btn" data-action="export-csv">导出</button>', '同样的内容，纯文本') +
        setField('分析报告', '<button class="btn" data-action="export-report">导出</button>', '图表和结论，可以打印或存成 PDF')
      ),
      setCard('导入',
        setField('备份（JSON）', '<button class="btn" data-action="import-json">选择文件</button>', '会替换当前的全部内容') +
        setField('表格（CSV）', '<button class="btn" data-action="import-csv">选择文件</button>', '按「日期 + 名称」合并') +
        setField('表格（Excel）', '<button class="btn" data-action="import-xlsx">选择文件</button>', '直接读 xlsx') +
        setField('空白模板', '<button class="btn" data-action="download-template">下载</button>', '先照着填，填完再导回来')
      ),
      setCard('数据检查',
        '<div class="set-field">' +
        '<span class="set-field-label">当前存档</span>' +
        '<span class="set-field-control">' +
        (issues.length
          ? '<span class="set-tag set-tag-warn">发现 ' + issues.length + ' 处</span>'
          : '<span class="set-tag set-tag-ok">没有发现问题</span>') +
        '</span>' +
        '<span class="set-field-hint">' + (issues.length ? '下面这些地方需要看看' : '分数、名次、平均分和目标都在合理范围内') + '</span>' +
        '</div>' +
        (issues.length
          ? '<ul class="issue-list">' + issues.map(function (i) { return '<li>' + S.esc(i.text) + '</li>'; }).join('') + '</ul>'
          : '')
      )
    ], 3) +
    '<details class="danger-fold">' +
    '  <summary>危险操作</summary>' +
    '  <div class="danger-zone">' +
    '    <div><strong>清空全部记录</strong><p>只删考试，保留目标与科目设置。</p></div>' +
    '    <button class="btn btn-danger" data-action="clear-exams">清空记录</button>' +
    '  </div>' +
    '  <div class="danger-zone">' +
    '    <div><strong>恢复出厂</strong><p>连同目标、科目、人数和类型一起重置，全部记录也会删掉。</p></div>' +
    '    <button class="btn btn-danger" data-action="reset-all">清空全部数据</button>' +
    '  </div>' +
    '  <div class="danger-zone">' +
    '    <div><strong>填入示例数据</strong><p>把 ' + S.SEED_COUNT + ' 场虚构的考试和默认设置装回来，用来试用功能。会覆盖当前全部内容。</p></div>' +
    '    <button class="btn" data-action="load-sample">填入示例数据</button>' +
    '  </div>' +
    '</details>';
  }

  /* 两套配色各取浅色那一面，画成缩略图；具体颜色在样式表里 */
  var PALETTES = [
    { id: 'classic', name: '默认', desc: '冷灰底，近黑字色，数据线用亮蓝' },
    { id: 'ink', name: '纸与墨', desc: '米白纸面，深墨字色，数据线用墨蓝' }
  ];

  function paletteLabel(id) {
    var hit = PALETTES.filter(function (p) { return p.id === id; })[0];
    return hit ? hit.name : PALETTES[0].name;
  }

  /* 一张配色的样子：侧栏、纸面、一张卡片和一条数据线 */
  function paletteShot(id) {
    return '<span class="palette-shot is-' + id + '">' +
      '<span class="palette-shot-side"></span>' +
      '<span class="palette-shot-main">' +
      '<span class="palette-shot-card">' +
      '<span class="palette-shot-line"></span>' +
      '</span></span></span>';
  }

  function appearancePanel() {
    var now = S.paletteName();
    var mode = S.themeMode();

    var seg = '<span class="seg" id="themeSeg">' + [
      { id: 'auto', name: '跟随系统' },
      { id: 'light', name: '浅色' },
      { id: 'dark', name: '深色' }
    ].map(function (m) {
      var on = m.id === mode;
      return '<button type="button" class="seg-btn' + (on ? ' is-on' : '') + '" data-action="set-theme"' +
        ' data-mode="' + m.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + m.name + '</button>';
    }).join('') + '</span>';

    var swOn = S.themeToggleOn();
    var swSeg = '<span class="seg" id="switchSeg">' + [
      { id: 'on', name: '显示' },
      { id: 'off', name: '隐藏' }
    ].map(function (m) {
      var on = (m.id === 'on') === swOn;
      return '<button type="button" class="seg-btn' + (on ? ' is-on' : '') + '" data-action="set-theme-switch"' +
        ' data-switch="' + m.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + m.name + '</button>';
    }).join('') + '</span>';

    var cards = PALETTES.map(function (p) {
      var on = p.id === now;
      return '<button type="button" class="palette-item' + (on ? ' is-on' : '') + '"' +
        ' data-action="set-palette" data-pick="' + p.id + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        paletteShot(p.id) +
        '<span class="palette-name">' + S.esc(p.name) + '</span>' +
        '<span class="palette-desc">' + S.esc(p.desc) + '</span>' +
        '</button>';
    }).join('');

    return setCards([
      setCard('深浅色',
        setField('明暗', seg, '选「跟随系统」时，系统换成深色这里也会跟着变') +
        setField('侧栏开关', swSeg, '关掉之后，侧栏底部不再显示切换按钮')
      ),
      setCard('配色',
        '<div class="palette-pick">' + cards + '</div>',
        '换的只是颜色，布局和字号不变。')
    ], 2);
  }

  /* 存储状况：能不能写、会不会被清、占了多少 */
  function storagePanel() {
    var st = S.storage || {};
    var persisted = st.persisted;
    var persistText = persisted === true ? '已同意长期保留'
      : persisted === false ? '没有同意，磁盘紧张时可能被清理'
        : persisted === 'unsupported' ? '这个浏览器不支持申请'
          : '正在确认';
    var kb = Math.max(1, Math.round(S.footprint() / 1024));
    var hasBroken = !!st.broken || (S.brokenExists && S.brokenExists());
    var canAsk = persisted !== true && persisted !== 'unsupported';

    return setCards([
      setCard('这台浏览器',
        '<div class="set-field">' +
        '<span class="set-field-label">本地存储</span>' +
        '<span class="set-field-control">' + (st.available === false
          ? '<span class="set-tag set-tag-bad">被禁止</span>'
          : '<span class="set-tag set-tag-ok">可以写入</span>') + '</span>' +
        '<span class="set-field-hint">' + (st.available === false ? '被浏览器禁止，改动关掉页面就没了' : '改动会写进这台电脑') + '</span>' +
        '</div>' +
        '<div class="set-field">' +
        '<span class="set-field-label">长期保留</span>' +
        '<span class="set-field-control">' + (canAsk ? '<button class="btn" data-action="request-persist">申请</button>' : '') + '</span>' +
        '<span class="set-field-hint">' + S.esc(persistText) + '</span>' +
        '</div>' +
        '<div class="set-field">' +
        '<span class="set-field-label">当前占用</span>' +
        '<span class="set-field-control"><span class="set-value num">' + kb + ' KB</span></span>' +
        '<span class="set-field-hint">全部考试和设置加起来</span>' +
        '</div>',
        '清理浏览器数据、关掉无痕窗口、换一台电脑，成绩都会不见。'
      ),
      setCard('备份与留底',
        hasBroken
          ? '<div class="set-field">' +
          '<span class="set-field-label">读不出来的存档</span>' +
          '<span class="set-field-control">' +
          '<button class="btn" data-action="export-broken">下载</button>' +
          '<button class="btn btn-danger" data-action="discard-broken">丢弃</button>' +
          '</span>' +
          '<span class="set-field-hint">原始内容按原样保存着，可以下载下来自行检查</span>' +
          '</div>'
          : '<p class="set-field-hint">没有读不出来的存档。隔一段时间在「数据」里导出一份 JSON 放到别处。</p>'
      )
    ], 2);
  }

  /* ================= 录入对话框 ================= */

  /* 参照数据和单科名次，默认收起，不占主表单的地方 */
  function moreFields(c, exam, averages, subjectRanks, subjectAverages) {
    var rows = c.subjects.map(function (s) {
      var v = subjectRanks[s.id];
      return '<label class="field"><span class="field-label">' + S.esc(s.name) + '</span>' +
        '<input class="input num" type="number" min="1" data-subrank="' + S.esc(s.id) + '" value="' + (v || '') + '" placeholder="—"></label>';
    }).join('');
    var avgRows = c.subjects.map(function (s) {
      var v = subjectAverages[s.id];
      return '<label class="field"><span class="field-label">' + S.esc(s.name) + '</span>' +
        '<input class="input num" type="number" min="0" max="' + S.esc(s.full) + '" data-subavg="' + S.esc(s.id) + '" value="' + (v || '') + '" placeholder="—"></label>';
    }).join('');

    return '<details class="form-more">' +
      '<summary>参照数据和单科名次（可选）</summary>' +
      '<p class="field-hint">填了班级平均和年级平均，才能判断某次下跌是题目难还是自己状态差。</p>' +
      '<div class="field-row">' +
      '  <label class="field"><span class="field-label">班级平均</span>' +
      '    <input class="input num" id="fAvgClass" type="number" min="0" value="' + (averages.class || '') + '" placeholder="—"></label>' +
      '  <label class="field"><span class="field-label">年级平均</span>' +
      '    <input class="input num" id="fAvgGrade" type="number" min="0" value="' + (averages.grade || '') + '" placeholder="—"></label>' +
      '  <label class="field"><span class="field-label">年级最高</span>' +
      '    <input class="input num" id="fAvgTop" type="number" min="0" value="' + (averages.top || '') + '" placeholder="—"></label>' +
      '</div>' +
      '<div class="field-label form-more-label">各科在班级的名次</div>' +
      '<div class="score-grid">' + rows + '</div>' +
      '<div class="field-label form-more-label">各科的班级平均分</div>' +
      '<div class="score-grid">' + avgRows + '</div>' +
      '</details>';
  }

  function examForm(state, exam) {
    var c = state.config;
    var isEdit = !!exam;
    var today = new Date();
    var todayIso = today.getFullYear() + '-' + S.pad2(today.getMonth() + 1) + '-' + S.pad2(today.getDate());
    var scores = exam ? exam.scores : {};
    var ranks = exam ? exam.ranks : {};
    var averages = (exam && exam.averages) || {};
    var subjectRanks = (exam && exam.subjectRanks) || {};
    var subjectAverages = (exam && exam.subjectAverages) || {};

    var fields = c.subjects.map(function (s) {
      var v = scores[s.id];
      return '<label class="field field-score">' +
        '<span class="field-label">' + S.esc(s.name) + '</span>' +
        '<span class="input-suffix">' +
        '  <input class="input num" type="number" min="0" max="' + S.esc(s.full) + '" step="1" data-subject="' + S.esc(s.id) + '" value="' + (v === undefined || v === null ? '' : v) + '" placeholder="—">' +
        '  <span class="suffix num">/ ' + S.esc(s.full) + '</span>' +
        '</span></label>';
    }).join('');

    return '' +
      '<form class="exam-form" id="examForm" novalidate>' +
      '  <div class="form-head"><h2>' + (isEdit ? '修改这次考试' : '记录一次考试') + '</h2>' +
      '    <button type="button" class="icon-btn" data-action="close-dialog" aria-label="关闭">' +
      '      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>' +
      '  <div class="form-body">' +
      '    <div class="field-row">' +
      '      <div class="field"><label class="field-label" for="fName">考试名称</label>' +
      '        <input class="input" id="fName" type="text" value="' + S.esc(exam ? exam.name : '') + '" placeholder="高二上 · 第三次月考"></div>' +
      '      <div class="field field-date"><span class="field-label">日期</span>' + dateHTML(exam ? exam.date : todayIso, 'fDate') + '</div>' +
      '      <div class="field field-type"><span class="field-label">类型</span>' + selectHTML(typesOf(c, exam), exam ? exam.type : (c.types && c.types[0]) || S.DEFAULT_TYPE, ' data-field="type"') + '</div>' +
      '    </div>' +
      '    <div class="score-grid">' + fields + '</div>' +
      '    <div class="field-row">' +
      '      <label class="field"><span class="field-label">班级排名</span>' +
      '        <span class="input-suffix"><input class="input num" id="fClass" type="number" min="1" value="' + (ranks.class || '') + '" placeholder="—"><span class="suffix num">/ ' + c.classSize + '</span></span></label>' +
      '      <label class="field"><span class="field-label">年级排名</span>' +
      '        <span class="input-suffix"><input class="input num" id="fGrade" type="number" min="1" value="' + (ranks.grade || '') + '" placeholder="—"><span class="suffix num">/ ' + c.gradeSize + '</span></span></label>' +
      '      <div class="field field-total"><span class="field-label">合计</span>' +
      '        <span class="total-preview"><span class="num" id="formTotal">0</span><span class="muted num"> / ' + S.fullTotal(state) + '</span></span></div>' +
      '    </div>' +
      (moreFields(c, exam, averages, subjectRanks, subjectAverages)) +
      '    <p class="form-error" id="formError" role="alert"></p>' +
      '  </div>' +
      '  <div class="form-foot">' +
      '    <button type="button" class="btn btn-ghost" data-action="close-dialog">取消</button>' +
      '    <button type="submit" class="btn btn-primary">' + (isEdit ? '保存' : '记录') + '</button>' +
      '  </div>' +
      '</form>' +
      '<script type="application/json" id="formSubjects">' + embedJSON(c.subjects) + '</script>' +
      '<script type="application/json" id="formExamId">' + embedJSON(exam ? exam.id : null) + '</script>';
  }

  global.Views = {
    sidebar: sidebar,
    overview: overview,
    subjects: subjects,
    subjectParts: subjectParts,
    compare: compare,
    exams: exams,
    detail: examDetail,
    settings: settings,
    settingsPanel: settingsPanel,
    appearanceMeta: appearanceMeta,
    themeToggleHTML: themeToggleHTML,
    examForm: examForm
  };
})(window);

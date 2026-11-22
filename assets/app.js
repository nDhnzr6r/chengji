/* 应用层：路由、渲染、交互 */
(function (global) {
  'use strict';

  var S = global.Store;
  var V = global.Views;
  var C = global.Charts;

  var state = S.load();
  var sideHost = document.getElementById('sideHost');
  var mainEl = document.getElementById('main');
  var dialogRoot = document.getElementById('dialogRoot');
  var toastEl = document.getElementById('toast');
  var fileInput = document.getElementById('fileInput');

  var currentView = null;
  var shownKpis = {};
  var comparePair = [null, null];
  var pendingFilter = null;
  var lastSidebarFilter;

  /* ---------------- 工具 ---------------- */

  function parseHash() {
    var raw = (global.location.hash || '').replace(/^#\/?/, '');
    var query = {};
    var qIdx = raw.indexOf('?');
    if (qIdx >= 0) {
      var qs = raw.slice(qIdx + 1);
      raw = raw.slice(0, qIdx);
      qs.split('&').forEach(function (pair) {
        if (!pair) return;
        var eq = pair.indexOf('=');
        var k = eq >= 0 ? pair.slice(0, eq) : pair;
        var v = eq >= 0 ? pair.slice(eq + 1) : '';
        try {
          query[decodeURIComponent(k)] = decodeURIComponent(v);
        } catch (err) {
          /* 保留原样 */
        }
      });
    }
    var parts = raw.split('/').filter(Boolean);
    return { name: parts[0] || 'overview', param: parts[1] || null, query: query };
  }

  /* 提示条；带上动作时会多一个按钮，停留时间也更长 */
  var toastState = { timer: 0, life: 0, left: 0, at: 0 };
  var toastSwapTimer = 0;

  function toastStop() {
    clearTimeout(toastState.timer);
    toastState.timer = 0;
  }

  function toastDismiss() {
    toastStop();
    toastEl.classList.remove('is-on', 'is-paused');
    toastEl.classList.add('is-off');
    clearTimeout(toastState.timer);
    toastState.timer = setTimeout(function () {
      toastEl.className = 'toast';
      toastEl.replaceChildren();
    }, T[2]);
  }

  function toastShow(html, tone, life) {
    clearTimeout(toastSwapTimer);
    toastEl.innerHTML = html;
    toastEl.className = 'toast is-on' + (tone ? ' toast-' + tone : '');
    void toastEl.offsetWidth;
    toastState.life = life;
    toastState.left = life;
    toastState.at = Date.now();
    toastStop();
    toastState.timer = setTimeout(toastDismiss, life);
  }

  function toast(message, tone, action) {
    var life = action ? 7000 : 2600;
    var html =
      S.esc(message) +
      (action
        ? '<button type="button" class="toast-act" data-action="' + action.id + '">' + S.esc(action.label) + '</button>'
        : '') +
      '<span class="toast-bar" style="--toast-life:' +
      life +
      'ms"></span>';
    /* 旧的先退半步，新的再来 */
    if (toastEl.classList.contains('is-on') && !reducedMotion()) {
      toastEl.classList.remove('is-on');
      toastEl.classList.add('is-off');
      clearTimeout(toastSwapTimer);
      toastSwapTimer = setTimeout(function () {
        toastShow(html, tone, life);
      }, T[2]);
      return;
    }
    toastShow(html, tone, life);
  }

  /* 指针停在上面时倒计时与进度线一起停 */
  toastEl.addEventListener('mouseenter', function () {
    if (!toastEl.classList.contains('is-on')) return;
    var spent = Date.now() - toastState.at;
    toastState.left = Math.max(0, toastState.life - spent);
    toastStop();
    toastEl.classList.add('is-paused');
  });

  toastEl.addEventListener('mouseleave', function () {
    if (!toastEl.classList.contains('is-on') || !toastEl.classList.contains('is-paused')) return;
    toastEl.classList.remove('is-paused');
    toastState.at = Date.now();
    toastState.life = toastState.left;
    toastStop();
    toastState.timer = setTimeout(toastDismiss, Math.max(400, toastState.left));
  });

  /* ---------------- 存储状态 ---------------- */

  var storageNote = null;

  function storageNoteHTML() {
    if (!storageNote) return '';
    var extra = '';
    if (storageNote.kind === 'broken') {
      extra =
        '<button type="button" class="btn btn-sm btn-ghost" data-action="export-broken">下载原始存档</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-action="discard-broken">丢弃</button>';
    } else if (storageNote.kind === 'external') {
      extra = '<button type="button" class="btn btn-sm btn-primary" data-action="reload-external">载入最新</button>';
    } else if (storageNote.kind === 'save' || storageNote.kind === 'off') {
      extra = '<button type="button" class="btn btn-sm btn-primary" data-action="export-json">导出备份</button>';
    }
    return (
      '<div class="storage-note storage-' +
      storageNote.tone +
      '" id="storageNote" role="alert">' +
      '<div class="storage-text"><b>' +
      S.esc(storageNote.title) +
      '</b><span>' +
      S.esc(storageNote.text) +
      '</span></div>' +
      (extra ? '<div class="storage-actions">' + extra + '</div>' : '') +
      '</div>'
    );
  }

  function setStorageNote(note) {
    storageNote = note;
    var host = document.getElementById('storageNote');
    var html = storageNoteHTML();
    if (!html) {
      if (host && host.parentNode) {
        if (reducedMotion()) host.remove();
        else {
          host.setAttribute('data-motion', 'swap-out');
          setTimeout(function () {
            if (host.parentNode) host.remove();
          }, T[2]);
        }
      }
      return;
    }
    if (host && host.parentNode) {
      host.outerHTML = html;
      return;
    }
    if (!mainEl) return;
    mainEl.insertAdjacentHTML('afterbegin', html);
    var fresh = document.getElementById('storageNote');
    if (!fresh) return;
    fresh.setAttribute('data-motion', 'enter');
    fresh.style.setProperty('--enter-delay', '0ms');
    fresh.style.setProperty('--enter-dur', T[3] + 'ms');
    fresh.style.setProperty('--enter-shift', '-8px');
  }

  /* 保存之后看结果，失败就把话说清楚 */
  function noteStorageOutcome() {
    if (S.storage.reason) {
      setStorageNote({
        tone: 'bad',
        kind: 'save',
        title: '这次改动没能存进浏览器',
        text: S.storage.reason + '。关掉页面就会丢失，先导出一份备份。'
      });
    } else if (storageNote && (storageNote.kind === 'save' || storageNote.kind === 'off')) {
      setStorageNote(null);
    }
  }

  function persist() {
    var ok = S.save(state);
    noteStorageOutcome();
    return ok;
  }

  /* ---------------- 最近一步可撤销 ---------------- */

  /* 只留一步，够把刚做掉的删除或覆盖退回去 */
  var undoStep = null;
  var UNDO = { id: 'undo', label: '撤销' };

  function pushUndo() {
    undoStep = JSON.stringify(state);
  }

  function undoLast() {
    if (!undoStep) return;
    var back = S.normalize(JSON.parse(undoStep));
    undoStep = null;
    back.filter = state.filter;
    state = back;
    persist();
    shownKpis = {};
    refreshSidebar();
    render();
    toast('已撤销');
  }

  /* 打开时检查存储状况，把异常一次说清 */
  function checkStorage() {
    if (!S.storage.available) {
      setStorageNote({
        tone: 'bad',
        kind: 'off',
        title: '这个浏览器不让保存数据',
        text: '改动只在这次打开期间有效，关掉页面就没了。可以换一个正常窗口，或者现在就导出备份。'
      });
      return;
    }
    if (S.storage.broken) {
      setStorageNote({
        tone: 'warn',
        kind: 'broken',
        title: '上次的存档读不出来',
        text: '原始内容已经原样留底，没有被覆盖。现在看到的是示例数据，可以先把那份存档下载下来看看。'
      });
    }
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function todayStamp() {
    return S.toISO(new Date());
  }

  /* 宽度变了重画图表：只淡入，不重新描边 */
  function fadeRedraw(host, draw) {
    if (!host) return;
    draw();
    if (reducedMotion()) return;
    host.style.opacity = '0';
    requestAnimationFrame(function () {
      host.style.transition = 'opacity ' + T[3] + 'ms var(--ease-out)';
      host.style.opacity = '1';
    });
  }

  function readJSONScript(id) {
    var node = document.getElementById(id);
    if (!node) return null;
    try {
      return JSON.parse(node.textContent);
    } catch (err) {
      return null;
    }
  }

  /* ---------------- 动效 ---------------- */

  /* 时长只取九档；层起点按同一比例放慢，层与节拍共用一套 */
  var T = { 1: 110, 2: 180, 3: 250, 4: 300, 5: 400, 6: 500, 7: 600, 8: 700, 9: 800 };
  var STAGGER = { 1: 30, 2: 50, 3: 80 };
  var PACE = 1.25;
  var START_DATA = 150;

  /* 计划书里的时刻乘以这个比例，放慢后仍然保持先后关系 */
  function beat(ms) {
    return Math.round(ms * PACE);
  }

  var lastPage = { name: '', at: 0 };
  var prevPage = '';
  var lastRadar = null;
  var chartDelay = START_DATA;
  var pageTransition = null;

  function reducedMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* 一层里的一组同类元素：起点、错峰、时长、位移 */
  function seq(list, from, step, dur, shift) {
    return list.map(function (el, i) {
      return [el, from + i * step, dur || T[5], shift === undefined ? 6 : shift];
    });
  }

  function one(sel, at, dur, shift) {
    var el = mainEl.querySelector(sel);
    return el ? [[el, at, dur || T[5], shift === undefined ? 6 : shift]] : [];
  }

  function all(sel, at, dur, shift) {
    return seq(list(sel), at || 0, 0, dur, shift);
  }

  function list(sel) {
    return Array.prototype.slice.call(mainEl.querySelectorAll(sel));
  }

  /* 每页的结构、数据、注解三层；时刻从页面进入算起 */
  function enterPlan(name) {
    var plan = { structure: [], data: [], annotation: [] };

    if (name === 'overview') {
      plan.structure = plan.structure
        .concat(all('.sample-note, .filter-note, .storage-note', 0, T[5], 6))
        .concat(one('.page-head', 0))
        .concat(one('.verdict', beat(40), T[5], 6))
        .concat(one('.verdict-sub', beat(80), T[5], 6))
        .concat(one('.kpi-strip', START_DATA))
        .concat(seq(list('.kpi'), beat(120), STAGGER[2], T[5], 6))
        .concat(one('.card-trend', beat(200)))
        .concat(one('.card-records', beat(200)))
        .concat(one('.card-subjects', beat(240)))
        .concat(one('.card-analysis', beat(240)))
        .concat(one('.card-types', beat(280)))
        .concat(one('.card-priority', beat(240)));

      plan.data = plan.data
        .concat(seq(list('.record'), beat(200), STAGGER[1], T[5], 4))
        .concat(seq(list('.analysis-row'), beat(200), STAGGER[1], T[5], 4))
        .concat(seq(list('.bullet-row'), beat(240), STAGGER[2], T[5], 4))
        .concat(seq(list('.type-bar-row'), beat(280), STAGGER[2], T[5], 4));

      plan.annotation = plan.annotation
        .concat(all('.kpi-state', beat(600), T[4], 2))
        .concat(all('.kpi-foot', beat(600), T[4], 2))
        .concat(all('.bullet-value', beat(600), T[4], 2))
        .concat(one('.diagnosis', beat(640), T[4], 4))
        .concat(one('.analysis-note', beat(720), T[4], 2));
    } else if (name === 'subjects') {
      plan.structure = plan.structure
        .concat(one('.page-head', 0))
        .concat(one('.tabs', beat(40)))
        .concat(one('.kpi-strip', START_DATA))
        .concat(seq(list('.kpi'), beat(120), STAGGER[2], T[5], 6))
        .concat(one('.card-chart', beat(200)))
        .concat(one('.card-table', beat(200)))
        .concat(one('.card-side', beat(240)));

      plan.data = plan.data
        .concat(seq(list('.row-link'), beat(200), STAGGER[1], T[5], 4))
        .concat(seq(list('.card-side .analysis-row'), beat(240), STAGGER[1], T[5], 4));
    } else if (name === 'compare') {
      plan.structure = plan.structure
        .concat(one('.page-head', 0))
        .concat(one('.cmp-bar', beat(40)))
        .concat(one('.kpi-strip', START_DATA))
        .concat(seq(list('.kpi'), beat(120), STAGGER[2], T[5], 6))
        .concat(one('.card-radar', beat(200)))
        .concat(one('.card-cmp', beat(200)))
        .concat(one('.card-semesters', beat(240)));

      plan.data = plan.data
        .concat(seq(list('.cmp-row'), beat(160), STAGGER[2], T[5], 4))
        .concat(seq(list('.sem-block'), beat(200), STAGGER[2], T[5], 4));
    } else if (name === 'exams') {
      plan.structure = plan.structure
        .concat(one('.page-head', 0))
        .concat(one('.filter-chips', beat(40)))
        .concat(seq(list('.sem-block'), beat(40), STAGGER[2], T[5], 6));

      plan.data = plan.data
        .concat(seq(list('.row-link'), beat(120), STAGGER[1], T[5], 4))
        .concat(one('.table-foot', beat(320), T[4], 2));
    } else if (name === 'exam') {
      plan.structure = plan.structure
        .concat(one('.page-head', 0))
        .concat(one('.kpi-strip', beat(60)))
        .concat(seq(list('.kpi'), beat(60), STAGGER[2], T[5], 6))
        .concat(one('.detail-peers', beat(120), T[5], 4))
        .concat(one('.statement', beat(200), T[5], 4))
        .concat(seq(list('.sub-card'), beat(200), STAGGER[2], T[5], 6))
        .concat(one('.card-position', beat(200)));

      plan.annotation = plan.annotation.concat(one('.diagnosis', beat(520), T[4], 2));
    } else if (name === 'settings') {
      plan.structure = plan.structure
        .concat(one('.page-head', 0))
        .concat(one('.settings', beat(40)))
        .concat(one('.set-panel', beat(40)))
        .concat(seq(list('.set-card'), beat(40), STAGGER[2], T[5], 6));
    }

    /* 空态自己逐层出现，不再叠一层页面入场 */
    if (mainEl.querySelector('.block-empty')) {
      plan.structure = one('.page-head', 0);
      plan.data = [];
      plan.annotation = [];
    }

    return plan;
  }

  /* 同层错峰由脚本写进变量，样式只读变量 */
  function markEnter(plan, layers) {
    var reduce = reducedMotion();
    Array.prototype.slice.call(mainEl.querySelectorAll('[data-motion="enter"]')).forEach(function (el) {
      el.removeAttribute('data-motion');
      el.style.removeProperty('--enter-delay');
      el.style.removeProperty('--enter-dur');
      el.style.removeProperty('--enter-shift');
    });

    layers.forEach(function (name) {
      plan[name].forEach(function (item) {
        var el = item[0];
        el.setAttribute('data-motion', 'enter');
        el.style.setProperty('--enter-delay', (reduce ? 0 : item[1]) + 'ms');
        el.style.setProperty('--enter-dur', (reduce ? T[1] : item[2]) + 'ms');
        el.style.setProperty('--enter-shift', (reduce ? 0 : item[3]) + 'px');
      });
    });
  }

  /* 图表与条状生长的序号，交给样式里的错峰变量 */
  function markStagger() {
    mainEl.querySelectorAll('.type-bar-row').forEach(function (row, i) {
      var fill = row.querySelector('.type-bar-fill');
      if (fill) fill.style.setProperty('--i', i);
    });
    mainEl.querySelectorAll('.sub-card').forEach(function (card, i) {
      var fill = card.querySelector('.sub-fill');
      if (fill) fill.style.setProperty('--i', i);
    });
    mainEl.querySelectorAll('.cmp-row').forEach(function (row, i) {
      var bar = row.querySelector('.cmp-dbar');
      if (bar) bar.style.setProperty('--i', i);
    });
  }

  function enterPage(name, opts) {
    opts = opts || {};
    var now = Date.now();
    var repeat = lastPage.name === name && now - lastPage.at < 2000;
    var full = opts.full === true && !repeat;
    prevPage = lastPage.name;
    lastPage = { name: name, at: now };
    chartDelay = full ? START_DATA : 0;

    var plan = enterPlan(name);
    markStagger();
    markEnter(plan, full ? ['structure', 'data', 'annotation'] : ['data', 'annotation']);
  }

  /* 页面切换：新旧快照交替，侧栏不动，结束后焦点落到新页标题 */
  function canTransition() {
    return typeof document.startViewTransition === 'function' && !reducedMotion();
  }

  function pageSwap(apply) {
    if (!canTransition()) {
      apply();
      focusHeading();
      return;
    }
    if (pageTransition) {
      pageTransition.skipTransition();
      pageTransition = null;
    }
    var root = document.documentElement;
    root.setAttribute('data-vt', 'page');
    pageTransition = document.startViewTransition(function () {
      apply();
    });
    pageTransition.finished.then(
      function () {
        root.removeAttribute('data-vt');
        pageTransition = null;
        focusHeading();
      },
      function () {
        root.removeAttribute('data-vt');
        pageTransition = null;
      }
    );
  }

  function focusHeading() {
    var h = mainEl.querySelector('h1');
    if (!h) return;
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }

  /* ---------------- 导航 ---------------- */

  function setActive(name) {
    var target = name === 'exam' ? 'exams' : name;
    sideHost.querySelectorAll('.nav-item').forEach(function (item) {
      var href = item.getAttribute('href').replace('#/', '');
      item.classList.toggle('is-active', href === target);
    });
  }

  function render(opts) {
    opts = opts || {};
    var route = parseHash();
    var name = route.name;
    var picked = route.query.type || 'all';
    /* 地址栏里的类型如果已经不存在，就当没筛 */
    if (
      picked !== 'all' &&
      !state.exams.some(function (e) {
        return (e.type || S.DEFAULT_TYPE) === picked;
      })
    ) {
      picked = 'all';
    }
    state.filter = picked;
    var html;
    var title;

    if (name === 'overview') {
      html = V.overview(state);
      title = '总览';
    } else if (name === 'subjects') {
      var firstId = state.config.subjects[0] && state.config.subjects[0].id;
      var sid = route.param || firstId;
      html = V.subjects(state, sid);
      title = '单科分析';
    } else if (name === 'compare') {
      html = V.compare(state, comparePair[0], comparePair[1]);
      title = '两次考试对比';
    } else if (name === 'exams') {
      html = V.exams(state);
      title = '考试记录';
    } else if (name === 'exam') {
      html = V.detail(state, route.param);
      title = '考试详情';
    } else if (name === 'settings') {
      html = V.settings(state, route.query.sec);
      title = '设置';
    } else {
      html = V.overview(state);
      title = '总览';
    }

    document.title = title + ' · 成迹';
    currentView = name;
    resizeHandler = null;

    /* 还在用示例数据的时候在总览说一句，免得当成自己的 */
    if (state.sample && name === 'overview') {
      var sampleCount = S.allSorted(state).length;
      html =
        '<div class="sample-note">' +
        '<span class="sample-tag">示例数据</span>' +
        '<span class="sample-text">这 ' +
        sampleCount +
        ' 场考试、班级名和目标是虚构的。清掉之后从白纸开始录。</span>' +
        '<button type="button" class="sample-clear" data-action="reset-all">清空并开始记录</button>' +
        '</div>' +
        html;
    }

    /* 筛选开着就在每页顶上挂一条，免得看着像全部数据 */
    if (picked !== 'all') {
      var shownCount = S.sorted(state).length;
      var totalCount = S.allSorted(state).length;
      html =
        '<div class="filter-note">' +
        '<span>只看' +
        S.esc(picked) +
        '，' +
        shownCount +
        ' 次</span>' +
        '<button type="button" class="filter-clear" data-exam-filter="all">显示全部 ' +
        totalCount +
        ' 次</button>' +
        '</div>' +
        html;
    }

    mainEl.innerHTML = html;
    setStorageNote(storageNote);
    /* 侧栏里的最近分数跟着筛选走，换了筛选要重建 */
    if (lastSidebarFilter !== picked) {
      lastSidebarFilter = picked;
      refreshSidebar();
    }
    setActive(name);
    if (global.UI) global.UI.mountAll(mainEl);
    initSegs();
    enterPage(name, opts);
    mount(name, opts);
  }

  /* 分段控件的白色滑块：点在哪个上就滑到哪 */
  function moveThumb(seg) {
    var on = seg.querySelector('.seg-btn.is-on');
    var thumb = seg.querySelector('.seg-thumb');
    if (!on || !thumb) return;
    thumb.style.width = on.offsetWidth + 'px';
    thumb.style.transform = 'translateX(' + on.offsetLeft + 'px)';
  }

  function initSegs() {
    mainEl.querySelectorAll('.seg').forEach(function (seg) {
      if (!seg.querySelector('.seg-thumb')) {
        var thumb = document.createElement('span');
        thumb.className = 'seg-thumb';
        seg.insertBefore(thumb, seg.firstChild);
      }
      seg.classList.remove('seg-ready');
      moveThumb(seg);
      void seg.offsetWidth;
      seg.classList.add('seg-ready');
    });
  }

  document.addEventListener('click', function (evt) {
    var btn = evt.target.closest('.seg-btn');
    if (!btn) return;
    var seg = btn.closest('.seg');
    if (!seg) return;
    requestAnimationFrame(function () {
      moveThumb(seg);
    });
  });

  var segResizeTimer = null;
  global.addEventListener('resize', function () {
    clearTimeout(segResizeTimer);
    segResizeTimer = setTimeout(function () {
      document.querySelectorAll('.seg').forEach(moveThumb);
    }, 120);
  });

  /* ---------------- 挂载 ---------------- */

  function mount(name, opts) {
    if (name === 'overview') mountOverview(opts);
    else if (name === 'subjects') mountSubjects(opts);
    else if (name === 'compare') mountCompare(opts);
    else if (name === 'settings') {
      mountSettings();
      initSettingsNav();
    } else if (name === 'exam') mountDetail(opts);
  }

  function mountOverview() {
    var data = readJSONScript('chartData');
    var bullets = readJSONScript('bulletData');
    var host = document.getElementById('trendChart');
    var chart = null;
    var metric = 'total';
    var range = 'all';

    var METRICS = {
      total: {
        title: '总分走势',
        note: '虚线是目标分数线',
        label: '目标',
        unit: '',
        digits: 0,
        invert: false,
        area: true
      },
      rate: {
        title: '得分率走势',
        note: '虚线是目标得分率',
        label: '目标',
        unit: '%',
        digits: 1,
        invert: false,
        area: true
      },
      grade: {
        title: '年级名次走势',
        note: '数值越小越靠上，虚线是目标名次',
        label: '目标',
        unit: ' 名',
        digits: 0,
        invert: true,
        area: false
      },
      classRank: {
        title: '班级名次走势',
        note: '数值越小越靠上，虚线是目标名次',
        label: '目标',
        unit: ' 名',
        digits: 0,
        invert: true,
        area: false
      }
    };

    function pointsFor(key) {
      var exams = data.exams;
      if (range === 'recent') exams = exams.slice(-6);
      else if (range === 'term') {
        /* 本学期 = 和最近一次考试同一个学期 */
        var lastBand = data.bands && data.bands.length ? data.bands[data.bands.length - 1] : null;
        if (lastBand)
          exams = exams.filter(function (e) {
            return e.ts >= lastBand.startTs;
          });
      }
      return exams.map(function (e) {
        return {
          label: e.label,
          sub: e.dateLabel,
          full: e.date + ' · ' + e.name,
          value: e[key],
          ts: e.ts
        };
      });
    }

    function draw(animate) {
      if (!data || !host) return;
      var m = METRICS[metric];
      var opts = {
        target: data.target[metric] || null,
        targetLabel: m.label,
        stackAxis: true,
        height: host.clientWidth < C.COMPACT_WIDTH ? 200 : 232,
        unit: m.unit,
        digits: m.digits,
        invert: m.invert,
        area: m.area,
        xMode: 'time',
        bands: data.bands,
        label: m.title,
        animate: animate !== false,
        delay: chartDelay,
        /* 预测只在总分这一档画，别的指标没有可比的速度 */
        forecast: metric === 'total' && data.forecast ? data.forecast : null
      };
      if (!chart) {
        opts.points = pointsFor(metric);
        chart = C.trend(host, opts);
      } else {
        chart.set(pointsFor(metric), opts);
      }
      var titleEl = document.getElementById('trendTitle');
      var subEl = document.getElementById('trendSub');
      var noteEl = document.getElementById('chartNote');
      if (titleEl) titleEl.textContent = m.title;
      if (subEl) subEl.textContent = '共 ' + data.exams.length + ' 次考试，' + m.note;
      if (noteEl) noteEl.textContent = pointsFor('total').length + ' 次记录';
    }

    draw(true);

    mainEl.querySelectorAll('.seg-metric .seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = btn.getAttribute('data-metric');
        if (next === metric) return;
        metric = next;
        mainEl.querySelectorAll('.seg-metric .seg-btn').forEach(function (b) {
          b.classList.toggle('is-on', b === btn);
        });
        draw(true);
      });
    });

    mainEl.querySelectorAll('.card-trend .seg-sm .seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = btn.getAttribute('data-range');
        if (next === range) return;
        range = next;
        mainEl.querySelectorAll('.card-trend .seg-sm .seg-btn').forEach(function (b) {
          b.classList.toggle('is-on', b === btn);
        });
        draw(true);
      });
    });

    if (bullets) {
      var bulletHost = document.getElementById('subjectBullets');
      if (bulletHost) {
        C.bullets(bulletHost, {
          rows: bullets.map(function (b) {
            return {
              label: b.label,
              valueText: b.valueText,
              rate: b.rate,
              targetRate: b.targetRate,
              hit: b.hit,
              note: b.note
            };
          })
        });
      }
    }

    /* KPI 数字滚动：首次从 0 起，之后从上次的值接上 */
    ['kpiTotal', 'kpiGrade', 'kpiClass', 'kpiGap'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var to = Number(el.textContent);
      if (isNaN(to)) return;
      var from = shownKpis[id];
      C.roll(el, from === undefined ? 0 : from, to, {
        duration: from === undefined ? T[9] : T[6],
        delay: chartDelay + beat(40)
      });
      shownKpis[id] = to;
    });

    bindResize(function () {
      if (currentView !== 'overview') return;
      if (!chart) return;
      chart = null;
      fadeRedraw(host, function () {
        draw(false);
      });
    });
  }

  function mountSubjects() {
    var chart = null;
    var activeTab = mainEl.querySelector('.tab.is-active');
    if (!activeTab) return;
    var activeId = activeTab.getAttribute('data-subject-tab');
    var metric = 'score';
    var current = null;

    var METRICS = {
      score: { sub: '每次考试的得分，虚线是目标分', targetLabel: '目标', unit: '', digits: 0, invert: false },
      rate: { sub: '每次考试的得分率，虚线是目标得分率', targetLabel: '目标', unit: '%', digits: 1, invert: false },
      rank: { sub: '每次考试在班级的名次，数值越小越靠上', targetLabel: '目标', unit: ' 名', digits: 0, invert: true }
    };

    function subjectById(id) {
      return (
        state.config.subjects.find(function (s) {
          return s.id === id;
        }) || state.config.subjects[0]
      );
    }

    function pointsOf(key, parts) {
      if (key === 'rate') return parts.ratePoints;
      if (key === 'rank') return parts.rankPoints;
      return parts.points;
    }

    function targetOf(key, parts) {
      if (key === 'score') return parts.target;
      if (key === 'rate') return parts.rateTarget;
      return null;
    }

    function draw(animate) {
      var host = document.getElementById('subjectChart');
      if (!host || !current) return;
      var m = METRICS[metric];
      var opts = {
        target: targetOf(metric, current),
        targetLabel: m.targetLabel,
        unit: m.unit,
        digits: m.digits,
        invert: m.invert,
        height: host.clientWidth < C.COMPACT_WIDTH ? 200 : 232,
        xMode: 'time',
        bands: current.bands,
        label: '单科走势',
        /* 预测只按得分算，别的指标没有可比的速度 */
        forecast: metric === 'score' ? current.subjectForecast || null : null,
        animate: animate !== false,
        delay: chartDelay
      };
      var points = pointsOf(metric, current);
      if (!chart) {
        opts.points = points;
        chart = C.trend(host, opts);
      } else {
        chart.set(points, opts);
      }
    }

    /* 这一科没有名次记录时，「班内名次」那一档不出 */
    function syncMetricButtons() {
      mainEl.querySelectorAll('.card-chart .seg-metric .seg-btn').forEach(function (btn) {
        var key = btn.getAttribute('data-submetric');
        btn.hidden = key === 'rank' && !current.hasRank;
        btn.classList.toggle('is-on', key === metric);
      });
      var seg = mainEl.querySelector('.card-chart .seg-metric');
      if (seg) moveThumb(seg);
    }

    function syncSub() {
      var subEl = document.getElementById('subjectChartSub');
      if (subEl) subEl.textContent = METRICS[metric].sub;
    }

    current = V.subjectParts(state, subjectById(activeId));
    syncMetricButtons();
    draw(true);

    mainEl.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function (evt) {
        evt.preventDefault();
        var id = tab.getAttribute('data-subject-tab');
        if (id === activeId) return;
        var next = state.config.subjects.find(function (s) {
          return s.id === id;
        });
        if (!next) return;
        activeId = id;
        mainEl.querySelectorAll('.tab').forEach(function (t) {
          var on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        current = V.subjectParts(state, next);
        /* 换到没有名次的科目时退回得分 */
        if (metric === 'rank' && !current.hasRank) metric = 'score';
        var parts = current;
        /* 卡片外框不动，只让里面的内容换一遍 */
        var strip = mainEl.querySelector('.kpi-strip');
        if (strip) {
          var before = [];
          strip.querySelectorAll('.kpi-value').forEach(function (el) {
            before.push(Number(el.textContent));
          });
          strip.innerHTML = parts.kpiItems;
          strip.querySelectorAll('.kpi-value').forEach(function (el, i) {
            var to = Number(el.textContent);
            if (isNaN(to) || isNaN(before[i])) return;
            C.roll(el, before[i], to, { duration: T[6] });
          });
          strip.classList.remove('text-swap');
          void strip.offsetWidth;
          strip.classList.add('text-swap');
        }
        swapContent(mainEl.querySelector('.card-side [data-block="side"]'), parts.sideBody, { dur: T[3] });
        var rows = mainEl.querySelector('.card-table [data-block="rows"]');
        if (rows) {
          swapContent(rows, parts.tableRows, { stagger: STAGGER[1], dur: T[4] });
        }
        var countEl = mainEl.querySelector('.card-table [data-count]');
        if (countEl) countEl.textContent = parts.tableCount + ' 次';
        var titleEl = document.getElementById('subjectChartTitle');
        if (titleEl) {
          titleEl.textContent = next.name + '走势';
          titleEl.classList.remove('text-swap');
          void titleEl.offsetWidth;
          titleEl.classList.add('text-swap');
        }
        syncMetricButtons();
        syncSub();
        draw(true);
        if (global.history && global.history.replaceState) {
          global.history.replaceState(null, '', '#/subjects/' + id);
        }
      });
    });

    mainEl.querySelectorAll('.card-chart .seg-metric .seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var next = btn.getAttribute('data-submetric');
        if (next === metric || btn.hidden) return;
        metric = next;
        syncMetricButtons();
        syncSub();
        draw(true);
      });
    });

    bindResize(function () {
      if (currentView !== 'subjects') return;
      current = V.subjectParts(state, subjectById(activeId));
      var host = document.getElementById('subjectChart');
      chart = null;
      fadeRedraw(host, function () {
        draw(false);
      });
    });
  }

  /* 同区域换内容：旧内容先退，新内容再进，外框不动 */
  function swapContent(el, html, opts) {
    opts = opts || {};
    if (!el) return;
    if (el._swapTimer) clearTimeout(el._swapTimer);
    if (reducedMotion()) {
      el.removeAttribute('data-motion');
      el.innerHTML = html;
      return;
    }
    el.setAttribute('data-motion', 'swap-out');
    el._swapTimer = setTimeout(
      function () {
        el.removeAttribute('data-motion');
        el.innerHTML = html;
        var kids = Array.prototype.slice.call(el.children);
        kids.forEach(function (node, i) {
          node.setAttribute('data-motion', 'enter');
          node.style.setProperty('--enter-delay', (opts.stagger || 0) * i + 'ms');
          node.style.setProperty('--enter-dur', (opts.dur || T[4]) + 'ms');
          node.style.setProperty('--enter-shift', '4px');
        });
        if (!kids.length) el.setAttribute('data-motion', 'swap');
        clearTimeout(el._swapClean);
        el._swapClean = setTimeout(
          function () {
            el.removeAttribute('data-motion');
            Array.prototype.slice.call(el.querySelectorAll('[data-motion="enter"]')).forEach(function (node) {
              node.removeAttribute('data-motion');
            });
          },
          (opts.dur || T[4]) + (opts.stagger || 0) * kids.length + 40
        );
      },
      opts.out === undefined ? T[2] : opts.out
    );
  }

  var resizeHandler = null;
  var resizeTimer = null;
  global.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (typeof resizeHandler === 'function') resizeHandler();
    }, 150);
  });
  function bindResize(fn) {
    resizeHandler = fn;
  }

  /* 左栏选中块滑到当前这一项；刚进来时从顶部滑下去 */
  function initSettingsNav() {
    var host = document.querySelector('.set-nav');
    if (!host) return;
    var thumb = host.querySelector('.set-nav-thumb');
    var on = host.querySelector('.set-nav-item.is-on');
    if (!thumb || !on) return;
    var first = !host.classList.contains('is-ready');
    host.classList.remove('is-ready');
    if (first) {
      thumb.style.height = '0px';
      thumb.style.transform = 'translateY(0px)';
      void host.offsetWidth;
      host.classList.add('is-ready');
      void host.offsetWidth;
    }
    thumb.style.height = on.offsetHeight + 'px';
    thumb.style.transform = 'translateY(' + on.offsetTop + 'px)';
    void host.offsetWidth;
    host.classList.add('is-ready');
  }

  /* 设置页左栏换分区：左栏先滑，右栏淡出再换内容 */
  function openSettingsSection(sec) {
    var route = parseHash();
    if (route.name !== 'settings') return;
    var panel = document.getElementById('settingsPanel');
    if (!panel) return;
    if ((route.query.sec || 'goal') === sec) return;
    if (panel.classList.contains('is-leaving')) return;

    global.history.replaceState(null, '', '#/settings?sec=' + sec);

    document.querySelectorAll('.set-nav-item').forEach(function (item) {
      var on = item.getAttribute('data-sec') === sec;
      item.classList.toggle('is-on', on);
      if (on) item.setAttribute('aria-current', 'true');
      else item.removeAttribute('aria-current');
    });
    initSettingsNav();

    if (global.scrollY > 0) global.scrollTo({ top: 0 });
    panel.classList.add('is-leaving');
    setTimeout(function () {
      panel.innerHTML = V.settingsPanel(state, sec);
      if (global.UI) global.UI.mountAll(panel);
      initSegs();
      mountSettings();
      panel.classList.remove('is-leaving');
      Array.prototype.slice.call(panel.querySelectorAll('.set-card')).forEach(function (card, i) {
        card.setAttribute('data-motion', 'enter');
        card.style.setProperty('--enter-delay', STAGGER[2] + i * STAGGER[2] + 'ms');
        card.style.setProperty('--enter-dur', T[4] + 'ms');
        card.style.setProperty('--enter-shift', '6px');
      });
    }, T[2]);
  }

  /* 只重画设置页这一块，不整页重来，也不用重放进入动画 */
  function refreshSettingsPanel() {
    var panel = document.getElementById('settingsPanel');
    if (!panel || currentView !== 'settings') return;
    var sec = parseHash().query.sec || 'goal';
    panel.innerHTML = V.settingsPanel(state, sec);
    if (global.UI) global.UI.mountAll(panel);
    initSegs();
    mountSettings();
    Array.prototype.slice.call(panel.querySelectorAll('.set-value, .app-meta')).forEach(function (el) {
      el.classList.remove('text-swap');
      void el.offsetWidth;
      el.classList.add('text-swap');
    });
  }

  /* 侧栏底部的深浅色按钮：收起和展开都不重建侧栏 */
  function setThemeToggleVisible(show) {
    var btn = document.getElementById('themeToggle');
    if (show) {
      if (btn) {
        btn.classList.remove('is-away');
        return;
      }
      var side = document.querySelector('.side');
      if (!side) return;
      side.insertAdjacentHTML('beforeend', V.themeToggleHTML());
      var fresh = document.getElementById('themeToggle');
      if (!fresh) return;
      fresh.classList.add('is-away');
      void fresh.offsetWidth;
      fresh.classList.remove('is-away');
      updateThemeButtons();
      return;
    }
    if (!btn) return;
    btn.classList.add('is-away');
    setTimeout(function () {
      if (btn.parentNode) btn.parentNode.removeChild(btn);
    }, T[4]);
  }

  function mountSettings() {
    var c = state.config;

    function commit() {
      state.sample = false;
      var ok = persist();
      refreshSidebar();
      return ok;
    }

    /* 存不进去：红边抖两下，文字说明同时还在 */
    function pulseBad(el) {
      el.classList.remove('is-bad');
      void el.offsetWidth;
      el.classList.add('is-bad');
      clearTimeout(el._badTimer);
      el._badTimer = setTimeout(function () {
        el.classList.remove('is-bad');
      }, T[3]);
    }

    /* 设置项：控件上带 data-cfg，上下限直接读控件属性 */
    mainEl.querySelectorAll('[data-cfg]').forEach(function (el) {
      el.addEventListener('change', function () {
        var key = el.getAttribute('data-cfg');
        var numeric = el.type === 'number';
        var value = numeric ? Number(el.value) : el.value;
        if (numeric) {
          if (isNaN(value)) return;
          var min = el.getAttribute('min');
          var max = el.getAttribute('max');
          if (min !== null && value < Number(min)) value = Number(min);
          if (max !== null && value > Number(max)) value = Number(max);
          if (value !== Number(el.value)) el.value = value;
        }
        c[key] = value;
        /* 存不进去就红一下，别给「已保存」的绿框 */
        if (!commit()) {
          pulseBad(el);
          return;
        }
        el.classList.remove('is-saved');
        void el.offsetWidth;
        el.classList.add('is-saved');
        clearTimeout(el._savedTimer);
        el._savedTimer = setTimeout(function () {
          el.classList.remove('is-saved');
        }, T[6]);
      });
    });

    /* 改类型名：旧名字下挂着的考试一起换过去 */
    mainEl.querySelectorAll('.type-name').forEach(function (input) {
      input.addEventListener('change', function () {
        var oldName = input.getAttribute('data-type-old');
        var next = (input.value || '').trim().slice(0, S.TYPE_NAME_MAX);
        if (!next || next === oldName) {
          input.value = oldName;
          return;
        }
        if ((c.types || []).indexOf(next) >= 0) {
          input.value = oldName;
          toast('已经有这个类型了', 'bad');
          return;
        }
        c.types = (c.types || []).map(function (t) {
          return t === oldName ? next : t;
        });
        state.exams.forEach(function (e) {
          if ((e.type || S.DEFAULT_TYPE) === oldName) e.type = next;
        });
        if (state.filter === oldName) state.filter = next;
        state.sample = false;
        persist();
        render();
        toast('「' + oldName + '」改成了「' + next + '」');
      });
    });

    mainEl.querySelectorAll('.table-form tbody tr').forEach(function (tr) {
      var id = tr.getAttribute('data-subject');
      var subject = c.subjects.find(function (s) {
        return s.id === id;
      });
      if (!subject) return;
      tr.querySelectorAll('input[data-field]').forEach(function (input) {
        input.addEventListener('change', function () {
          var field = input.getAttribute('data-field');
          if (field === 'name') {
            subject.name = input.value.trim() || subject.name;
            input.value = subject.name;
          } else {
            var num = Number(input.value);
            if (isNaN(num) || num < 0) {
              input.value = subject[field];
              return;
            }
            if (field === 'full') {
              if (num < 1) {
                input.value = subject.full;
                return;
              }
              subject.full = Math.min(num, S.SUBJECT_FULL_MAX);
              input.value = subject.full;
              if (Number(subject.target) > subject.full) {
                subject.target = subject.full;
                var tEl = tr.querySelector('[data-field="target"]');
                if (tEl) {
                  tEl.value = subject.target;
                  tEl.max = subject.full;
                }
              }
            } else {
              subject[field] = Math.min(num, Number(subject.full) || num);
              input.value = subject[field];
            }
          }
          state.sample = false;
          persist();
          var rateCell = tr.querySelector('td:last-child');
          if (rateCell) {
            rateCell.textContent = subject.full ? S.pctText(Number(subject.target || 0) / Number(subject.full)) : '—';
          }
          refreshSidebar();
          tr.classList.remove('is-flash');
          void tr.offsetWidth;
          tr.classList.add('is-flash');
          clearTimeout(tr._flashTimer);
          tr._flashTimer = setTimeout(function () {
            tr.classList.remove('is-flash');
          }, T[3]);
        });
      });
    });
  }

  function mountCompare() {
    var data = readJSONScript('compareData');
    var host = document.getElementById('cmpRadar');
    if (data && host) {
      C.radar(host, {
        labels: data.labels,
        layers: [
          { name: '起点', values: data.a.values, style: 'dash' },
          { name: '终点', values: data.b.values, style: 'solid' }
        ],
        size: Math.min(320, host.clientWidth || 300),
        /* 同一页里换组合时从旧形状长过去，不再重播一次入场 */
        from: prevPage === 'compare' ? lastRadar : null
      });
      lastRadar = [data.a.values, data.b.values];
    }

    mainEl.querySelectorAll('.cmp-bar .sel').forEach(function (sel) {
      sel.addEventListener('selchange', function () {
        var aSel = mainEl.querySelector('.cmp-bar .sel[data-pick="a"]');
        var bSel = mainEl.querySelector('.cmp-bar .sel[data-pick="b"]');
        var pick = sel.getAttribute('data-pick');
        comparePair = [aSel.getAttribute('data-value'), bSel.getAttribute('data-value')];
        render();
        var again = mainEl.querySelector('.cmp-bar .sel[data-pick="' + pick + '"] .sel-btn');
        if (again) again.focus();
      });
    });

    var swapBtn = mainEl.querySelector('[data-action="swap-pair"]');
    if (swapBtn) {
      swapBtn.addEventListener('click', function () {
        var aSel = mainEl.querySelector('.cmp-bar .sel[data-pick="a"]');
        var bSel = mainEl.querySelector('.cmp-bar .sel[data-pick="b"]');
        comparePair = [bSel.getAttribute('data-value'), aSel.getAttribute('data-value')];
        render();
      });
    }
  }

  function mountDetail() {
    var data = readJSONScript('positionData');
    var host = document.getElementById('positionChart');
    if (!data || !host) return;
    var draw = function (animate) {
      C.trend(host, {
        points: data.points,
        target: S.targetTotal(state),
        targetLabel: '目标',
        height: host.clientWidth < C.COMPACT_WIDTH ? 220 : 240,
        xMode: 'time',
        bands: data.bands,
        highlightIndex: data.index,
        label: '总分走势',
        delay: chartDelay,
        animate: animate !== false
      });
    };
    draw();
    bindResize(function () {
      if (currentView !== 'exam') return;
      fadeRedraw(host, function () {
        draw(false);
      });
    });
  }

  var brandPlayed = false;

  function refreshSidebar() {
    var route = parseHash();
    sideHost.innerHTML = V.sidebar(state, route.name === 'exam' ? 'exams' : route.name);
    updateThemeButtons();
    if (!brandPlayed) {
      brandPlayed = true;
      var brand = sideHost.querySelector('.brand');
      if (brand) brand.classList.add('is-boot');
    }
  }

  /* ---------------- 对话框 ---------------- */

  function openDialog(html, onMount) {
    dialogRoot.innerHTML = html;
    var dlg = dialogRoot.querySelector('dialog');
    if (!dlg) return;
    var opener = document.activeElement;
    if (typeof dlg.showModal === 'function') {
      dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
    document.body.classList.add('no-scroll');
    dlg.addEventListener('close', function () {
      document.body.classList.remove('no-scroll');
      dialogRoot.replaceChildren();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
    });
    if (onMount) onMount(dlg);
    if (global.UI) global.UI.mountAll(dlg);
    /* 打开后直接落到第一个能填的字段，不用再点一下 */
    var first = dlg.querySelector('.form-body input:not([type="hidden"]), .form-body select, .form-body textarea');
    if (first) first.focus();
    return dlg;
  }

  function closeDialog() {
    var dlg = dialogRoot.querySelector('dialog');
    if (!dlg || dlg.classList.contains('is-closing')) return;
    var finish = function () {
      if (typeof dlg.close === 'function') dlg.close();
      else {
        dlg.removeAttribute('open');
        dialogRoot.replaceChildren();
        document.body.classList.remove('no-scroll');
      }
    };
    if (C.reduced()) {
      finish();
      return;
    }
    /* 面板先走，遮罩后走；走完再收 */
    dlg.classList.add('is-closing');
    setTimeout(finish, T[4]);
  }

  /* 确认框：标题、正文、按钮文字和确认动作 */
  function confirmDialog(o) {
    openDialog(
      '<dialog class="dialog dialog-confirm">' +
        '<div class="form-head"><h2>' +
        o.title +
        '</h2></div>' +
        '<div class="form-body"><p class="confirm-text">' +
        o.text +
        '</p></div>' +
        '<div class="form-foot"><button class="btn btn-ghost" data-action="close-dialog">取消</button>' +
        '<button class="btn ' +
        (o.danger ? 'btn-danger' : 'btn-primary') +
        '" data-action="confirm">' +
        o.label +
        '</button></div>' +
        '</dialog>',
      function (dlg) {
        dlg.querySelector('[data-action="confirm"]').addEventListener('click', o.onConfirm);
      }
    );
  }

  function openExamForm(exam) {
    openDialog('<dialog class="dialog">' + V.examForm(state, exam) + '</dialog>', function (dlg) {
      var form = dlg.querySelector('#examForm');
      var totalEl = dlg.querySelector('#formTotal');
      var errEl = dlg.querySelector('#formError');
      var subjects = readJSONScript('formSubjects');
      var nameEl = dlg.querySelector('#fName');
      var dateEl = dlg.querySelector('.datep[data-field="date"], #fDate');
      var typeEl = dlg.querySelector('.sel[data-field="type"]');
      var examId = exam ? exam.id : null;

      /* 灰字跟着日期和类型走，改哪一样都重算 */
      function refreshHint() {
        var day = dateEl ? dateEl.getAttribute('data-value') : '';
        var kind = typeEl ? typeEl.getAttribute('data-value') : S.DEFAULT_TYPE;
        nameEl.placeholder = S.suggestName(state, day, kind, examId);
      }
      form.addEventListener('datechange', function (evt) {
        if (evt.target === dateEl) refreshHint();
      });
      form.addEventListener('selchange', function (evt) {
        if (evt.target === typeEl) refreshHint();
      });

      function recalc() {
        var sum = 0;
        dlg.querySelectorAll('input[data-subject]').forEach(function (input) {
          var v = Number(input.value);
          if (!isNaN(v) && v > 0) sum += v;
        });
        C.roll(totalEl, undefined, sum, { duration: T[3] });
      }

      /* 出错时：说清哪里不对，同时让那个字段抖一下 */
      function showError(text, fieldEl) {
        errEl.textContent = text;
        errEl.classList.remove('is-swapped');
        void errEl.offsetWidth;
        errEl.classList.add('is-swapped');
        if (!fieldEl) return;
        fieldEl.classList.remove('is-bad');
        void fieldEl.offsetWidth;
        fieldEl.classList.add('is-bad');
        clearTimeout(fieldEl._badTimer);
        fieldEl._badTimer = setTimeout(function () {
          fieldEl.classList.remove('is-bad');
        }, T[3]);
      }

      dlg.querySelectorAll('input[data-subject]').forEach(function (input) {
        input.addEventListener('input', recalc);
      });
      recalc();

      /* 排名格后面的「/ 人数」跟着这一场的人数走 */
      var sizeEls = {
        class: dlg.querySelector('#fClassSize'),
        grade: dlg.querySelector('#fGradeSize')
      };
      function refreshSizeSuffix() {
        dlg.querySelectorAll('[data-size-of]').forEach(function (el) {
          var kind = el.getAttribute('data-size-of');
          var input = sizeEls[kind];
          var n = input ? Number(input.value) : 0;
          el.textContent = '/ ' + (n > 0 ? n : S.examSize(state, {}, kind));
        });
      }
      Object.keys(sizeEls).forEach(function (kind) {
        if (sizeEls[kind]) sizeEls[kind].addEventListener('input', refreshSizeSuffix);
      });

      /* 缺考和空着是两回事，点一下把这一科标下来 */
      dlg.querySelectorAll('.absent-toggle').forEach(function (btn) {
        btn.addEventListener('click', function (evt) {
          evt.preventDefault();
          var field = btn.closest('.field-score');
          var input = field.querySelector('input[data-subject]');
          var on = btn.getAttribute('aria-pressed') !== 'true';
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          field.classList.toggle('is-absent', on);
          input.disabled = on;
          if (on) input.value = '';
          input.placeholder = on ? S.ABSENT_TEXT : '—';
          recalc();
        });
      });

      form.addEventListener('submit', function (evt) {
        evt.preventDefault();
        /* 关闭动画里再按一次回车，不要重复记一场 */
        if (dlg.classList.contains('is-closing')) return;
        var name = nameEl.value.trim();
        var date = dateEl ? dateEl.getAttribute('data-value') : '';
        var type = typeEl ? typeEl.getAttribute('data-value') : S.DEFAULT_TYPE;

        if (!date) {
          showError('先填日期。', dateEl ? dateEl.querySelector('.date-btn') : null);
          return;
        }
        if (!name) name = S.suggestName(state, date, type, examId);

        var scores = {};
        var filled = 0;
        var bad = '';
        var badEl = null;
        dlg.querySelectorAll('input[data-subject]').forEach(function (input) {
          var id = input.getAttribute('data-subject');
          var raw = input.value.trim();
          if (raw === '') return;
          var num = Number(raw);
          var subject = subjects.find(function (s) {
            return s.id === id;
          });
          if (!subject) return;
          if (isNaN(num) || num < 0) {
            if (!bad) badEl = input;
            bad = bad || subject.name + ' 的分数不是有效数字';
            return;
          }
          if (num > subject.full) {
            if (!bad) badEl = input;
            bad = bad || subject.name + ' 超过满分 ' + subject.full + ' 分';
            return;
          }
          scores[id] = num;
          filled++;
        });

        if (bad) {
          showError(bad, badEl);
          return;
        }

        var absent = [];
        dlg.querySelectorAll('.absent-toggle').forEach(function (btn) {
          if (btn.getAttribute('aria-pressed') === 'true') absent.push(btn.getAttribute('data-absent'));
        });
        if (!filled && !absent.length) {
          showError('至少填一科分数。', dlg.querySelector('input[data-subject]'));
          return;
        }

        var pickRank = function (id) {
          var n = Number(dlg.querySelector(id).value);
          return n > 0 ? Math.round(n) : null;
        };
        var ranks = {
          class: pickRank('#fClass'),
          grade: pickRank('#fGrade')
        };

        /* 空着的人数不写进记录，仍然跟设置走 */
        var sizes = {};
        [
          ['class', '#fClassSize'],
          ['grade', '#fGradeSize']
        ].forEach(function (pair) {
          var n = pickRank(pair[1]);
          if (n) sizes[pair[0]] = n;
        });

        var averages = {
          class: Number(dlg.querySelector('#fAvgClass').value) || null,
          grade: Number(dlg.querySelector('#fAvgGrade').value) || null,
          top: Number(dlg.querySelector('#fAvgTop').value) || null
        };

        var subjectRanks = {};
        dlg.querySelectorAll('[data-subrank]').forEach(function (input) {
          var n = Number(input.value);
          if (n > 0) subjectRanks[input.getAttribute('data-subrank')] = n;
        });

        var subjectAverages = {};
        dlg.querySelectorAll('[data-subavg]').forEach(function (input) {
          var n = Number(input.value);
          if (n > 0) subjectAverages[input.getAttribute('data-subavg')] = n;
        });

        if (exam) {
          exam.name = name;
          exam.date = date;
          exam.type = type;
          exam.scores = scores;
          exam.ranks = ranks;
          exam.sizes = sizes;
          exam.averages = averages;
          exam.absent = absent;
          exam.subjectRanks = subjectRanks;
          exam.subjectAverages = subjectAverages;
          state.sample = false;
          toast('已保存这次考试');
        } else {
          state.exams.push({
            id: S.uid(),
            name: name,
            date: date,
            type: type,
            scores: scores,
            ranks: ranks,
            sizes: sizes,
            averages: averages,
            absent: absent,
            subjectRanks: subjectRanks,
            subjectAverages: subjectAverages
          });
          toast('已记录「' + name + '」');
        }
        var commitExam = function () {
          state.sample = false;
          persist();
          closeDialog();
          refreshSidebar();
          render();
        };

        /* 先让按钮给出回应，再收对话框 */
        var saveBtn = form.querySelector('button[type="submit"]');
        if (saveBtn && !reducedMotion()) {
          saveBtn.textContent = '已保存';
          saveBtn.classList.add('is-saved');
          setTimeout(commitExam, T[3]);
          return;
        }
        commitExam();
      });
    });
  }

  /* ---------------- 导入导出 ---------------- */

  function exportJSON() {
    download('成迹-备份-' + todayStamp() + '.json', JSON.stringify(state, null, 2), 'application/json');
    toast('备份已下载');
  }

  /* Excel 组件有九百多 KB，平时不加载，用到再取 */
  var xlsxLoading = null;

  function loadXLSX() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (xlsxLoading) return xlsxLoading;
    xlsxLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = 'vendor/xlsx.full.min.js';
      s.async = true;
      s.onload = function () {
        resolve(global.XLSX);
      };
      s.onerror = function () {
        xlsxLoading = null;
        reject(new Error('load failed'));
      };
      document.head.appendChild(s);
    });
    return xlsxLoading;
  }

  function exportXLSX() {
    toast('正在准备 Excel 组件');
    loadXLSX()
      .then(function () {
        buildXLSX();
      })
      .catch(function () {
        toast('Excel 组件加载失败，改用 CSV 导出', 'bad');
      });
  }

  function buildXLSX() {
    var head = S.examHeader(state.config.subjects);
    var rows = [head].concat(S.examRows(state));

    var sheet = global.XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = head.map(function (h) {
      return { wch: Math.max(8, Math.min(18, h.length * 2 + 4)) };
    });
    var book = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(book, sheet, '成绩');
    global.XLSX.writeFile(book, '成迹-成绩-' + todayStamp() + '.xlsx');
    toast('表格已下载');
  }

  /* 导出一份能直接看的分析报告 */
  function exportReport() {
    var list = S.allSorted(state);
    if (!list.length) {
      toast('还没有成绩记录', 'bad');
      return;
    }
    var last = list[list.length - 1];
    /* 报告里的结论和明细都按全部记录算，不受类型筛选影响 */
    var plain = Object.assign({}, state, { filter: 'all' });
    var ins = S.insight(plain);
    var peers = S.examVsPeers(plain, last);
    var spread = S.subjectSpread(plain, last);
    var road = S.pace(plain);
    var term = S.termForecast(plain);
    var prio = S.priority(plain, last);
    var smooth = S.smoothMovers(plain);
    var sub = state.config.subjects;

    function row(k, v) {
      return '<tr><th>' + k + '</th><td>' + v + '</td></tr>';
    }

    var subjectRows = sub
      .map(function (s) {
        var v = Number(last.scores[s.id]);
        var t = Number(s.target) || 0;
        var avg = Number((last.subjectAverages || {})[s.id]) || null;
        var rk = Number((last.subjectRanks || {})[s.id]) || null;
        return (
          '<tr>' +
          '<td>' +
          S.esc(s.name) +
          '</td>' +
          '<td class="num">' +
          (isNaN(v) ? '—' : v + ' / ' + s.full) +
          '</td>' +
          '<td class="num">' +
          (isNaN(v) || !Number(s.full) ? '—' : S.pctText(v / s.full)) +
          '</td>' +
          '<td class="num">' +
          (avg === null ? '—' : avg) +
          '</td>' +
          '<td class="num">' +
          (rk === null ? '—' : '第 ' + rk + ' 名') +
          '</td>' +
          '<td class="num">' +
          (isNaN(v) || !t ? '—' : v >= t ? '达标' : '差 ' + (t - v)) +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    var html =
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>成绩分析报告</title><style>' +
      ':root{--ink:#111;--dim:#666;--faint:#999;--rule:#ddd;--hair:#eee}' +
      'body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:var(--ink);line-height:1.7}' +
      'h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--rule)}' +
      '.meta{color:var(--dim);font-size:13px;margin-bottom:22px}' +
      'p{margin:6px 0}.lead{font-size:15px;font-weight:600}' +
      'table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}' +
      'th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--hair)}' +
      'th{font-weight:400;color:var(--dim);width:38%}' +
      'td.num{text-align:right;font-variant-numeric:tabular-nums}' +
      'ul{margin:6px 0;padding-left:18px}li{margin:3px 0;font-size:13px}' +
      'footer{margin-top:34px;color:var(--faint);font-size:12px}' +
      '</style></head><body>' +
      '<h1>成绩分析报告</h1>' +
      '<p class="meta">' +
      S.esc(last.name) +
      ' · ' +
      S.cnDate(last.date) +
      ' · 共 ' +
      list.length +
      ' 次记录</p>' +
      '<h2>这次的结论</h2>' +
      '<p class="lead">' +
      (ins ? ins.headlines.map(S.esc).join('，') : '') +
      '</p>' +
      (road && road.predict !== null
        ? '<p>' +
          (term
            ? '按' +
              term.term +
              '这几场的速度，下次大约 ' +
              Math.round(term.next) +
              ' 分，学期末大约 ' +
              Math.round(term.end) +
              ' 分。'
            : '') +
          '按最近六次算，下次大约 ' +
          Math.round(road.predict) +
          ' 分' +
          (road.needPerExam !== null
            ? '；剩 ' + road.remaining + ' 场，每场要涨 ' + road.needPerExam.toFixed(1) + ' 分才够。'
            : '。') +
          '</p>'
        : '') +
      '<h2>和同学比</h2>' +
      (peers.vsClass !== null || peers.vsGrade !== null
        ? '<table>' +
          (peers.vsClass !== null
            ? row(
                '班级平均',
                peers.classAvg + '（' + (peers.vsClass >= 0 ? '高 ' : '低 ') + Math.abs(peers.vsClass) + ' 分）'
              )
            : '') +
          (peers.vsGrade !== null
            ? row(
                '年级平均',
                peers.gradeAvg + '（' + (peers.vsGrade >= 0 ? '高 ' : '低 ') + Math.abs(peers.vsGrade) + ' 分）'
              )
            : '') +
          (peers.toTop !== null ? row('年级最高', peers.top + '（差 ' + peers.toTop + ' 分）') : '') +
          '</table>' +
          (peers.diagnosis ? '<p>' + S.esc(peers.diagnosis.text) + '。</p>' : '')
        : '<p>这次没有填班级平均或年级平均，判断不了是题难还是状态问题。</p>') +
      '<h2>各科明细</h2>' +
      '<table><tr><th>科目</th><th class="num">得分</th><th class="num">得分率</th><th class="num">班平</th><th class="num">班内名次</th><th class="num">距目标</th></tr>' +
      subjectRows +
      '</table>' +
      '<h2>偏科</h2>' +
      (spread
        ? '<p>最强 ' +
          S.esc(spread.strongest.name) +
          ' ' +
          spread.strongest.rate.toFixed(1) +
          '%，最弱 ' +
          S.esc(spread.weakest.name) +
          ' ' +
          spread.weakest.rate.toFixed(1) +
          '%，相差 ' +
          spread.spread.toFixed(1) +
          ' 个百分点，整体' +
          spread.level.text +
          '。及格 ' +
          spread.pass +
          ' 科，优秀 ' +
          spread.good +
          ' 科。</p>'
        : '') +
      '<h2>下一步</h2>' +
      '<ul>' +
      (prio.length
        ? '<li>先补 ' +
          S.esc(prio[0].subject.name) +
          '，还差 ' +
          prio[0].gap +
          ' 分（占满分 ' +
          (prio[0].gapRate * 100).toFixed(0) +
          '%）。</li>'
        : '') +
      (smooth.up.length
        ? '<li>最近三场进步最多的是 ' +
          S.esc(smooth.up[0].subject.name) +
          '，' +
          S.signed(smooth.up[0].delta) +
          ' 分，保持。</li>'
        : '') +
      (smooth.down.length
        ? '<li>最近三场回落最多的是 ' +
          S.esc(smooth.down[0].subject.name) +
          '，' +
          S.signed(smooth.down[0].delta) +
          ' 分。</li>'
        : '') +
      (road && road.needPerExam !== null && road.needPerExam > 0
        ? '<li>离目标还差 ' +
          road.gap +
          ' 分，剩 ' +
          road.remaining +
          ' 场，每场至少涨 ' +
          road.needPerExam.toFixed(1) +
          ' 分。</li>'
        : '') +
      '</ul>' +
      '<footer>由成迹生成 · ' +
      new Date().toLocaleString('zh-CN') +
      '</footer>' +
      '</body></html>';

    download('成迹-报告-' + todayStamp() + '.html', html, 'text/html;charset=utf-8');
    toast('报告已下载');
  }

  function exportCSV() {
    var csv = '\uFEFF' + S.toCSV(state);
    download('成迹-成绩-' + todayStamp() + '.csv', csv, 'text/csv;charset=utf-8');
    toast('表格已下载');
  }

  function downloadTemplate() {
    var subs = state.config.subjects;
    var head = S.examHeader(subs);
    var sample = ['高二上 · 第三次月考', '2026-12-11', S.DEFAULT_TYPE]
      .concat(
        subs.map(function (s) {
          return Math.round(Number(s.full) * 0.82);
        })
      )
      .concat(
        subs.map(function () {
          return '';
        })
      )
      .concat(
        subs.map(function (s) {
          return Math.round(Number(s.full) * 0.68);
        })
      )
      .concat(['4', '88', '446', '441', '682']);
    var csv =
      '\uFEFF' +
      [head, sample]
        .map(function (row) {
          return row.join(',');
        })
        .join('\r\n');
    download('成迹-导入模板.csv', csv, 'text/csv;charset=utf-8');
    toast('模板已下载');
  }

  function handleFile(file, kind) {
    if (!file) return;
    var reader = new FileReader();

    if (kind === 'json') {
      reader.onload = function (evt) {
        try {
          var parsed = JSON.parse(String(evt.target.result));
          /* 备份里一定有 exams 数组，结构不对就别动现有数据 */
          if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.exams)) {
            toast('这不是成迹的备份文件', 'bad');
            return;
          }
          var next = S.normalize(parsed);
          next.sample = false;
          pushUndo();
          state = next;
          persist();
          shownKpis = {};
          refreshSidebar();
          render();
          toast('备份已恢复：' + state.exams.length + ' 次考试', null, UNDO);
        } catch (err) {
          toast('这个备份文件读不出来', 'bad');
        }
      };
      reader.readAsText(file, 'utf-8');
    } else if (kind === 'xlsx') {
      toast('正在准备 Excel 组件');
      loadXLSX()
        .then(function () {
          reader.onload = function (evt) {
            try {
              var data = new Uint8Array(evt.target.result);
              var wb = global.XLSX.read(data, { type: 'array' });
              var sheet = wb.Sheets[wb.SheetNames[0]];
              var rows = global.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
              ingest(rows);
            } catch (err) {
              toast('这个 Excel 文件读不出来', 'bad');
            }
          };
          reader.readAsArrayBuffer(file);
        })
        .catch(function () {
          toast('Excel 组件加载失败，请改用 CSV', 'bad');
        });
    } else {
      reader.onload = function (evt) {
        var rows = S.parseCSV(String(evt.target.result));
        ingest(rows);
      };
      reader.readAsText(file, 'utf-8');
    }
  }

  /* 先看会改哪几条，确认之后再写进去 */
  function previewImport(rows, errors) {
    var plan = S.planImport(state, rows);

    function facts() {
      var out = [];
      if (plan.replaced.length)
        out.push(
          '<div class="import-fact"><b class="num">' + plan.replaced.length + '</b><span>次会被覆盖</span></div>'
        );
      if (plan.added.length)
        out.push('<div class="import-fact"><b class="num">' + plan.added.length + '</b><span>次会新增</span></div>');
      if (errors.length)
        out.push('<div class="import-fact"><b class="num">' + errors.length + '</b><span>行会被跳过</span></div>');
      return out.join('');
    }

    function block(title, list) {
      var head = list
        .slice(0, 6)
        .map(function (p) {
          var e = p.incoming || p;
          return '<li>' + S.esc(e.date) + ' · ' + S.esc(e.name) + '</li>';
        })
        .join('');
      var rest = list.length - 6;
      return (
        '<div class="import-block"><div class="import-title">' +
        title +
        '</div>' +
        '<ul class="import-list">' +
        head +
        (rest > 0 ? '<li class="muted">还有 ' + rest + ' 次</li>' : '') +
        '</ul></div>'
      );
    }

    openDialog(
      '<dialog class="dialog dialog-import">' +
        '<div class="form-head"><h2>导入预览</h2></div>' +
        '<div class="form-body">' +
        '  <div class="import-facts">' +
        facts() +
        '</div>' +
        (plan.replaced.length ? block('按「日期 + 名称」找到的记录，会被这次的内容盖掉', plan.replaced) : '') +
        (plan.added.length ? block('这些会加进来', plan.added) : '') +
        (errors.length ? block('这些行读不出来，会跳过', errors) : '') +
        '</div>' +
        '<div class="form-foot">' +
        '  <button type="button" class="btn btn-ghost" data-action="close-dialog">取消</button>' +
        '  <button type="button" class="btn btn-primary" data-action="do-import">导入</button>' +
        '</div>' +
        '</dialog>',
      function (dlg) {
        dlg.querySelector('[data-action="do-import"]').addEventListener('click', function () {
          doImport(plan);
        });
        dlg.querySelectorAll('.import-fact b').forEach(function (el) {
          C.roll(el, 0, Number(el.textContent) || 0, { duration: T[6], delay: START_DATA });
        });
        dlg.querySelectorAll('.import-list li').forEach(function (li, i) {
          li.setAttribute('data-motion', 'enter');
          li.style.setProperty('--enter-delay', START_DATA + i * STAGGER[2] + 'ms');
          li.style.setProperty('--enter-dur', T[3] + 'ms');
          li.style.setProperty('--enter-shift', '4px');
        });
      }
    );
  }

  function doImport(plan) {
    pushUndo();
    var merged = S.applyImport(state, plan.pairs);
    state.sample = false;
    persist();
    closeDialog();
    refreshSidebar();
    render();
    var parts = ['新增 ' + merged.added + ' 次'];
    if (merged.replaced) parts.push('更新 ' + merged.replaced + ' 次');
    toast('导入完成：' + parts.join('，'), null, UNDO);
  }

  function ingest(rows) {
    var result = S.tableToExams(state, rows);
    if (!result.exams.length) {
      toast(result.errors[0] || '没有读到可用数据', 'bad');
      return;
    }
    previewImport(result.exams, result.errors);
  }

  /* ---------------- 事件委托 ---------------- */

  document.addEventListener('click', function (evt) {
    var chip = evt.target.closest('[data-exam-filter]');
    if (chip) {
      var picked = chip.getAttribute('data-exam-filter');
      var cur = parseHash();
      var base = '#/' + cur.name + (cur.param ? '/' + cur.param : '');
      var target = picked === 'all' ? base : base + '?type=' + encodeURIComponent(picked);
      var go = function () {
        if (global.location.hash === target) {
          /* 点的就是当前这个筛选，地址没变不会触发 hashchange，直接重画 */
          pendingFilter = null;
          render();
        } else {
          pendingFilter = picked;
          global.location.hash = target;
        }
      };
      /* 旧列表先退半步，新列表再进来 */
      var rows = mainEl.querySelector('.list-rows');
      if (rows && !reducedMotion()) {
        rows.setAttribute('data-motion', 'swap-out');
        setTimeout(function () {
          rows.removeAttribute('data-motion');
          go();
        }, T[2]);
      } else {
        go();
      }
      return;
    }

    var themeBtn = evt.target.closest('#themeToggle');
    if (themeBtn) {
      toggleTheme();
      return;
    }

    var renameInput = evt.target.closest('.type-name');
    if (renameInput) {
      renameInput.select();
      return;
    }

    if (evt.target.closest('[data-type-add]')) {
      var typeInput = document.getElementById('typeNew');
      var typeName = ((typeInput && typeInput.value) || '').trim().slice(0, S.TYPE_NAME_MAX);
      if (!typeName) return;
      state.config.types = state.config.types || [];
      if (state.config.types.indexOf(typeName) < 0) state.config.types.push(typeName);
      state.sample = false;
      persist();
      render();
      var fresh = null;
      mainEl.querySelectorAll('.type-name').forEach(function (input) {
        if (input.value === typeName) fresh = input.closest('.type-chip');
      });
      if (fresh && !reducedMotion()) {
        fresh.classList.add('is-new');
        setTimeout(function () {
          fresh.classList.remove('is-new');
        }, T[3]);
      }
      toast('已加上「' + typeName + '」');
      return;
    }

    var delBtn = evt.target.closest('[data-type-del]');
    if (delBtn) {
      var dropType = delBtn.getAttribute('data-type-del');
      var inUse = state.exams.some(function (e) {
        return (e.type || S.DEFAULT_TYPE) === dropType;
      });
      if (inUse) {
        toast('还有考试用着这个类型，改掉之后才能删', 'bad');
        return;
      }
      state.config.types = (state.config.types || []).filter(function (t) {
        return t !== dropType;
      });
      state.sample = false;
      persist();
      var gone = delBtn.closest('.type-chip');
      if (gone && !reducedMotion()) {
        gone.classList.add('is-gone');
        setTimeout(render, T[3]);
      } else {
        render();
      }
      return;
    }

    /* 设置页左栏换分区 */
    var secEl = evt.target.closest('[data-sec]');
    if (secEl) {
      openSettingsSection(secEl.getAttribute('data-sec'));
      return;
    }

    var actionEl = evt.target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-action');

    if (action === 'new-exam') {
      openExamForm(null);
    } else if (action === 'edit-exam') {
      var editId = actionEl.getAttribute('data-id');
      var editing = state.exams.find(function (e) {
        return e.id === editId;
      });
      if (editing) openExamForm(editing);
    } else if (action === 'close-dialog') {
      closeDialog();
    } else if (action === 'delete-exam') {
      var id = actionEl.getAttribute('data-id');
      var exam = state.exams.find(function (e) {
        return e.id === id;
      });
      if (!exam) return;
      confirmDialog({
        title: '删除这次考试？',
        text: '「' + S.esc(exam.name) + '」' + S.esc(exam.date) + ' 的全部分数会被移除，之后的走势会重新接上。',
        label: '删除',
        danger: true,
        onConfirm: function () {
          pushUndo();
          state.exams = state.exams.filter(function (e) {
            return e.id !== exam.id;
          });
          persist();
          closeDialog();
          refreshSidebar();
          global.location.hash =
            '#/exams' + (state.filter && state.filter !== 'all' ? '?type=' + encodeURIComponent(state.filter) : '');
          render();
          toast('已删除', null, UNDO);
        }
      });
    } else if (action === 'export-json') {
      exportJSON();
    } else if (action === 'undo') {
      undoLast();
    } else if (action === 'import-json') {
      confirmDialog({
        title: '导入备份？',
        text: '会用备份里的目标、科目和全部考试替换现在的全部内容。这一步不能撤销。',
        label: '选文件',
        onConfirm: function () {
          closeDialog();
          fileInput.setAttribute('accept', '.json,application/json');
          fileInput.value = '';
          setTimeout(function () {
            fileInput.click();
          }, 160);
        }
      });
    } else if (action === 'export-csv') {
      exportCSV();
    } else if (action === 'export-xlsx') {
      exportXLSX();
    } else if (action === 'export-report') {
      exportReport();
    } else if (action === 'download-template') {
      downloadTemplate();
    } else if (action === 'replay-tour') {
      if (global.Tour) {
        global.Tour.reset();
        global.location.hash = '#/overview';
        setTimeout(function () {
          global.Tour.start();
        }, 420);
      }
    } else if (action === 'import-csv') {
      fileInput.setAttribute('accept', '.csv,text/csv');
      fileInput.value = '';
      fileInput.click();
    } else if (action === 'import-xlsx') {
      fileInput.setAttribute('accept', '.xlsx,.xls');
      fileInput.value = '';
      fileInput.click();
    } else if (action === 'clear-exams') {
      confirmDialog({
        title: '清空全部记录？',
        text: state.exams.length + ' 次考试会被删除，目标和科目设置保留。这个操作不能撤销。',
        label: '全部清空',
        danger: true,
        onConfirm: function () {
          pushUndo();
          state = S.clearExams();
          noteStorageOutcome();
          closeDialog();
          refreshSidebar();
          render();
          toast('记录已清空', null, UNDO);
        }
      });
    } else if (action === 'reset-all') {
      confirmDialog({
        title: '清空示例，从白纸开始？',
        text:
          '示例的 ' +
          state.exams.length +
          ' 场考试会被删掉，班级名、目标、人数、科目和类型也会回到默认值，之后你自己改。这个操作不能撤销。',
        label: '全部清掉',
        danger: true,
        onConfirm: function () {
          pushUndo();
          state = S.resetAll();
          noteStorageOutcome();
          closeDialog();
          refreshSidebar();
          render();
          toast('已经恢复出厂', null, UNDO);
        }
      });
    } else if (action === 'load-sample') {
      confirmDialog({
        title: '填入示例数据？',
        text:
          '当前的 ' +
          state.exams.length +
          ' 次记录和全部设置会被 ' +
          S.SEED_COUNT +
          ' 场示例考试和默认设置替换。想留住现在的内容，先导出备份。',
        label: '填入',
        onConfirm: function () {
          pushUndo();
          state = S.loadSample();
          noteStorageOutcome();
          closeDialog();
          refreshSidebar();
          render();
          toast('示例数据已经装回来了', null, UNDO);
        }
      });
    } else if (action === 'export-broken') {
      var rawArchive = (S.storage.broken && S.storage.broken.raw) || S.readBroken();
      if (!rawArchive) {
        toast('没有留底的存档', 'bad');
        return;
      }
      download('成迹-原始存档-' + todayStamp() + '.json', rawArchive, 'application/json');
      toast('原始存档已下载');
    } else if (action === 'discard-broken') {
      S.discardBroken();
      if (storageNote && storageNote.kind === 'broken') setStorageNote(null);
      toast('留底的存档已丢弃');
      refreshSettingsPanel();
    } else if (action === 'request-persist') {
      S.requestPersist().then(function (result) {
        if (result === true) toast('浏览器已同意长期保留这些数据');
        else if (result === 'unsupported') toast('这个浏览器不支持申请长期保留', 'bad');
        else toast('浏览器没有同意，数据仍可能被清理', 'bad');
        refreshSettingsPanel();
      });
    } else if (action === 'reload-external') {
      state = S.load();
      setStorageNote(null);
      shownKpis = {};
      refreshSidebar();
      render();
      toast('已载入另一个标签页的内容');
    } else if (action === 'set-palette') {
      var want = actionEl.getAttribute('data-pick');
      if (want === S.paletteName()) return;
      fadeColors(function () {
        applyPalette(want, true);
        paintPalette(want);
      });
      toast('已换成' + paletteLabel(want));
    } else if (action === 'set-theme') {
      var mode = actionEl.getAttribute('data-mode');
      if (mode === S.themeMode()) return;
      revealChange(actionEl, function () {
        applyTheme(mode, true);
        paintThemeChoice(mode);
      });
    } else if (action === 'set-theme-switch') {
      var wantSwitch = actionEl.getAttribute('data-switch') === 'off' ? 'off' : 'on';
      S.writeKey(S.THEME_TOGGLE_KEY, wantSwitch);
      var swSeg = document.getElementById('switchSeg');
      if (swSeg) {
        swSeg.querySelectorAll('.seg-btn').forEach(function (b) {
          var on = b.getAttribute('data-switch') === wantSwitch;
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        moveThumb(swSeg);
      }
      setThemeToggleVisible(wantSwitch === 'on');
    }
  });

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    /* 按文件自身的扩展名判断，避免用户选错格式 */
    var byName = /\.(xlsx|xls)$/i.test(file.name) ? 'xlsx' : /\.json$/i.test(file.name) ? 'json' : 'csv';
    handleFile(file, byName);
  });

  /* 移动端导航 */
  sideHost.addEventListener('click', function (evt) {
    var toggle = evt.target.closest('#navToggle');
    if (toggle) {
      var side = sideHost.querySelector('.side');
      var open = side.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('nav-open', open);
      if (open) {
        side.querySelectorAll('.nav-item').forEach(function (item, i) {
          item.style.setProperty('--i', i);
        });
        if (!side._navShown) {
          side._navShown = true;
          side.classList.add('is-fresh');
          setTimeout(function () {
            side.classList.remove('is-fresh');
          }, T[3] + 120);
        }
      }
      return;
    }
    if (evt.target.closest('.nav-item')) {
      sideHost.querySelector('.side').classList.remove('is-open');
      document.body.classList.remove('nav-open');
    }
  });

  document.addEventListener('keydown', function (evt) {
    if (evt.key === 'Escape') {
      var dlg = dialogRoot.querySelector('dialog');
      if (dlg) {
        closeDialog();
        return;
      }
      var side = sideHost.querySelector('.side.is-open');
      if (side) {
        side.classList.remove('is-open');
        document.body.classList.remove('nav-open');
      }
    }
  });

  /* 点击遮罩关闭移动导航 */
  document.addEventListener(
    'click',
    function (evt) {
      if (!document.body.classList.contains('nav-open')) return;
      var side = sideHost.querySelector('.side');
      if (side && !side.contains(evt.target) && !evt.target.closest('#navToggle')) {
        side.classList.remove('is-open');
        document.body.classList.remove('nav-open');
      }
    },
    true
  );

  /* ---------------- 主题 ---------------- */

  var darkQuery = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

  function applyPalette(name, remember) {
    var value = name === 'ink' ? 'ink' : 'classic';
    if (value === 'ink') document.documentElement.setAttribute('data-palette', 'ink');
    else document.documentElement.removeAttribute('data-palette');
    if (remember) S.writeKey(S.PALETTE_KEY, value);
  }

  function paletteLabel(name) {
    return name === 'ink' ? '纸与墨' : '默认';
  }

  /* 只换选中态和摘要，不重建页面，颜色才有过渡 */
  function paintPalette(name) {
    var host = document.querySelector('.palette-pick');
    if (host) {
      host.querySelectorAll('.palette-item').forEach(function (el) {
        var on = el.getAttribute('data-pick') === name;
        el.classList.toggle('is-on', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    var meta = document.querySelector('[data-meta-for="appearance"]');
    if (meta) meta.textContent = V.appearanceMeta();
  }

  /* 深浅色的三档选中态 */
  function paintThemeChoice(mode) {
    var seg = document.getElementById('themeSeg');
    if (seg) {
      seg.querySelectorAll('.seg-btn').forEach(function (b) {
        var on = b.getAttribute('data-mode') === mode;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      moveThumb(seg);
    }
    var meta = document.querySelector('[data-meta-for="appearance"]');
    if (meta) meta.textContent = V.appearanceMeta();
  }

  function applyTheme(mode, remember) {
    var actual =
      mode === 'dark' ? 'dark' : mode === 'light' ? 'light' : darkQuery && darkQuery.matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', actual);
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = mode === 'dark' ? 'dark' : mode === 'light' ? 'light' : 'light dark';
    if (remember) S.writeKey(S.THEME_KEY, mode);
    updateThemeButtons();
  }

  function updateThemeButtons() {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    var actual = document.documentElement.getAttribute('data-theme');
    btn.querySelector('.theme-label').textContent = actual === 'dark' ? '浅色' : '深色';
    btn.setAttribute('aria-label', actual === 'dark' ? '切换到浅色' : '切换到深色');
  }

  /* 换颜色时先让过渡挂上，再改值，否则浏览器会把两步算进同一帧 */
  var fadeTimer = null;

  function fadeColors(change) {
    var root = document.documentElement;
    root.classList.add('is-theme-fading');
    void root.offsetWidth;
    change();
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(function () {
      root.classList.remove('is-theme-fading');
    }, T[4]);
  }

  /* 新的一套颜色从被点的位置以圆形铺开 */
  function revealChange(originEl, change) {
    if (typeof document.startViewTransition !== 'function' || (C && C.reduced && C.reduced())) {
      fadeColors(change);
      return;
    }
    var rect = originEl ? originEl.getBoundingClientRect() : null;
    var x = rect ? rect.left + rect.width / 2 : global.innerWidth / 2;
    var y = rect ? rect.top + rect.height / 2 : global.innerHeight / 2;
    var vw = global.innerWidth;
    var vh = global.innerHeight;
    var r = Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y));
    var rootStyle = document.documentElement.style;
    var html = document.documentElement;
    rootStyle.setProperty('--tx', x + 'px');
    rootStyle.setProperty('--ty', y + 'px');
    rootStyle.setProperty('--tr', Math.ceil(r) + 'px');
    html.setAttribute('data-vt', 'theme');
    var vt = document.startViewTransition(change);
    var done = function () {
      html.removeAttribute('data-vt');
    };
    vt.finished.then(done, done);
  }

  function toggleTheme() {
    var actual = document.documentElement.getAttribute('data-theme');
    var next = actual === 'dark' ? 'light' : 'dark';
    revealChange(document.getElementById('themeToggle'), function () {
      applyTheme(next, true);
      paintThemeChoice(next);
    });
  }

  /* 系统换深色时跟着走，设置页那三档也要跟上 */
  if (darkQuery && darkQuery.addEventListener) {
    darkQuery.addEventListener('change', function () {
      if (S.themeMode() !== 'auto') return;
      applyTheme('auto', false);
      paintThemeChoice('auto');
    });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    applyTheme(S.themeMode(), false);
    applyPalette(S.paletteName(), false);
    checkStorage();
    S.requestPersist();
    refreshSidebar();
    lastSidebarFilter = 'all';

    var bootEl = document.getElementById('boot');
    var subEl = document.getElementById('bootSub');
    var list = S.allSorted(state);

    if (!bootEl || C.reduced() || !list.length) {
      if (bootEl) bootEl.remove();
      render({ full: true });
      maybeTour(beat(1280));
      return;
    }

    if (subEl) subEl.textContent = '正在读取 ' + list.length + ' 次考试';

    /* 数据同步读出，遮罩把品牌画完就走；页面结构与遮罩交叉进入 */
    var done = false;
    function reveal() {
      if (done) return;
      done = true;
      render({ full: true });
      bootEl.classList.add('is-done');
      setTimeout(function () {
        bootEl.remove();
      }, T[4]);
      maybeTour(beat(1280));
    }

    setTimeout(reveal, beat(560));
    bootEl.addEventListener('click', reveal);
  }

  /* 首次使用：等开场和数据都停下来再看导览 */
  function maybeTour(delay) {
    if (!global.Tour || !global.Tour.shouldRun()) return;
    if (currentView !== 'overview' || !state.exams.length) return;
    setTimeout(function () {
      if (!global.Tour.shouldRun()) return;
      if (currentView !== 'overview') return;
      if (dialogRoot.children.length) return;
      global.Tour.start();
    }, delay);
  }

  global.addEventListener('hashchange', function () {
    var cur = parseHash();
    var base = '#/' + cur.name + (cur.param ? '/' + cur.param : '');

    /* 换页面时把当前的类型筛选带过去，只有点「全部」才清掉 */
    if (pendingFilter !== null) {
      state.filter = pendingFilter;
      pendingFilter = null;
      pageSwap(function () {
        global.scrollTo({ top: 0, behavior: 'auto' });
        render();
      });
      return;
    }
    /* 地址里没有类型时把当前筛选带过去，已有的其它参数要留着 */
    if (!cur.query.type && state.filter && state.filter !== 'all') {
      var keep = [];
      if (cur.query.sec) keep.push('sec=' + encodeURIComponent(cur.query.sec));
      keep.push('type=' + encodeURIComponent(state.filter));
      global.location.replace(base + '?' + keep.join('&'));
      return;
    }

    pageSwap(function () {
      global.scrollTo({ top: 0, behavior: 'auto' });
      render();
    });
  });

  /* 另一个标签页写了数据：这边还是打开时的快照，再保存会把对方的改动盖掉 */
  global.addEventListener('storage', function (evt) {
    if (evt.key !== S.STORAGE_KEY || !evt.newValue) return;
    setStorageNote({
      tone: 'warn',
      kind: 'external',
      title: '另一个标签页改动了数据',
      text: '这边看到的还是打开时的内容，在这里继续保存会把那边的改动盖掉。先载入最新的再看。'
    });
  });

  boot();
})(window);

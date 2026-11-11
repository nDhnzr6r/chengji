/* 应用层：路由、渲染、交互 */
(function (global) {
  'use strict';

  var S = global.Store;
  var V = global.Views;
  var C = global.Charts;

  var state = S.load();
  var appEl = document.getElementById('app');
  var sideHost = document.getElementById('sideHost');
  var mainEl = document.getElementById('main');
  var dialogRoot = document.getElementById('dialogRoot');
  var toastEl = document.getElementById('toast');
  var fileInput = document.getElementById('fileInput');

  var firstPaint = true;
  var currentView = null;
  var pendingImport = null;
  var lastShownTotal = null;
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
        try { query[decodeURIComponent(k)] = decodeURIComponent(v); } catch (err) { /* 保留原样 */ }
      });
    }
    var parts = raw.split('/').filter(Boolean);
    return { name: parts[0] || 'overview', param: parts[1] || null, query: query };
  }

  function toast(message, tone) {
    toastEl.textContent = message;
    toastEl.className = 'toast is-on' + (tone ? ' toast-' + tone : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      toastEl.className = 'toast';
    }, 2600);
  }

  /* ---------------- 存储状态 ---------------- */

  var storageNote = null;

  function storageNoteHTML() {
    if (!storageNote) return '';
    var extra = '';
    if (storageNote.kind === 'broken') {
      extra = '<button type="button" class="btn btn-sm btn-ghost" data-action="export-broken">下载原始存档</button>' +
        '<button type="button" class="btn btn-sm btn-ghost" data-action="discard-broken">丢弃</button>';
    } else if (storageNote.kind === 'external') {
      extra = '<button type="button" class="btn btn-sm btn-primary" data-action="reload-external">载入最新</button>';
    } else if (storageNote.kind === 'save' || storageNote.kind === 'off') {
      extra = '<button type="button" class="btn btn-sm btn-primary" data-action="export-json">导出备份</button>';
    }
    return '<div class="storage-note storage-' + storageNote.tone + '" id="storageNote" role="alert">' +
      '<div class="storage-text"><b>' + V.esc(storageNote.title) + '</b><span>' + V.esc(storageNote.text) + '</span></div>' +
      (extra ? '<div class="storage-actions">' + extra + '</div>' : '') +
      '</div>';
  }

  function setStorageNote(note) {
    storageNote = note;
    var host = document.getElementById('storageNote');
    var html = storageNoteHTML();
    if (!html) {
      if (host && host.parentNode) host.parentNode.removeChild(host);
      return;
    }
    if (host && host.parentNode) host.outerHTML = html;
    else if (mainEl) mainEl.insertAdjacentHTML('afterbegin', html);
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
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function todayStamp() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function readJSONScript(id) {
    var node = document.getElementById(id);
    if (!node) return null;
    try { return JSON.parse(node.textContent); } catch (err) { return null; }
  }

  /* ---------------- 导航 ---------------- */

  function setActive(name) {
    var target = name === 'exam' ? 'exams' : name;
    sideHost.querySelectorAll('.nav-item').forEach(function (item) {
      var href = item.getAttribute('href').replace('#/', '');
      item.classList.toggle('is-active', href === target);
    });
  }

  function render() {
    var route = parseHash();
    var name = route.name;
    var picked = route.query.type || 'all';
    /* 地址栏里的类型如果已经不存在，就当没筛 */
    if (picked !== 'all' && !state.exams.some(function (e) { return (e.type || '月考') === picked; })) {
      picked = 'all';
    }
    state.filter = picked;
    var html = '';
    var title = '总览';

    if (name === 'overview') { html = V.overview(state); title = '总览'; }
    else if (name === 'subjects') {
      var firstId = state.config.subjects[0] && state.config.subjects[0].id;
      var sid = route.param || firstId;
      html = V.subjects(state, sid);
      title = '单科分析';
    }
    else if (name === 'compare') { html = V.compare(state, comparePair[0], comparePair[1]); title = '两次考试对比'; }
    else if (name === 'exams') { html = V.exams(state); title = '考试记录'; }
    else if (name === 'exam') { html = V.detail(state, route.param); title = '考试详情'; }
    else if (name === 'settings') { html = V.settings(state); title = '设置'; }
    else { html = V.overview(state); title = '总览'; }

    document.title = title + ' · 成迹';
    currentView = name;
    resizeHandler = null;

    /* 还在用示例数据的时候在总览说一句，免得当成自己的 */
    if (state.sample && name === 'overview') {
      var sampleCount = S.allSorted(state).length;
      html = '<div class="sample-note">' +
        '<span class="sample-tag">示例数据</span>' +
        '<span class="sample-text">这 ' + sampleCount + ' 场考试、班级名和目标是虚构的。清掉之后从白纸开始录。</span>' +
        '<button type="button" class="sample-clear" data-action="reset-all">清空并开始记录</button>' +
        '</div>' + html;
    }

    /* 筛选开着就在每页顶上挂一条，免得看着像全部数据 */
    if (picked !== 'all') {
      var shownCount = S.sorted(state).length;
      var totalCount = S.allSorted(state).length;
      html = '<div class="filter-note">' +
        '<span>只看' + V.esc(picked) + '，' + shownCount + ' 次</span>' +
        '<button type="button" class="filter-clear" data-exam-filter="all">显示全部 ' + totalCount + ' 次</button>' +
        '</div>' + html;
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
    mainEl.classList.remove('is-enter');
    void mainEl.offsetWidth;
    mainEl.classList.add('is-enter');

    requestAnimationFrame(function () { mount(name, route.param); });
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
    requestAnimationFrame(function () { moveThumb(seg); });
  });

  var segResizeTimer = null;
  global.addEventListener('resize', function () {
    clearTimeout(segResizeTimer);
    segResizeTimer = setTimeout(function () {
      document.querySelectorAll('.seg').forEach(moveThumb);
    }, 120);
  });

  /* ---------------- 挂载 ---------------- */

  function mount(name, param) {
    if (name === 'overview') mountOverview();
    else if (name === 'subjects') mountSubjects();
    else if (name === 'compare') mountCompare();
    else if (name === 'settings') mountSettings();
    else if (name === 'exams') mountExams();
    else if (name === 'exam') mountDetail();
    firstPaint = false;
  }

  function mountOverview() {
    var data = readJSONScript('chartData');
    var bullets = readJSONScript('bulletData');
    var host = document.getElementById('trendChart');
    var chart = null;
    var metric = 'total';
    var range = 'all';

    var METRICS = {
      total: { title: '总分走势', note: '虚线是目标分数线', label: '目标', unit: '', digits: 0, invert: false, area: true },
      rate: { title: '得分率走势', note: '虚线是目标得分率', label: '目标', unit: '%', digits: 1, invert: false, area: true },
      grade: { title: '年级名次走势', note: '数值越小越靠上，虚线是目标名次', label: '目标', unit: ' 名', digits: 0, invert: true, area: false },
      classRank: { title: '班级名次走势', note: '数值越小越靠上，虚线是目标名次', label: '目标', unit: ' 名', digits: 0, invert: true, area: false }
    };

    function pointsFor(key) {
      var exams = data.exams;
      if (range === 'recent') exams = exams.slice(-6);
      else if (range === 'term') {
        /* 本学期 = 和最近一次考试同一个学期 */
        var lastBand = data.bands && data.bands.length ? data.bands[data.bands.length - 1] : null;
        if (lastBand) exams = exams.filter(function (e) { return e.ts >= lastBand.startTs; });
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
        height: host.clientWidth < 520 ? 200 : 232,
        unit: m.unit,
        digits: m.digits,
        invert: m.invert,
        area: m.area,
        xMode: 'time',
        bands: data.bands,
        label: m.title,
        animate: animate !== false,
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

    /* KPI 数字滚动：从上一场的值接到这一场 */
    var totalEl = document.getElementById('kpiTotal');
    if (totalEl) {
      var finalTotal = Number(totalEl.textContent) || 0;
      C.roll(totalEl, lastShownTotal === null ? 0 : lastShownTotal, finalTotal, {
        duration: lastShownTotal === null ? 900 : 600
      });
      lastShownTotal = finalTotal;
    }

    var gapEl = document.getElementById('kpiGap');
    if (gapEl) {
      var gapFinal = Number(gapEl.textContent) || 0;
      C.roll(gapEl, 0, gapFinal, { duration: 900 });
    }

    bindResize(function () {
      if (currentView !== 'overview') return;
      if (!chart) return;
      var savedMetric = metric;
      var savedRange = range;
      metric = savedMetric;
      range = savedRange;
      chart = null;
      draw(true);
    });
  }

  function mountSubjects() {
    var chart = null;
    var activeTab = mainEl.querySelector('.tab.is-active');
    if (!activeTab) return;
    var activeId = activeTab.getAttribute('data-subject-tab');

    function draw(parts, animate) {
      var host = document.getElementById('subjectChart');
      if (!host) return;
      var opts = {
        target: parts.target,
        targetLabel: '目标',
        height: host.clientWidth < 520 ? 200 : 232,
        xMode: 'time',
        bands: parts.bands,
        label: '单科走势',
        forecast: parts.subjectForecast || null,
        animate: animate !== false
      };
      if (!chart) {
        opts.points = parts.points;
        chart = C.trend(host, opts);
      } else {
        chart.set(parts.points, opts);
      }
    }

    var subject = state.config.subjects.find(function (s) { return s.id === activeId; }) || state.config.subjects[0];
    draw(V.subjectParts(state, subject), true);

    mainEl.querySelectorAll('.tab').forEach(function (tab) {
      tab.addEventListener('click', function (evt) {
        evt.preventDefault();
        var id = tab.getAttribute('data-subject-tab');
        if (id === activeId) return;
        var next = state.config.subjects.find(function (s) { return s.id === id; });
        if (!next) return;
        activeId = id;
        mainEl.querySelectorAll('.tab').forEach(function (t) {
          var on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        var parts = V.subjectParts(state, next);
        /* 卡片外框不动，只让里面的内容换一遍 */
        var strip = mainEl.querySelector('.kpi-strip');
        if (strip) {
          strip.innerHTML = parts.kpiItems;
          stagger(strip.querySelectorAll('.kpi'), 50);
        }
        var sideBody = mainEl.querySelector('.card-side [data-block="side"]');
        if (sideBody) {
          sideBody.innerHTML = parts.sideBody;
          sideBody.classList.remove('fade-in');
          void mainEl.offsetWidth;
          sideBody.classList.add('fade-in');
        }
        var rows = mainEl.querySelector('.card-table [data-block="rows"]');
        if (rows) {
          rows.innerHTML = parts.tableRows;
          stagger(rows.children, 20);
        }
        var countEl = mainEl.querySelector('.card-table [data-count]');
        if (countEl) countEl.textContent = parts.tableCount + ' 次';
        var titleEl = document.getElementById('subjectChartTitle');
        if (titleEl) {
          titleEl.textContent = next.name + '走势';
          titleEl.classList.remove('fade-in');
          void titleEl.offsetWidth;
          titleEl.classList.add('fade-in');
        }
        draw(parts, true);
        if (global.history && global.history.replaceState) {
          global.history.replaceState(null, '', '#/subjects/' + id);
        }
      });
    });

    bindResize(function () {
      if (currentView === 'subjects') draw(V.subjectParts(state, state.config.subjects.find(function (s) { return s.id === activeId; }) || state.config.subjects[0]), true);
    });
  }

  /* 让一组元素依次淡入 */
  function stagger(nodes, step) {
    var list = Array.prototype.slice.call(nodes);
    if (!list.length) return;
    list.forEach(function (el) {
      el.classList.remove('fade-in');
      el.style.animationDelay = '';
    });
    void list[0].offsetWidth;
    list.forEach(function (el, i) {
      el.style.animationDelay = (i * step) + 'ms';
      el.classList.add('fade-in');
    });
  }

  var resizeHandler = null;
  var resizeTimer = null;
  global.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (typeof resizeHandler === 'function') resizeHandler();
    }, 150);
  });
  function bindResize(fn) { resizeHandler = fn; }

  function mountSettings() {
    var c = state.config;

    function commit() {
      state.sample = false;
      var ok = persist();
      refreshSidebar();
      return ok;
    }

    function bind(id, key, transform, min, max) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        var value = transform ? transform(el.value) : el.value;
        if (typeof value === 'number') {
          if (isNaN(value)) return;
          if (min !== undefined && value < min) value = min;
          if (max !== undefined && value > max) value = max;
          if (value !== Number(el.value)) el.value = value;
        }
        c[key] = value;
        /* 存不进去就别给「已保存」的绿框 */
        if (!commit()) return;
        el.classList.add('is-saved');
        setTimeout(function () { el.classList.remove('is-saved'); }, 900);
      });
    }

    bind('cfgTargetTotal', 'targetTotal', Number, 0, S.fullTotal(state));
    bind('cfgTargetClass', 'targetRankClass', Number, 1, Number(c.classSize) || 1000);
    bind('cfgTargetGrade', 'targetRankGrade', Number, 1, Number(c.gradeSize) || 5000);
    bind('cfgClassName', 'className', String);
    bind('cfgClassSize', 'classSize', Number, 1, 200);
    bind('cfgGradeSize', 'gradeSize', Number, 1, 20000);
    bind('cfgEnrollYear', 'enrollYear', Number, 2000, 2100);
    bind('cfgRemaining', 'remainingExams', Number, 0, 60);
    bind('cfgPassRate', 'passRate', Number, 10, 100);
    bind('cfgGoodRate', 'goodRate', Number, 10, 100);

    /* 改类型名：旧名字下挂着的考试一起换过去 */
    mainEl.querySelectorAll('.type-name').forEach(function (input) {
      input.addEventListener('change', function () {
        var oldName = input.getAttribute('data-type-old');
        var next = (input.value || '').trim().slice(0, 8);
        if (!next || next === oldName) { input.value = oldName; return; }
        if ((c.types || []).indexOf(next) >= 0) { input.value = oldName; toast('已经有这个类型了', 'bad'); return; }
        c.types = (c.types || []).map(function (t) { return t === oldName ? next : t; });
        state.exams.forEach(function (e) {
          if ((e.type || '月考') === oldName) e.type = next;
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
      var subject = c.subjects.find(function (s) { return s.id === id; });
      if (!subject) return;
      tr.querySelectorAll('input[data-field]').forEach(function (input) {
        input.addEventListener('change', function () {
          var field = input.getAttribute('data-field');
          if (field === 'name') {
            subject.name = input.value.trim() || subject.name;
            input.value = subject.name;
          } else {
            var num = Number(input.value);
            if (isNaN(num) || num < 0) { input.value = subject[field]; return; }
            if (field === 'full') {
              if (num < 1) { input.value = subject.full; return; }
              subject.full = Math.min(num, 300);
              input.value = subject.full;
              if (Number(subject.target) > subject.full) {
                subject.target = subject.full;
                var tEl = tr.querySelector('[data-field="target"]');
                if (tEl) { tEl.value = subject.target; tEl.max = subject.full; }
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
            rateCell.textContent = subject.full ? ((Number(subject.target || 0) / Number(subject.full)) * 100).toFixed(1) + '%' : '—';
          }
          refreshSidebar();
        });
      });
    });
  }

  function mountExams() {
    /* 行切换由链接完成 */
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
        size: Math.min(320, host.clientWidth || 300)
      });
    }

    mainEl.querySelectorAll('.cmp-bar .sel').forEach(function (sel) {
      sel.addEventListener('selchange', function () {
        var aSel = mainEl.querySelector('.cmp-bar .sel[data-pick="a"]');
        var bSel = mainEl.querySelector('.cmp-bar .sel[data-pick="b"]');
        comparePair = [aSel.getAttribute('data-value'), bSel.getAttribute('data-value')];
        render();
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
    var draw = function () {
      C.trend(host, {
        points: data.points,
        target: S.targetTotal(state),
        targetLabel: '目标',
        height: host.clientWidth < 520 ? 220 : 240,
        xMode: 'time',
        bands: data.bands,
        highlightIndex: data.index,
        label: '总分走势'
      });
    };
    draw();
    bindResize(function () {
      if (currentView === 'exam') draw();
    });
  }

  function refreshSidebar() {
    var route = parseHash();
    sideHost.innerHTML = V.sidebar(state, route.name === 'exam' ? 'exams' : route.name);
    updateThemeButtons();
  }

  /* ---------------- 对话框 ---------------- */

  function openDialog(html, onMount) {
    dialogRoot.innerHTML = html;
    var dlg = dialogRoot.querySelector('dialog');
    if (!dlg) return;
    if (typeof dlg.showModal === 'function') {
      dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
    document.body.classList.add('no-scroll');
    dlg.addEventListener('close', function () {
      document.body.classList.remove('no-scroll');
      dialogRoot.innerHTML = '';
    });
    if (onMount) onMount(dlg);
    if (global.UI) global.UI.mountAll(dlg);
    return dlg;
  }

  function closeDialog() {
    var dlg = dialogRoot.querySelector('dialog');
    if (!dlg || dlg.classList.contains('is-closing')) return;
    var finish = function () {
      if (typeof dlg.close === 'function') dlg.close();
      else {
        dlg.removeAttribute('open');
        dialogRoot.innerHTML = '';
        document.body.classList.remove('no-scroll');
      }
    };
    if (C.reduced()) { finish(); return; }
    dlg.classList.add('is-closing');
    setTimeout(finish, 140);
  }

  function openExamForm(exam) {
    openDialog('<dialog class="dialog">' + V.examForm(state, exam) + '</dialog>', function (dlg) {
      var form = dlg.querySelector('#examForm');
      var totalEl = dlg.querySelector('#formTotal');
      var errEl = dlg.querySelector('#formError');
      var subjects = readJSONScript('formSubjects');

      function recalc() {
        var sum = 0;
        dlg.querySelectorAll('input[data-subject]').forEach(function (input) {
          var v = Number(input.value);
          if (!isNaN(v) && v > 0) sum += v;
        });
        totalEl.textContent = sum;
      }

      dlg.querySelectorAll('input[data-subject]').forEach(function (input) {
        input.addEventListener('input', recalc);
      });
      recalc();

      form.addEventListener('submit', function (evt) {
        evt.preventDefault();
        /* 关闭动画里再按一次回车，不要重复记一场 */
        if (dlg.classList.contains('is-closing')) return;
        var name = dlg.querySelector('#fName').value.trim();
        var dateEl = dlg.querySelector('.datep[data-field="date"], #fDate');
        var typeEl = dlg.querySelector('.sel[data-field="type"]');
        var date = dateEl ? dateEl.getAttribute('data-value') : '';
        var type = typeEl ? typeEl.getAttribute('data-value') : '月考';

        if (!date) { errEl.textContent = '先填日期。'; return; }
        if (!name) name = date + ' ' + type;

        var scores = {};
        var filled = 0;
        var bad = '';
        dlg.querySelectorAll('input[data-subject]').forEach(function (input) {
          var id = input.getAttribute('data-subject');
          var raw = input.value.trim();
          if (raw === '') return;
          var num = Number(raw);
          var subject = subjects.find(function (s) { return s.id === id; });
          if (!subject) return;
          if (isNaN(num) || num < 0) { bad = bad || subject.name + ' 的分数不是有效数字'; return; }
          if (num > subject.full) { bad = bad || subject.name + ' 超过满分 ' + subject.full + ' 分'; return; }
          scores[id] = num;
          filled++;
        });

        if (bad) { errEl.textContent = bad; return; }
        if (!filled) { errEl.textContent = '至少填一科分数。'; return; }

        var pickRank = function (id) {
          var n = Number(dlg.querySelector(id).value);
          return n > 0 ? Math.round(n) : null;
        };
        var ranks = {
          class: pickRank('#fClass'),
          grade: pickRank('#fGrade')
        };

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
          exam.averages = averages;
          exam.subjectRanks = subjectRanks;
          exam.subjectAverages = subjectAverages;
          state.sample = false;
          toast('已保存这次考试');
        } else {
          state.exams.push({
            id: S.uid(), name: name, date: date, type: type,
            scores: scores, ranks: ranks, averages: averages,
            subjectRanks: subjectRanks, subjectAverages: subjectAverages
          });
          toast('已记录「' + name + '」');
        }
        state.sample = false;
        persist();
        closeDialog();
        refreshSidebar();
        render();
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
      s.onload = function () { resolve(global.XLSX); };
      s.onerror = function () { xlsxLoading = null; reject(new Error('load failed')); };
      document.head.appendChild(s);
    });
    return xlsxLoading;
  }

  function exportXLSX() {
    toast('正在准备 Excel 组件');
    loadXLSX().then(function () {
      buildXLSX();
    }).catch(function () {
      toast('Excel 组件加载失败，改用 CSV 导出', 'bad');
    });
  }

  function buildXLSX() {
    var subjects = state.config.subjects;
    var head = ['考试名称', '日期', '类型']
      .concat(subjects.map(function (x) { return x.name; }))
      .concat(subjects.map(function (x) { return x.name + '名次'; }))
      .concat(subjects.map(function (x) { return x.name + '平均'; }))
      .concat(['班级排名', '年级排名', '班级平均', '年级平均', '年级最高']);

    var rows = [head];
    S.allSorted(state).forEach(function (e) {
      var avg = e.averages || {};
      var sr = e.subjectRanks || {};
      var sa = e.subjectAverages || {};
      rows.push([e.name, e.date, e.type || '']
        .concat(subjects.map(function (x) { return e.scores[x.id] === undefined ? '' : e.scores[x.id]; }))
        .concat(subjects.map(function (x) { return sr[x.id] || ''; }))
        .concat(subjects.map(function (x) { return sa[x.id] || ''; }))
        .concat([e.ranks.class || '', e.ranks.grade || '', avg.class || '', avg.grade || '', avg.top || '']));
    });

    var sheet = global.XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = head.map(function (h) { return { wch: Math.max(8, Math.min(18, h.length * 2 + 4)) }; });
    var book = global.XLSX.utils.book_new();
    global.XLSX.utils.book_append_sheet(book, sheet, '成绩');
    global.XLSX.writeFile(book, '成迹-成绩-' + todayStamp() + '.xlsx');
    toast('表格已下载');
  }

  /* 导出一份能直接看的分析报告 */
  function exportReport() {
    var esc = V.esc;
    var cnDate = V.cnDate;
    var signed = V.signed;
    var list = S.allSorted(state);
    if (!list.length) { toast('还没有成绩记录', 'bad'); return; }
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

    var subjectRows = sub.map(function (s) {
      var v = Number(last.scores[s.id]);
      var t = Number(s.target) || 0;
      var avg = Number((last.subjectAverages || {})[s.id]) || null;
      var rk = Number((last.subjectRanks || {})[s.id]) || null;
      return '<tr>' +
        '<td>' + esc(s.name) + '</td>' +
        '<td class="num">' + (isNaN(v) ? '—' : v + ' / ' + s.full) + '</td>' +
        '<td class="num">' + (isNaN(v) || !Number(s.full) ? '—' : ((v / s.full) * 100).toFixed(1) + '%') + '</td>' +
        '<td class="num">' + (avg === null ? '—' : avg) + '</td>' +
        '<td class="num">' + (rk === null ? '—' : '第 ' + rk + ' 名') + '</td>' +
        '<td class="num">' + (isNaN(v) || !t ? '—' : (v >= t ? '达标' : '差 ' + (t - v))) + '</td>' +
        '</tr>';
    }).join('');

    var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<title>成绩分析报告</title><style>' +
      'body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;max-width:820px;margin:40px auto;padding:0 24px;color:#111;line-height:1.7}' +
      'h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 8px;padding-bottom:6px;border-bottom:1px solid #ddd}' +
      '.meta{color:#666;font-size:13px;margin-bottom:22px}' +
      'p{margin:6px 0}.lead{font-size:15px;font-weight:600}' +
      'table{border-collapse:collapse;width:100%;font-size:13px;margin:8px 0}' +
      'th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee}' +
      'th{font-weight:400;color:#666;width:38%}' +
      'td.num{text-align:right;font-variant-numeric:tabular-nums}' +
      'ul{margin:6px 0;padding-left:18px}li{margin:3px 0;font-size:13px}' +
      'footer{margin-top:34px;color:#999;font-size:12px}' +
      '</style></head><body>' +
      '<h1>成绩分析报告</h1>' +
      '<p class="meta">' + esc(last.name) + ' · ' + cnDate(last.date) + ' · 共 ' + list.length + ' 次记录</p>' +

      '<h2>这次的结论</h2>' +
      '<p class="lead">' + (ins ? ins.headlines.map(esc).join('，') : '') + '</p>' +
      (road && road.predict !== null
        ? '<p>' + (term ? '按' + term.term + '这几场的速度，下次大约 ' + Math.round(term.next) + ' 分，学期末大约 ' + Math.round(term.end) + ' 分。' : '') +
          '按最近六次算，下次大约 ' + Math.round(road.predict) + ' 分' +
          (road.needPerExam !== null ? '；剩 ' + road.remaining + ' 场，每场要涨 ' + road.needPerExam.toFixed(1) + ' 分才够。' : '。') + '</p>'
        : '') +

      '<h2>和同学比</h2>' +
      (peers.vsClass !== null || peers.vsGrade !== null
        ? '<table>' +
          (peers.vsClass !== null ? row('班级平均', peers.classAvg + '（' + (peers.vsClass >= 0 ? '高 ' : '低 ') + Math.abs(peers.vsClass) + ' 分）') : '') +
          (peers.vsGrade !== null ? row('年级平均', peers.gradeAvg + '（' + (peers.vsGrade >= 0 ? '高 ' : '低 ') + Math.abs(peers.vsGrade) + ' 分）') : '') +
          (peers.toTop !== null ? row('年级最高', peers.top + '（差 ' + peers.toTop + ' 分）') : '') +
          '</table>' + (peers.diagnosis ? '<p>' + esc(peers.diagnosis.text) + '。</p>' : '')
        : '<p>这次没有填班级平均或年级平均，判断不了是题难还是状态问题。</p>') +

      '<h2>六科明细</h2>' +
      '<table><tr><th>科目</th><th class="num">得分</th><th class="num">得分率</th><th class="num">班平</th><th class="num">班内名次</th><th class="num">距目标</th></tr>' +
      subjectRows + '</table>' +

      '<h2>偏科</h2>' +
      (spread
        ? '<p>最强 ' + esc(spread.strongest.name) + ' ' + spread.strongest.rate.toFixed(1) + '%，最弱 ' +
          esc(spread.weakest.name) + ' ' + spread.weakest.rate.toFixed(1) + '%，相差 ' + spread.spread.toFixed(1) +
          ' 个百分点，整体' + spread.level.text + '。及格 ' + spread.pass + ' 科，优秀 ' + spread.good + ' 科。</p>'
        : '') +

      '<h2>下一步</h2>' +
      '<ul>' +
      (prio.length ? '<li>先补 ' + esc(prio[0].subject.name) + '，还差 ' + prio[0].gap + ' 分（占满分 ' + (prio[0].gapRate * 100).toFixed(0) + '%）。</li>' : '') +
      (smooth.up.length ? '<li>最近三场进步最多的是 ' + esc(smooth.up[0].subject.name) + '，' + signed(smooth.up[0].delta) + ' 分，保持。</li>' : '') +
      (smooth.down.length ? '<li>最近三场回落最多的是 ' + esc(smooth.down[0].subject.name) + '，' + signed(smooth.down[0].delta) + ' 分。</li>' : '') +
      (road && road.needPerExam !== null && road.needPerExam > 0
        ? '<li>离目标还差 ' + road.gap + ' 分，剩 ' + road.remaining + ' 场，每场至少涨 ' + road.needPerExam.toFixed(1) + ' 分。</li>'
        : '') +
      '</ul>' +

      '<footer>由成迹生成 · ' + new Date().toLocaleString('zh-CN') + '</footer>' +
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
    var names = subs.map(function (s) { return s.name; });
    var head = ['考试名称', '日期', '类型']
      .concat(names)
      .concat(names.map(function (n) { return n + '名次'; }))
      .concat(names.map(function (n) { return n + '平均'; }))
      .concat(['班级排名', '年级排名', '班级平均', '年级平均', '年级最高']);
    var sample = ['高二上 · 第三次月考', '2026-12-11', '月考']
      .concat(subs.map(function (s) { return Math.round(Number(s.full) * 0.82); }))
      .concat(subs.map(function () { return ''; }))
      .concat(subs.map(function (s) { return Math.round(Number(s.full) * 0.68); }))
      .concat(['4', '88', '446', '441', '682']);
    var csv = '\uFEFF' + [head, sample].map(function (row) { return row.join(','); }).join('\r\n');
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
          state = next;
          persist();
          lastShownTotal = null;
          refreshSidebar();
          render();
          toast('备份已恢复：' + state.exams.length + ' 次考试');
        } catch (err) {
          toast('这个备份文件读不出来', 'bad');
        }
      };
      reader.readAsText(file, 'utf-8');
    } else if (kind === 'xlsx') {
      toast('正在准备 Excel 组件');
      loadXLSX().then(function () {
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
      }).catch(function () {
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

  function ingest(rows) {
    var result = S.tableToExams(state, rows);
    if (!result.exams.length) {
      toast(result.errors[0] || '没有读到可用数据', 'bad');
      return;
    }
    var merged = S.mergeExams(state, result.exams);
    state.sample = false;
    persist();
    refreshSidebar();
    render();
    var parts = ['新增 ' + merged.added + ' 次'];
    if (merged.replaced) parts.push('更新 ' + merged.replaced + ' 次');
    if (result.errors.length) parts.push(result.errors.length + ' 行跳过');
    toast('导入完成：' + parts.join('，'));
  }

  /* ---------------- 事件委托 ---------------- */

  document.addEventListener('click', function (evt) {
    var chip = evt.target.closest('[data-exam-filter]');
    if (chip) {
      var picked = chip.getAttribute('data-exam-filter');
      var cur = parseHash();
      var base = '#/' + cur.name + (cur.param ? '/' + cur.param : '');
      var target = picked === 'all' ? base : base + '?type=' + encodeURIComponent(picked);
      if (global.location.hash === target) {
        /* 点的就是当前这个筛选，地址没变不会触发 hashchange，直接重画 */
        pendingFilter = null;
        render();
      } else {
        pendingFilter = picked;
        global.location.hash = target;
      }
      return;
    }

    var themeBtn = evt.target.closest('#themeToggle');
    if (themeBtn) { toggleTheme(); return; }

    var renameInput = evt.target.closest('.type-name');
    if (renameInput) { renameInput.select(); return; }

    if (evt.target.closest('[data-type-add]')) {
      var typeInput = document.getElementById('typeNew');
      var typeName = ((typeInput && typeInput.value) || '').trim().slice(0, 8);
      if (!typeName) return;
      state.config.types = state.config.types || [];
      if (state.config.types.indexOf(typeName) < 0) state.config.types.push(typeName);
      state.sample = false;
      persist();
      render();
      toast('已加上「' + typeName + '」');
      return;
    }

    var delBtn = evt.target.closest('[data-type-del]');
    if (delBtn) {
      var dropType = delBtn.getAttribute('data-type-del');
      var inUse = state.exams.some(function (e) { return (e.type || '月考') === dropType; });
      if (inUse) { toast('还有考试用着这个类型，改掉之后才能删', 'bad'); return; }
      state.config.types = (state.config.types || []).filter(function (t) { return t !== dropType; });
      state.sample = false;
      persist();
      render();
      return;
    }

    /* 设置页的页内跳转 */
    var gotoEl = evt.target.closest('[data-goto]');
    if (gotoEl) {
      var gotoHost = document.getElementById(gotoEl.getAttribute('data-goto'));
      if (gotoHost) gotoHost.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    var actionEl = evt.target.closest('[data-action]');
    if (!actionEl) return;
    var action = actionEl.getAttribute('data-action');

    if (action === 'new-exam') { openExamForm(null); }
    else if (action === 'edit-exam') {
      var editId = actionEl.getAttribute('data-id');
      var target = state.exams.find(function (e) { return e.id === editId; });
      if (target) openExamForm(target);
    }
    else if (action === 'close-dialog') { closeDialog(); }
    else if (action === 'delete-exam') {
      var id = actionEl.getAttribute('data-id');
      var exam = state.exams.find(function (e) { return e.id === id; });
      if (!exam) return;
      openDialog('<dialog class="dialog dialog-confirm">' +
        '<div class="form-head"><h2>删除这次考试？</h2></div>' +
        '<div class="form-body"><p class="confirm-text">「' + V.esc(exam.name) + '」' + V.esc(exam.date) + ' 的全部分数会被移除，之后的走势会重新接上。</p></div>' +
        '<div class="form-foot"><button class="btn btn-ghost" data-action="close-dialog">取消</button>' +
        '<button class="btn btn-danger" data-action="confirm-delete" data-id="' + exam.id + '">删除</button></div>' +
        '</dialog>', function (dlg) {
          dlg.querySelector('[data-action="confirm-delete"]').addEventListener('click', function () {
            state.exams = state.exams.filter(function (e) { return e.id !== exam.id; });
            persist();
            closeDialog();
            refreshSidebar();
            global.location.hash = '#/exams' + (state.filter && state.filter !== 'all'
              ? '?type=' + encodeURIComponent(state.filter) : '');
            render();
            toast('已删除');
          });
        });
    }
    else if (action === 'export-json') { exportJSON(); }
    else if (action === 'import-json') {
      openDialog('<dialog class="dialog dialog-confirm">' +
        '<div class="form-head"><h2>导入备份？</h2></div>' +
        '<div class="form-body"><p class="confirm-text">会用备份里的目标、科目和全部考试替换现在的全部内容。这一步不能撤销。</p></div>' +
        '<div class="form-foot"><button class="btn btn-ghost" data-action="close-dialog">取消</button>' +
        '<button class="btn btn-primary" data-action="pick-json">选文件</button></div>' +
        '</dialog>', function (dlg) {
          dlg.querySelector('[data-action="pick-json"]').addEventListener('click', function () {
            closeDialog();
            pendingImport = 'json';
            fileInput.setAttribute('accept', '.json,application/json');
            fileInput.value = '';
            setTimeout(function () { fileInput.click(); }, 160);
          });
        });
    }
    else if (action === 'export-csv') { exportCSV(); }
    else if (action === 'export-xlsx') { exportXLSX(); }
    else if (action === 'export-report') { exportReport(); }
    else if (action === 'download-template') { downloadTemplate(); }
    else if (action === 'replay-tour') {
      if (global.Tour) {
        global.Tour.reset();
        global.location.hash = '#/overview';
        setTimeout(function () { global.Tour.start(); }, 420);
      }
    }
    else if (action === 'import-csv') { pendingImport = 'csv'; fileInput.setAttribute('accept', '.csv,text/csv'); fileInput.value = ''; fileInput.click(); }
    else if (action === 'import-xlsx') { pendingImport = 'xlsx'; fileInput.setAttribute('accept', '.xlsx,.xls'); fileInput.value = ''; fileInput.click(); }
    else if (action === 'clear-exams') {
      openDialog('<dialog class="dialog dialog-confirm">' +
        '<div class="form-head"><h2>清空全部记录？</h2></div>' +
        '<div class="form-body"><p class="confirm-text">' + state.exams.length + ' 次考试会被删除，目标和科目设置保留。这个操作不能撤销。</p></div>' +
        '<div class="form-foot"><button class="btn btn-ghost" data-action="close-dialog">取消</button>' +
        '<button class="btn btn-danger" data-action="confirm-clear">全部清空</button></div>' +
        '</dialog>', function (dlg) {
          dlg.querySelector('[data-action="confirm-clear"]').addEventListener('click', function () {
            state = S.clearExams();
            noteStorageOutcome();
            closeDialog();
            refreshSidebar();
            render();
            toast('记录已清空');
          });
        });
    }
    else if (action === 'reset-all') {
      openDialog('<dialog class="dialog dialog-confirm">' +
        '<div class="form-head"><h2>清空示例，从白纸开始？</h2></div>' +
        '<div class="form-body"><p class="confirm-text">示例的 ' + state.exams.length + ' 场考试会被删掉，班级名、目标、人数、科目和类型也会回到默认值，之后你自己改。这个操作不能撤销。</p></div>' +
        '<div class="form-foot"><button class="btn btn-ghost" data-action="close-dialog">取消</button>' +
        '<button class="btn btn-danger" data-action="confirm-reset">全部清掉</button></div>' +
        '</dialog>', function (dlg) {
          dlg.querySelector('[data-action="confirm-reset"]').addEventListener('click', function () {
            state = S.resetAll();
            noteStorageOutcome();
            closeDialog();
            refreshSidebar();
            render();
            toast('已经恢复出厂');
          });
        });
    }
    else if (action === 'load-sample') {
      openDialog('<dialog class="dialog dialog-confirm">' +
        '<div class="form-head"><h2>填入示例数据？</h2></div>' +
        '<div class="form-body"><p class="confirm-text">当前的 ' + state.exams.length + ' 次记录和全部设置会被 15 场示例考试和默认设置替换。想留住现在的内容，先导出备份。</p></div>' +
        '<div class="form-foot"><button class="btn btn-ghost" data-action="close-dialog">取消</button>' +
        '<button class="btn btn-primary" data-action="confirm-sample">填入</button></div>' +
        '</dialog>', function (dlg) {
          dlg.querySelector('[data-action="confirm-sample"]').addEventListener('click', function () {
            state = S.loadSample();
            noteStorageOutcome();
            closeDialog();
            refreshSidebar();
            render();
            toast('示例数据已经装回来了');
          });
        });
    }
    else if (action === 'export-broken') {
      var rawArchive = (S.storage.broken && S.storage.broken.raw) || S.readBroken();
      if (!rawArchive) { toast('没有留底的存档', 'bad'); return; }
      download('成迹-原始存档-' + todayStamp() + '.json', rawArchive, 'application/json');
      toast('原始存档已下载');
    }
    else if (action === 'discard-broken') {
      S.discardBroken();
      if (storageNote && storageNote.kind === 'broken') setStorageNote(null);
      toast('留底的存档已丢弃');
      if (currentView === 'settings') render();
    }
    else if (action === 'request-persist') {
      S.requestPersist().then(function (result) {
        if (result === true) toast('浏览器已同意长期保留这些数据');
        else if (result === 'unsupported') toast('这个浏览器不支持申请长期保留', 'bad');
        else toast('浏览器没有同意，数据仍可能被清理', 'bad');
        if (currentView === 'settings') render();
      });
    }
    else if (action === 'reload-external') {
      state = S.load();
      setStorageNote(null);
      lastShownTotal = null;
      refreshSidebar();
      render();
      toast('已载入另一个标签页的内容');
    }
    else if (action === 'set-palette') {
      var want = actionEl.getAttribute('data-pick');
      applyPalette(want, true);
      if (currentView === 'settings') render();
      toast(want === 'classic' ? '已换成默认配色' : '已换成纸与墨');
    }
    else if (action === 'confirm-delete') { /* 由对话框内部处理 */ }
  });

  fileInput.addEventListener('change', function () {
    var file = fileInput.files && fileInput.files[0];
    if (!file) return;
    /* 按文件自身的扩展名判断，避免用户选错格式 */
    var byName = /\.(xlsx|xls)$/i.test(file.name) ? 'xlsx' : /\.json$/i.test(file.name) ? 'json' : 'csv';
    handleFile(file, byName || pendingImport);
  });

  /* 移动端导航 */
  sideHost.addEventListener('click', function (evt) {
    var toggle = evt.target.closest('#navToggle');
    if (toggle) {
      var open = sideHost.querySelector('.side').classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('nav-open', open);
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
      if (dlg) { closeDialog(); return; }
      var side = sideHost.querySelector('.side.is-open');
      if (side) {
        side.classList.remove('is-open');
        document.body.classList.remove('nav-open');
      }
    }
  });

  /* 点击遮罩关闭移动导航 */
  document.addEventListener('click', function (evt) {
    if (!document.body.classList.contains('nav-open')) return;
    var side = sideHost.querySelector('.side');
    if (side && !side.contains(evt.target) && !evt.target.closest('#navToggle')) {
      side.classList.remove('is-open');
      document.body.classList.remove('nav-open');
    }
  }, true);

  /* ---------------- 主题 ---------------- */

  var THEME_KEY = 'scorebook.theme';
  var PALETTE_KEY = 'scorebook.palette';
  var darkQuery = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

  function themeMode() {
    try { return global.localStorage.getItem(THEME_KEY) || 'auto'; } catch (err) { return 'auto'; }
  }

  function paletteName() {
    try { return global.localStorage.getItem(PALETTE_KEY) === 'classic' ? 'classic' : 'ink'; } catch (err) { return 'ink'; }
  }

  function applyPalette(name, remember) {
    var value = name === 'classic' ? 'classic' : 'ink';
    if (value === 'classic') document.documentElement.setAttribute('data-palette', 'classic');
    else document.documentElement.removeAttribute('data-palette');
    if (remember) {
      try { global.localStorage.setItem(PALETTE_KEY, value); } catch (err) { /* ignore */ }
    }
  }

  function applyTheme(mode, remember) {
    var actual = mode === 'dark' ? 'dark' : mode === 'light' ? 'light' : (darkQuery && darkQuery.matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', actual);
    if (remember) {
      try { global.localStorage.setItem(THEME_KEY, mode); } catch (err) { /* ignore */ }
    }
    updateThemeButtons();
  }

  function updateThemeButtons() {
    var btn = document.getElementById('themeToggle');
    if (!btn) return;
    var actual = document.documentElement.getAttribute('data-theme');
    btn.querySelector('.theme-label').textContent = actual === 'dark' ? '浅色' : '深色';
    btn.setAttribute('aria-label', actual === 'dark' ? '切换到浅色' : '切换到深色');
  }

  function toggleTheme() {
    var actual = document.documentElement.getAttribute('data-theme');
    var next = actual === 'dark' ? 'light' : 'dark';
    var root = document.documentElement;
    root.classList.add('is-theme-fading');
    applyTheme(next, true);
    setTimeout(function () { root.classList.remove('is-theme-fading'); }, 300);
  }

  if (darkQuery && darkQuery.addEventListener) {
    darkQuery.addEventListener('change', function () {
      if (themeMode() === 'auto') applyTheme('auto', false);
    });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    applyTheme(themeMode(), false);
    applyPalette(paletteName(), false);
    checkStorage();
    S.requestPersist();
    var route = parseHash();
    sideHost.innerHTML = V.sidebar(state, route.name === 'exam' ? 'exams' : route.name);
    updateThemeButtons();

    var bootEl = document.getElementById('boot');
    var subEl = document.getElementById('bootSub');
    var list = S.allSorted(state);

    if (!bootEl || C.reduced() || !list.length) {
      if (bootEl) bootEl.remove();
      render();
      maybeTour(900);
      return;
    }

    if (subEl) subEl.textContent = '正在读取 ' + list.length + ' 次考试';

    /* 遮罩期间内容还没生成，进度条走完再一次性填进来 */
    var done = false;
    function reveal() {
      if (done) return;
      done = true;
      render();
      bootEl.classList.add('is-done');
      setTimeout(function () { bootEl.remove(); }, 460);
      maybeTour(2400);
    }

    setTimeout(reveal, 940);
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
      render();
      global.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    if (!cur.query.type && state.filter && state.filter !== 'all') {
      global.location.replace(base + '?type=' + encodeURIComponent(state.filter));
      return;
    }

    render();
    global.scrollTo({ top: 0, behavior: 'auto' });
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

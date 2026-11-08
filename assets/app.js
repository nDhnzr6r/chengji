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
  var examFilter = 'all';

  /* ---------------- 工具 ---------------- */

  function parseHash() {
    var raw = (global.location.hash || '').replace(/^#\/?/, '');
    var parts = raw.split('/').filter(Boolean);
    return { name: parts[0] || 'overview', param: parts[1] || null };
  }

  function toast(message, tone) {
    toastEl.textContent = message;
    toastEl.className = 'toast is-on' + (tone ? ' toast-' + tone : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      toastEl.className = 'toast';
    }, 2600);
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
    else if (name === 'exams') { html = V.exams(state, examFilter); title = '考试记录'; }
    else if (name === 'exam') { html = V.detail(state, route.param); title = '考试详情'; }
    else if (name === 'settings') { html = V.settings(state); title = '设置'; }
    else { html = V.overview(state); title = '总览'; }

    document.title = title + ' · 成迹';
    currentView = name;
    resizeHandler = null;
    mainEl.innerHTML = html;
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
      var exams = range === 'recent' ? data.exams.slice(-6) : data.exams;
      return exams.map(function (e) {
        return {
          label: e.label,
          full: e.date + ' · ' + e.name,
          value: e[key],
          sub: e.name,
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
        height: host.clientWidth < 520 ? 200 : 232,
        unit: m.unit,
        digits: m.digits,
        invert: m.invert,
        area: m.area,
        xMode: 'time',
        bands: data.bands,
        label: m.title,
        animate: animate !== false
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
      if (noteEl) noteEl.textContent = (range === 'recent' ? Math.min(6, data.exams.length) : data.exams.length) + ' 次记录';
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
        duration: lastShownTotal === null ? 1250 : 800
      });
      lastShownTotal = finalTotal;
    }

    var gapEl = document.getElementById('kpiGap');
    if (gapEl) {
      var gapFinal = Number(gapEl.textContent) || 0;
      C.roll(gapEl, 0, gapFinal, { duration: 1150 });
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
      S.save(state);
      refreshSidebar();
    }

    function bind(id, key, transform) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        var value = transform ? transform(el.value) : el.value;
        if (typeof value === 'number' && (isNaN(value) || value < 0)) return;
        c[key] = value;
        commit();
        el.classList.add('is-saved');
        setTimeout(function () { el.classList.remove('is-saved'); }, 900);
      });
    }

    bind('cfgTargetTotal', 'targetTotal', Number);
    bind('cfgTargetClass', 'targetRankClass', Number);
    bind('cfgTargetGrade', 'targetRankGrade', Number);
    bind('cfgClassName', 'className', String);
    bind('cfgClassSize', 'classSize', Number);
    bind('cfgGradeSize', 'gradeSize', Number);
    bind('cfgEnrollYear', 'enrollYear', Number);
    bind('cfgRemaining', 'remainingExams', Number);
    bind('cfgPassRate', 'passRate', Number);
    bind('cfgGoodRate', 'goodRate', Number);

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
            subject[field] = num;
          }
          S.save(state);
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
    applyGoalBar();
    updateThemeButtons();
  }

  function applyGoalBar() {
    var fill = sideHost.querySelector('.goal-fill');
    if (!fill) return;
    var pct = fill.style.getPropertyValue('--pct');
    fill.style.width = '0%';
    requestAnimationFrame(function () {
      fill.style.width = pct;
    });
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
        var name = dlg.querySelector('#fName').value.trim();
        var dateEl = dlg.querySelector('.datep[data-field="date"], #fDate');
        var typeEl = dlg.querySelector('.sel[data-field="type"]');
        var date = dateEl ? dateEl.getAttribute('data-value') : '';
        var type = typeEl ? typeEl.getAttribute('data-value') : '月考';

        if (!date) { errEl.textContent = '先填日期。'; return; }
        if (!name) name = date + ' ' + type;

        var scores = {};
        var filled = 0;
        dlg.querySelectorAll('input[data-subject]').forEach(function (input) {
          var id = input.getAttribute('data-subject');
          var raw = input.value.trim();
          if (raw === '') return;
          var num = Number(raw);
          var subject = subjects.find(function (s) { return s.id === id; });
          if (isNaN(num) || num < 0 || num > subject.full) return;
          scores[id] = num;
          filled++;
        });

        if (!filled) { errEl.textContent = '至少填一科分数。'; return; }

        var ranks = {
          class: Number(dlg.querySelector('#fClass').value) || null,
          grade: Number(dlg.querySelector('#fGrade').value) || null
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

        if (exam) {
          exam.name = name;
          exam.date = date;
          exam.type = type;
          exam.scores = scores;
          exam.ranks = ranks;
          exam.averages = averages;
          exam.subjectRanks = subjectRanks;
          toast('已保存这次考试');
        } else {
          state.exams.push({
            id: S.uid(), name: name, date: date, type: type,
            scores: scores, ranks: ranks, averages: averages, subjectRanks: subjectRanks
          });
          toast('已记录「' + name + '」');
        }
        S.save(state);
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

  function exportCSV() {
    var csv = '\uFEFF' + S.toCSV(state);
    download('成迹-成绩-' + todayStamp() + '.csv', csv, 'text/csv;charset=utf-8');
    toast('表格已下载');
  }

  function downloadTemplate() {
    var subjects = state.config.subjects.map(function (s) { return s.name; });
    var head = ['考试名称', '日期', '类型'].concat(subjects, ['班级排名', '年级排名']);
    var sample = ['高二上 · 第三次月考', '2026-12-11', '月考'].concat(
      state.config.subjects.map(function (s) { return Math.round(Number(s.full) * 0.82); }),
      ['4', '88']
    );
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
          var next = S.normalize(parsed);
          state = next;
          S.save(state);
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
      reader.onload = function (evt) {
        try {
          if (!global.XLSX) { toast('Excel 解析没有加载成功，请改用 CSV', 'bad'); return; }
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
    S.save(state);
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
      examFilter = chip.getAttribute('data-exam-filter');
      render();
      return;
    }

    var themeBtn = evt.target.closest('#themeToggle');
    if (themeBtn) { toggleTheme(); return; }

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
            S.save(state);
            closeDialog();
            refreshSidebar();
            global.location.hash = '#/exams';
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
            closeDialog();
            refreshSidebar();
            render();
            toast('记录已清空');
          });
        });
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
  var darkQuery = global.matchMedia ? global.matchMedia('(prefers-color-scheme: dark)') : null;

  function themeMode() {
    try { return global.localStorage.getItem(THEME_KEY) || 'auto'; } catch (err) { return 'auto'; }
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
    var btn = document.getElementById('themeToggle');
    var rect = btn ? btn.getBoundingClientRect() : null;
    var x = rect ? rect.left + rect.width / 2 : global.innerWidth / 2;
    var y = rect ? rect.top + rect.height / 2 : global.innerHeight / 2;

    /* 新主题从按钮那里铺开 */
    if (typeof document.startViewTransition === 'function') {
      var vw = global.innerWidth;
      var vh = global.innerHeight;
      var r = Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y));
      var rootStyle = document.documentElement.style;
      rootStyle.setProperty('--tx', x + 'px');
      rootStyle.setProperty('--ty', y + 'px');
      rootStyle.setProperty('--tr', Math.ceil(r) + 'px');
      document.startViewTransition(function () {
        applyTheme(next, true);
      });
      return;
    }

    /* 浏览器不支持就退成一整片颜色的渐变 */
    var root = document.documentElement;
    root.classList.add('is-theme-fading');
    applyTheme(next, true);
    setTimeout(function () { root.classList.remove('is-theme-fading'); }, 420);
  }

  if (darkQuery && darkQuery.addEventListener) {
    darkQuery.addEventListener('change', function () {
      if (themeMode() === 'auto') applyTheme('auto', false);
    });
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    applyTheme(themeMode(), false);
    var route = parseHash();
    sideHost.innerHTML = V.sidebar(state, route.name === 'exam' ? 'exams' : route.name);
    updateThemeButtons();

    var bootEl = document.getElementById('boot');
    var subEl = document.getElementById('bootSub');
    var list = S.sorted(state);

    if (!bootEl || C.reduced() || !list.length) {
      if (bootEl) bootEl.remove();
      render();
      requestAnimationFrame(applyGoalBar);
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
      requestAnimationFrame(applyGoalBar);
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
    render();
    global.scrollTo({ top: 0, behavior: 'auto' });
  });

  boot();
})(window);

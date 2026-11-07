/* 数据层：成绩模型、本地存储、导入导出 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'scorebook.v2';

  var DEFAULT_CONFIG = {
    className: '高二（7）班',
    classSize: 45,
    gradeSize: 620,
    enrollYear: 2025,
    targetTotal: 640,
    targetRankClass: 5,
    targetRankGrade: 100,
    subjects: [
      { id: 'chinese', name: '语文', full: 150, target: 122 },
      { id: 'math', name: '数学', full: 150, target: 132 },
      { id: 'english', name: '英语', full: 150, target: 130 },
      { id: 'physics', name: '物理', full: 100, target: 80 },
      { id: 'chemistry', name: '化学', full: 100, target: 84 },
      { id: 'biology', name: '生物', full: 100, target: 92 }
    ]
  };

  var SEED_EXAMS = [
    { id: 'e01', name: '高一上 · 第一次月考', date: '2025-09-26', type: '月考', scores: { chinese: 102, math: 96, english: 108, physics: 58, chemistry: 61, biology: 65 }, ranks: { class: 18, grade: 262 } },
    { id: 'e02', name: '高一上 · 第二次月考', date: '2025-10-30', type: '月考', scores: { chinese: 105, math: 101, english: 110, physics: 60, chemistry: 64, biology: 68 }, ranks: { class: 16, grade: 243 } },
    { id: 'e03', name: '高一上 · 期中考试', date: '2025-11-14', type: '期中', scores: { chinese: 108, math: 104, english: 112, physics: 63, chemistry: 66, biology: 68 }, ranks: { class: 15, grade: 231 } },
    { id: 'e04', name: '高一上 · 第三次月考', date: '2025-12-19', type: '月考', scores: { chinese: 105, math: 112, english: 110, physics: 66, chemistry: 70, biology: 71 }, ranks: { class: 13, grade: 205 } },
    { id: 'e05', name: '高一上 · 期末考试', date: '2026-01-22', type: '期末', scores: { chinese: 112, math: 108, english: 116, physics: 69, chemistry: 72, biology: 74 }, ranks: { class: 11, grade: 178 } },
    { id: 'e06', name: '高一下 · 第一次月考', date: '2026-03-13', type: '月考', scores: { chinese: 109, math: 99, english: 114, physics: 61, chemistry: 68, biology: 70 }, ranks: { class: 14, grade: 226 } },
    { id: 'e07', name: '高一下 · 期中考试', date: '2026-04-24', type: '期中', scores: { chinese: 114, math: 117, english: 119, physics: 72, chemistry: 74, biology: 73 }, ranks: { class: 9, grade: 148 } },
    { id: 'e08', name: '高一下 · 第二次月考', date: '2026-05-29', type: '月考', scores: { chinese: 112, math: 121, english: 118, physics: 74, chemistry: 76, biology: 75 }, ranks: { class: 8, grade: 133 } },
    { id: 'e09', name: '高一下 · 期末考试', date: '2026-07-08', type: '期末', scores: { chinese: 116, math: 118, english: 122, physics: 76, chemistry: 79, biology: 78 }, ranks: { class: 6, grade: 112 } },
    { id: 'e10', name: '高二上 · 第一次月考', date: '2026-09-25', type: '月考', scores: { chinese: 111, math: 113, english: 120, physics: 68, chemistry: 73, biology: 76 }, ranks: { class: 10, grade: 156 } },
    { id: 'e11', name: '高二上 · 期中考试', date: '2026-10-23', type: '期中', scores: { chinese: 115, math: 124, english: 123, physics: 72, chemistry: 77, biology: 79 }, ranks: { class: 7, grade: 118 } },
    { id: 'e12', name: '高二上 · 第二次月考', date: '2026-11-20', type: '月考', scores: { chinese: 118, math: 127, english: 125, physics: 75, chemistry: 80, biology: 81 }, ranks: { class: 5, grade: 96 } }
  ];

  function uid() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultState() {
    return {
      version: 1,
      config: clone(DEFAULT_CONFIG),
      exams: clone(SEED_EXAMS)
    };
  }

  /* ---------- 读取与计算 ---------- */

  function byDate(a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  }

  function sorted(state) {
    return state.exams.slice().sort(byDate);
  }

  function examTotal(state, exam) {
    var sum = 0;
    state.config.subjects.forEach(function (s) {
      sum += Number(exam.scores[s.id]) || 0;
    });
    return sum;
  }

  function fullTotal(state) {
    return state.config.subjects.reduce(function (acc, s) { return acc + Number(s.full || 0); }, 0);
  }

  function targetTotal(state) {
    var explicit = Number(state.config.targetTotal) || 0;
    if (explicit > 0) return explicit;
    return state.config.subjects.reduce(function (acc, s) { return acc + (Number(s.target) || 0); }, 0);
  }

  function rate(score, full) {
    if (!full) return 0;
    return (Number(score) || 0) / Number(full);
  }

  function mean(list) {
    if (!list.length) return 0;
    return list.reduce(function (a, b) { return a + b; }, 0) / list.length;
  }

  function stdev(list) {
    if (list.length < 2) return 0;
    var m = mean(list);
    var v = list.reduce(function (acc, x) { return acc + (x - m) * (x - m); }, 0) / (list.length - 1);
    return Math.sqrt(v);
  }

  /* ---------- 学期 ---------- */

  var GRADE_NAMES = ['一', '二', '三', '四', '五', '六'];

  /* 9 月是新学年的开始 */
  function schoolYearStart(date) {
    var y = Number(String(date).slice(0, 4));
    var m = Number(String(date).slice(5, 7));
    return m >= 9 ? y : y - 1;
  }

  function enrollYear(state) {
    var configured = Number(state.config.enrollYear) || 0;
    if (configured) return configured;
    var list = sorted(state);
    if (!list.length) return new Date().getFullYear();
    return schoolYearStart(list[0].date);
  }

  /* 一场考试属于哪个学期 */
  function semesterOf(state, date) {
    var m = Number(String(date).slice(5, 7));
    var start = schoolYearStart(date);
    var grade = start - enrollYear(state) + 1;
    if (grade < 1) grade = 1;
    /* 9 月到次年 1 月是上学期，2 月到 7 月是下学期 */
    var half = (m >= 9 || m <= 1) ? '上' : '下';
    return {
      key: start + '-' + half,
      grade: grade,
      half: half,
      start: start,
      label: '高' + (GRADE_NAMES[grade - 1] || grade) + half
    };
  }

  /* 按学期归组，返回顺序与时间一致 */
  function groupBySemester(state) {
    var groups = [];
    var map = {};
    sorted(state).forEach(function (exam) {
      var s = semesterOf(state, exam.date);
      if (!map[s.key]) {
        map[s.key] = { key: s.key, label: s.label, start: s.start, grade: s.grade, exams: [] };
        groups.push(map[s.key]);
      }
      map[s.key].exams.push(exam);
    });
    return groups.map(function (g) {
      var totals = g.exams.map(function (e) { return examTotal(state, e); });
      var ranks = g.exams.map(function (e) { return Number(e.ranks.grade) || null; })
        .filter(function (v) { return v !== null; });
      return {
        key: g.key,
        label: g.label,
        grade: g.grade,
        exams: g.exams,
        count: g.exams.length,
        first: g.exams[0],
        last: g.exams[g.exams.length - 1],
        avgTotal: mean(totals),
        best: Math.max.apply(null, totals),
        worst: Math.min.apply(null, totals),
        avgRank: ranks.length ? mean(ranks) : null
      };
    });
  }

  /* 走势图上用到的学期分段 */
  function semesterBands(state) {
    var groups = groupBySemester(state);
    return groups.map(function (g, i) {
      return {
        label: g.label,
        startTs: new Date(g.first.date + 'T00:00:00').getTime(),
        endTs: new Date(g.last.date + 'T00:00:00').getTime(),
        dividerTs: i > 0 ? new Date(g.first.date + 'T00:00:00').getTime() : null
      };
    });
  }

  /* 每科的完整序列，按时间升序 */
  function subjectSeries(state, subjectId) {
    var subject = state.config.subjects.find(function (s) { return s.id === subjectId; });
    if (!subject) return [];
    return sorted(state).map(function (exam) {
      var score = Number(exam.scores[subjectId]);
      return {
        exam: exam,
        score: isNaN(score) ? null : score,
        full: Number(subject.full) || 0,
        rate: isNaN(score) ? null : rate(score, subject.full)
      };
    });
  }

  /* 各科最近一次的得分率、目标、差距 */
  function subjectRows(state, exam) {
    return state.config.subjects.map(function (subject) {
      var score = Number(exam.scores[subject.id]);
      var has = !isNaN(score);
      var full = Number(subject.full) || 0;
      var target = Number(subject.target) || 0;
      return {
        subject: subject,
        score: has ? score : null,
        full: full,
        target: target,
        rate: has ? rate(score, full) : null,
        targetRate: full ? rate(target, full) : 0,
        gap: has && target ? score - target : null
      };
    });
  }

  /* 与上一场比较：总分、各科、排名 */
  function changeSince(state, exam) {
    var list = sorted(state);
    var i = list.findIndex(function (e) { return e.id === exam.id; });
    if (i <= 0) return null;
    var prev = list[i - 1];
    var per = {};
    state.config.subjects.forEach(function (s) {
      var a = Number(exam.scores[s.id]);
      var b = Number(prev.scores[s.id]);
      per[s.id] = (isNaN(a) || isNaN(b)) ? null : a - b;
    });
    return {
      exam: prev,
      total: examTotal(state, exam) - examTotal(state, prev),
      per: per,
      classRank: (Number(exam.ranks.class) || 0) - (Number(prev.ranks.class) || 0),
      gradeRank: (Number(exam.ranks.grade) || 0) - (Number(prev.ranks.grade) || 0)
    };
  }

  /* 单科统计：均值、波动、最高、最低、趋势斜率 */
  function subjectStats(state, subjectId) {
    var series = subjectSeries(state, subjectId).filter(function (p) { return p.score !== null; });
    var scores = series.map(function (p) { return p.score; });
    var rates = series.map(function (p) { return p.rate; });
    var best = series.reduce(function (a, b) { return (!a || b.score > a.score) ? b : a; }, null);
    var worst = series.reduce(function (a, b) { return (!a || b.score < a.score) ? b : a; }, null);
    var slope = 0;
    if (series.length >= 2) {
      var n = series.length;
      var xs = series.map(function (_, i) { return i; });
      var mx = mean(xs), my = mean(rates);
      var num = 0, den = 0;
      xs.forEach(function (x, i) { num += (x - mx) * (rates[i] - my); den += (x - mx) * (x - mx); });
      slope = den ? (num / den) * 100 : 0;
    }
    return {
      series: series,
      count: series.length,
      mean: mean(scores),
      meanRate: mean(rates),
      sd: stdev(scores),
      sdRate: stdev(rates),
      best: best,
      worst: worst,
      last: series[series.length - 1] || null,
      slope: slope
    };
  }

  /* 进步最大 / 最需补的科目：看与上一场相比的得分率变化 */
  function movers(state) {
    var list = sorted(state);
    if (list.length < 2) return { up: [], down: [] };
    var last = list[list.length - 1];
    var prev = list[list.length - 2];
    var rows = state.config.subjects.map(function (s) {
      var a = Number(last.scores[s.id]);
      var b = Number(prev.scores[s.id]);
      var full = Number(s.full) || 0;
      return {
        subject: s,
        delta: (isNaN(a) || isNaN(b)) ? null : a - b,
        deltaRate: (isNaN(a) || isNaN(b) || !full) ? null : (a - b) / full,
        score: isNaN(a) ? null : a
      };
    }).filter(function (r) { return r.delta !== null; });
    rows.sort(function (a, b) { return b.deltaRate - a.deltaRate; });
    return { up: rows.slice(0, 2), down: rows.slice(-2).reverse() };
  }

  /* ---------- 持久化 ---------- */

  function load() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        /* 第一次打开：把初始数据存下来，之后就以本地为准 */
        var fresh = defaultState();
        save(fresh);
        return fresh;
      }
      var parsed = JSON.parse(raw);
      return normalize(parsed);
    } catch (err) {
      return defaultState();
    }
  }

  function normalize(input) {
    var state = defaultState();
    if (!input || typeof input !== 'object') return state;
    if (input.config && typeof input.config === 'object') {
      state.config = Object.assign(state.config, input.config);
      if (!Array.isArray(state.config.subjects) || !state.config.subjects.length) {
        state.config.subjects = clone(DEFAULT_CONFIG.subjects);
      }
    }
    if (Array.isArray(input.exams)) {
      state.exams = input.exams.filter(function (e) { return e && e.date; }).map(function (e) {
        return {
          id: e.id || uid(),
          name: e.name || '未命名考试',
          date: String(e.date).slice(0, 10),
          type: e.type || '月考',
          scores: e.scores || {},
          ranks: e.ranks || {}
        };
      });
    }
    return state;
  }

  function save(state) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (err) {
      return false;
    }
  }

  function reset() {
    var fresh = defaultState();
    save(fresh);
    return fresh;
  }

  function clearExams() {
    var state = load();
    state.exams = [];
    save(state);
    return state;
  }

  /* ---------- 导入导出 ---------- */

  function csvEscape(value) {
    var text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCSV(state) {
    var subjects = state.config.subjects;
    var head = ['考试名称', '日期', '类型'].concat(subjects.map(function (s) { return s.name; }), ['班级排名', '年级排名']);
    var rows = sorted(state).map(function (e) {
      return [e.name, e.date, e.type || '']
        .concat(subjects.map(function (s) { return e.scores[s.id] === undefined ? '' : e.scores[s.id]; }))
        .concat([e.ranks.class || '', e.ranks.grade || '']);
    });
    return [head].concat(rows).map(function (row) {
      return row.map(csvEscape).join(',');
    }).join('\r\n');
  }

  function parseCSV(text) {
    var rows = [];
    var row = [];
    var field = '';
    var quoted = false;
    text = String(text).replace(/^\uFEFF/, '');
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); field = ''; rows.push(row); row = [];
      } else if (ch === '\r') {
        /* 跳过 */
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  /* 把表格行转成考试记录；按科目名匹配，允许列顺序不同 */
  function tableToExams(state, rows) {
    if (!rows.length) return { exams: [], errors: ['文件里没有可用的行'] };
    var head = rows[0].map(function (h) { return String(h).trim(); });
    var find = function (names) {
      for (var i = 0; i < names.length; i++) {
        var idx = head.indexOf(names[i]);
        if (idx >= 0) return idx;
      }
      return -1;
    };
    var iName = find(['考试名称', '名称', '考试', 'name']);
    var iDate = find(['日期', 'date', '考试日期']);
    var iType = find(['类型', 'type']);
    var iClass = find(['班级排名', '班排名', 'class']);
    var iGrade = find(['年级排名', '校排名', '年级名次', 'grade']);
    if (iDate < 0) return { exams: [], errors: ['缺少「日期」列'] };

    var subjectCols = [];
    state.config.subjects.forEach(function (s) {
      var idx = head.indexOf(s.name);
      if (idx < 0) idx = head.findIndex(function (h) { return h.replace(/\s/g, '') === s.name; });
      subjectCols.push({ id: s.id, idx: idx });
    });
    if (subjectCols.every(function (c) { return c.idx < 0; })) {
      return { exams: [], errors: ['没有找到任何科目列（' + state.config.subjects.map(function (s) { return s.name; }).join('、') + '）'] };
    }

    var errors = [];
    var exams = [];
    for (var r = 1; r < rows.length; r++) {
      var line = rows[r];
      var date = normalizeDate(line[iDate]);
      if (!date) { errors.push('第 ' + (r + 1) + ' 行日期无法识别'); continue; }
      var scores = {};
      subjectCols.forEach(function (c) {
        if (c.idx < 0) return;
        var raw = String(line[c.idx] === undefined ? '' : line[c.idx]).trim();
        if (raw === '') return;
        var num = Number(raw.replace(/[^\d.\-]/g, ''));
        if (!isNaN(num)) scores[c.id] = num;
      });
      exams.push({
        id: uid() + r,
        name: iName >= 0 ? String(line[iName] || '').trim() || date + ' 考试' : date + ' 考试',
        date: date,
        type: iType >= 0 ? String(line[iType] || '').trim() || '月考' : '月考',
        scores: scores,
        ranks: {
          class: iClass >= 0 ? (Number(String(line[iClass]).replace(/[^\d]/g, '')) || null) : null,
          grade: iGrade >= 0 ? (Number(String(line[iGrade]).replace(/[^\d]/g, '')) || null) : null
        }
      });
    }
    return { exams: exams, errors: errors };
  }

  function normalizeDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' || /^\d{5}$/.test(String(value).trim())) {
      /* Excel 序列号 */
      var serial = Number(value);
      if (serial > 20000 && serial < 60000) {
        var ms = Math.round((serial - 25569) * 86400000);
        var d = new Date(ms);
        return d.toISOString().slice(0, 10);
      }
    }
    var text = String(value).trim();
    var m = text.match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    if (m) {
      return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    }
    var t = Date.parse(text);
    if (!isNaN(t)) {
      return new Date(t).toISOString().slice(0, 10);
    }
    return null;
  }

  function mergeExams(state, incoming) {
    var existing = {};
    state.exams.forEach(function (e) { existing[e.date + '|' + e.name] = e; });
    var added = 0, replaced = 0;
    incoming.forEach(function (e) {
      var key = e.date + '|' + e.name;
      if (existing[key]) {
        var target = state.exams.find(function (x) { return x.id === existing[key].id; });
        target.scores = Object.assign({}, target.scores, e.scores);
        target.ranks = Object.assign({}, target.ranks, {
          class: e.ranks.class || target.ranks.class,
          grade: e.ranks.grade || target.ranks.grade
        });
        replaced++;
      } else {
        state.exams.push(e);
        added++;
      }
    });
    return { added: added, replaced: replaced };
  }

  global.Store = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    load: load,
    save: save,
    reset: reset,
    clearExams: clearExams,
    sorted: sorted,
    examTotal: examTotal,
    fullTotal: fullTotal,
    targetTotal: targetTotal,
    rate: rate,
    subjectSeries: subjectSeries,
    subjectRows: subjectRows,
    subjectStats: subjectStats,
    changeSince: changeSince,
    movers: movers,
    schoolYearStart: schoolYearStart,
    enrollYear: enrollYear,
    semesterOf: semesterOf,
    groupBySemester: groupBySemester,
    semesterBands: semesterBands,
    toCSV: toCSV,
    parseCSV: parseCSV,
    tableToExams: tableToExams,
    mergeExams: mergeExams,
    normalizeDate: normalizeDate,
    normalize: normalize,
    defaultState: defaultState,
    uid: uid
  };
})(window);

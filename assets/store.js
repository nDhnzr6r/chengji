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
    remainingExams: 3,
    passRate: 60,
    goodRate: 85,
    types: ['月考', '期中', '期末', '联考', '模拟'],
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
    { id: 'f01', name: '高一上 · 第一次月考', date: '2025-09-26', type: '月考', scores: { chinese: 104, math: 98, english: 110, physics: 60, chemistry: 63, biology: 65 }, ranks: { class: 20, grade: 280 }, averages: { class: 455, grade: 450, top: 688 }, subjectRanks: { chinese: 17, math: 20, english: 15, physics: 23, chemistry: 21, biology: 20 }, subjectAverages: { chinese: 94, math: 93, english: 94, physics: 62, chemistry: 62, biology: 62 } },
    { id: 'f02', name: '高一上 · 第二次月考', date: '2025-10-17', type: '月考', scores: { chinese: 106, math: 102, english: 112, physics: 61, chemistry: 65, biology: 66 }, ranks: { class: 18, grade: 256 }, averages: { class: 458, grade: 452, top: 690 }, subjectRanks: { chinese: 17, math: 18, english: 14, physics: 22, chemistry: 20, biology: 19 }, subjectAverages: { chinese: 95, math: 94, english: 95, physics: 62, chemistry: 63, biology: 63 } },
    { id: 'f03', name: '高一上 · 期中考试', date: '2025-11-14', type: '期中', scores: { chinese: 110, math: 105, english: 114, physics: 64, chemistry: 67, biology: 68 }, ranks: { class: 15, grade: 231 }, averages: { class: 449, grade: 444, top: 678 }, subjectRanks: { chinese: 15, math: 17, english: 13, physics: 20, chemistry: 19, biology: 18 }, subjectAverages: { chinese: 93, math: 93, english: 94, physics: 61, chemistry: 61, biology: 62 } },
    { id: 'f04', name: '高一上 · 第三次月考', date: '2025-12-12', type: '月考', scores: { chinese: 107, math: 100, english: 113, physics: 63, chemistry: 68, biology: 70 }, ranks: { class: 17, grade: 248 }, averages: { class: 463, grade: 458, top: 692 }, subjectRanks: { chinese: 16, math: 19, english: 14, physics: 21, chemistry: 18, biology: 17 }, subjectAverages: { chinese: 96, math: 95, english: 96, physics: 63, chemistry: 64, biology: 64 } },
    { id: 'f05', name: '高一上 · 期末考试', date: '2026-01-21', type: '期末', scores: { chinese: 112, math: 110, english: 116, physics: 66, chemistry: 70, biology: 71 }, ranks: { class: 12, grade: 198 }, averages: { class: 456, grade: 451, top: 686 }, subjectRanks: { chinese: 14, math: 15, english: 13, physics: 19, chemistry: 17, biology: 16 }, subjectAverages: { chinese: 95, math: 95, english: 95, physics: 62, chemistry: 63, biology: 63 } },
    { id: 'f06', name: '高一下 · 第一次月考', date: '2026-03-06', type: '月考', scores: { chinese: 109, math: 104, english: 115, physics: 63, chemistry: 69, biology: 73 }, ranks: { class: 14, grade: 226 }, averages: { class: 442, grade: 437, top: 671 }, subjectRanks: { chinese: 15, math: 17, english: 13, physics: 21, chemistry: 17, biology: 15 }, subjectAverages: { chinese: 92, math: 91, english: 92, physics: 60, chemistry: 61, biology: 61 } },
    { id: 'f07', name: '高一下 · 期中考试', date: '2026-04-24', type: '期中', scores: { chinese: 114, math: 116, english: 118, physics: 68, chemistry: 72, biology: 73 }, ranks: { class: 9, grade: 156 }, averages: { class: 459, grade: 454, top: 691 }, subjectRanks: { chinese: 13, math: 13, english: 12, physics: 18, chemistry: 16, biology: 15 }, subjectAverages: { chinese: 96, math: 96, english: 96, physics: 63, chemistry: 63, biology: 63 } },
    { id: 'f08', name: '高一下 · 第二次月考', date: '2026-05-22', type: '月考', scores: { chinese: 113, math: 121, english: 120, physics: 70, chemistry: 74, biology: 74 }, ranks: { class: 8, grade: 140 }, averages: { class: 466, grade: 460, top: 695 }, subjectRanks: { chinese: 14, math: 11, english: 11, physics: 17, chemistry: 15, biology: 15 }, subjectAverages: { chinese: 97, math: 98, english: 98, physics: 64, chemistry: 65, biology: 65 } },
    { id: 'f09', name: '高一下 · 六校联考', date: '2026-06-19', type: '联考', scores: { chinese: 112, math: 114, english: 119, physics: 66, chemistry: 73, biology: 74 }, ranks: { class: 11, grade: 172 }, averages: { class: 448, grade: 443, top: 676 }, subjectRanks: { chinese: 14, math: 13, english: 12, physics: 19, chemistry: 15, biology: 15 }, subjectAverages: { chinese: 93, math: 93, english: 94, physics: 61, chemistry: 62, biology: 62 } },
    { id: 'f10', name: '高一下 · 期末考试', date: '2026-07-08', type: '期末', scores: { chinese: 117, math: 122, english: 122, physics: 73, chemistry: 76, biology: 75 }, ranks: { class: 6, grade: 121 }, averages: { class: 460, grade: 455, top: 692 }, subjectRanks: { chinese: 12, math: 10, english: 10, physics: 15, chemistry: 13, biology: 14 }, subjectAverages: { chinese: 96, math: 97, english: 97, physics: 64, chemistry: 64, biology: 64 } },
    { id: 'f11', name: '高二上 · 第一次月考', date: '2026-09-11', type: '月考', scores: { chinese: 114, math: 113, english: 121, physics: 66, chemistry: 72, biology: 80 }, ranks: { class: 10, grade: 160 }, averages: { class: 437, grade: 432, top: 668 }, subjectRanks: { chinese: 13, math: 14, english: 11, physics: 19, chemistry: 16, biology: 11 }, subjectAverages: { chinese: 91, math: 91, english: 92, physics: 60, chemistry: 60, biology: 61 } },
    { id: 'f12', name: '高二上 · 期中考试', date: '2026-10-23', type: '期中', scores: { chinese: 118, math: 125, english: 124, physics: 70, chemistry: 76, biology: 81 }, ranks: { class: 7, grade: 118 }, averages: { class: 452, grade: 447, top: 684 }, subjectRanks: { chinese: 12, math: 9, english: 10, physics: 17, chemistry: 13, biology: 11 }, subjectAverages: { chinese: 95, math: 95, english: 95, physics: 62, chemistry: 63, biology: 63 } },
    { id: 'f13', name: '高二上 · 六校联考', date: '2026-11-07', type: '联考', scores: { chinese: 119, math: 127, english: 125, physics: 71, chemistry: 78, biology: 81 }, ranks: { class: 6, grade: 108 }, averages: { class: 458, grade: 453, top: 688 }, subjectRanks: { chinese: 12, math: 9, english: 9, physics: 16, chemistry: 12, biology: 11 }, subjectAverages: { chinese: 96, math: 97, english: 96, physics: 63, chemistry: 64, biology: 64 } },
    { id: 'f14', name: '高二上 · 第二次月考', date: '2026-11-20', type: '月考', scores: { chinese: 120, math: 130, english: 126, physics: 73, chemistry: 80, biology: 83 }, ranks: { class: 5, grade: 96 }, averages: { class: 449, grade: 444, top: 680 }, subjectRanks: { chinese: 11, math: 7, english: 9, physics: 15, chemistry: 11, biology: 10 }, subjectAverages: { chinese: 94, math: 95, english: 95, physics: 62, chemistry: 63, biology: 63 } },
    { id: 'f15', name: '高二上 · 期末考试', date: '2026-12-18', type: '期末', scores: { chinese: 122, math: 132, english: 128, physics: 75, chemistry: 82, biology: 84 }, ranks: { class: 4, grade: 88 }, averages: { class: 451, grade: 446, top: 683 }, subjectRanks: { chinese: 10, math: 7, english: 8, physics: 14, chemistry: 10, biology: 9 }, subjectAverages: { chinese: 95, math: 96, english: 95, physics: 63, chemistry: 63, biology: 63 } }
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

  function allSorted(state) {
    return state.exams.slice().sort(byDate);
  }

  /* 已经被类型筛选过一次的列表；没设筛选就是全部 */
  function sorted(state) {
    var list = allSorted(state);
    var f = state.filter || 'all';
    if (f === 'all') return list;
    return list.filter(function (e) { return (e.type || '月考') === f; });
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

  /* ---------- 考试类型 ---------- */

  function typeFacets(state) {
    var map = {};
    allSorted(state).forEach(function (e) {
      var t = e.type || '月考';
      map[t] = (map[t] || 0) + 1;
    });
    return Object.keys(map).map(function (t) {
      return { type: t, count: map[t] };
    }).sort(function (a, b) { return b.count - a.count || a.type.localeCompare(b.type); });
  }

  function filterByType(list, type) {
    if (!type || type === 'all') return list;
    return list.filter(function (e) { return (e.type || '月考') === type; });
  }

  /* ---------- 参照与诊断 ---------- */

  /* 自己和班级平均、年级平均、最高分的关系，以及这次变化该算题难还是状态 */
  function examVsPeers(state, exam) {
    var list = sorted(state);
    var idx = list.findIndex(function (e) { return e.id === exam.id; });
    var prev = idx > 0 ? list[idx - 1] : null;
    var avg = exam.averages || {};
    var total = examTotal(state, exam);
    var classAvg = Number(avg.class) || null;
    var gradeAvg = Number(avg.grade) || null;
    var top = Number(avg.top) || null;

    var result = {
      total: total,
      classAvg: classAvg,
      gradeAvg: gradeAvg,
      top: top,
      vsClass: classAvg === null ? null : total - classAvg,
      vsGrade: gradeAvg === null ? null : total - gradeAvg,
      toTop: top === null ? null : top - total,
      diagnosis: null
    };

    if (prev && classAvg !== null && Number(prev.averages && prev.averages.class)) {
      var prevTotal = examTotal(state, prev);
      var prevClass = Number(prev.averages.class);
      var dSelf = total - prevTotal;
      var dAvg = classAvg - prevClass;
      var dGap = (total - classAvg) - (prevTotal - prevClass);

      if (dSelf < 0 && dGap > 0) {
        result.diagnosis = { tone: 'flat', text: '平均分也降了，题目偏难，位次其实在往前' };
      } else if (dSelf < 0 && dGap <= 0) {
        result.diagnosis = { tone: 'bad', text: '平均分没怎么动，是这次状态掉了' };
      } else if (dSelf > 0 && dGap < 0) {
        result.diagnosis = { tone: 'warn', text: '分数涨了，但别人涨得更多，位次在往后退' };
      } else if (dSelf > 0 && dAvg < 0) {
        result.diagnosis = { tone: 'good', text: '平均分在降，你还在涨，明显拉开了' };
      } else if (dSelf > 0 && dGap > 0) {
        result.diagnosis = { tone: 'good', text: '比平均分涨得多，位次在往前' };
      } else if (dSelf > 0) {
        result.diagnosis = { tone: 'flat', text: '跟着平均分一起涨，题目偏容易' };
      }
    }

    return result;
  }

  /* 单科在班级里的位置 */
  function subjectRankOf(state, exam, subjectId) {
    var r = Number((exam.subjectRanks || {})[subjectId]) || null;
    if (!r) return null;
    var size = Number(state.config.classSize) || 0;
    var topPct = size ? (r / size) * 100 : null;
    return {
      rank: r,
      size: size,
      topPct: topPct,
      label: topPct === null ? '第 ' + r + ' 名' : '班级第 ' + r + ' 名 · 前 ' + topPct.toFixed(0) + '%'
    };
  }

  /* ---------- 偏科 ---------- */

  function subjectSpread(state, exam) {
    var items = [];
    state.config.subjects.forEach(function (s) {
      var v = Number(exam.scores[s.id]);
      var full = Number(s.full) || 0;
      if (isNaN(v) || !full) return;
      items.push({ id: s.id, name: s.name, value: v, full: full, rate: (v / full) * 100 });
    });
    if (items.length < 2) return null;

    var rates = items.map(function (i) { return i.rate; });
    var avg = mean(rates);
    var sd = Math.sqrt(mean(rates.map(function (r) { return (r - avg) * (r - avg); })));
    var ordered = items.slice().sort(function (a, b) { return a.rate - b.rate; });
    var pass = Number(state.config.passRate) || 60;
    var good = Number(state.config.goodRate) || 85;

    var level;
    if (sd < 6) level = { text: '均衡', tone: 'good' };
    else if (sd < 12) level = { text: '略有偏科', tone: 'flat' };
    else level = { text: '偏科明显', tone: 'warn' };

    return {
      items: ordered,
      avg: avg,
      sd: sd,
      spread: ordered[ordered.length - 1].rate - ordered[0].rate,
      weakest: ordered[0],
      strongest: ordered[ordered.length - 1],
      pass: items.filter(function (i) { return i.rate >= pass; }).length,
      good: items.filter(function (i) { return i.rate >= good; }).length,
      count: items.length,
      level: level
    };
  }

  /* ---------- 目标倒推与预测 ---------- */

  function pace(state) {
    var list = sorted(state);
    var goal = targetTotal(state);
    if (!list.length) return null;

    var totals = list.map(function (e) { return examTotal(state, e); });
    var current = totals[totals.length - 1];
    var goalGap = goal - current;
    var remaining = Number(state.config.remainingExams) || 0;

    var result = {
      current: current,
      goal: goal,
      gap: goalGap,
      remaining: remaining,
      needPerExam: remaining > 0 ? goalGap / remaining : null,
      slope: 0,
      predict: null,
      onTrack: null
    };

    if (totals.length < 3) return result;

    /* 最近六次做线性拟合，斜率就是每场平均推进的分数 */
    var recent = totals.slice(-6);
    var n = recent.length;
    var mx = (n - 1) / 2;
    var my = mean(recent);
    var num = 0;
    var den = 0;
    recent.forEach(function (y, i) {
      num += (i - mx) * (y - my);
      den += (i - mx) * (i - mx);
    });
    var slope = den ? num / den : 0;
    var fullCap = fullTotal(state) || 0;

    /* 拟合残差，拿来做预测区间的宽度 */
    var resid = 0;
    recent.forEach(function (y, i) {
      var fit = my + slope * (i - mx);
      resid += (y - fit) * (y - fit);
    });
    var band = Math.sqrt(resid / Math.max(1, recent.length - 2)) || 0;

    result.slope = slope;
    result.predict = Math.max(0, Math.min(fullCap || Infinity, current + slope));
    result.low = Math.max(0, Math.min(fullCap || Infinity, current + slope - band));
    result.high = Math.max(0, Math.min(fullCap || Infinity, current + slope + band));
    result.band = band;
    result.predictDiff = slope;
    result.onTrack = remaining > 0 ? slope >= result.needPerExam : null;

    return result;
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
    /* 方向翻转了几次：标准差一样的两种曲线，来回跳的那种翻转更多 */
    var flips = 0;
    for (var k = 2; k < scores.length; k++) {
      var a = scores[k - 1] - scores[k - 2];
      var b = scores[k] - scores[k - 1];
      if (a === 0 || b === 0) continue;
      if ((a > 0) !== (b > 0)) flips++;
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
      slope: slope,
      flips: flips
    };
  }

  /* 进步最大 / 最需补的科目：看与上一场相比的得分率变化 */
  /* ---------- 结论 ---------- */

  function signed(n) {
    var v = Number(n) || 0;
    if (Math.abs(v) < 0.005) return '0';
    return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(0);
  }

  /* 把最近的走势翻成一句话和几个状态词，省得每次自己看数字 */
  function insight(state) {
    var list = sorted(state);
    if (!list.length) return null;

    var last = list[list.length - 1];
    var prev = list.length > 1 ? list[list.length - 2] : null;
    var total = examTotal(state, last);
    var prevTotal = prev ? examTotal(state, prev) : null;
    var goal = targetTotal(state);
    var gap = goal - total;
    var rankGrade = Number(last.ranks.grade) || null;
    var goalGrade = Number(state.config.targetRankGrade) || null;
    var rankClass = Number(last.ranks.class) || null;
    var goalClass = Number(state.config.targetRankClass) || null;
    var full = fullTotal(state);

    /* 连续上涨和连续下跌的次数，用得分率比，满分变了也不会误判 */
    var rateOf = function (e) {
      var f = fullTotal(state);
      return f ? examTotal(state, e) / f : 0;
    };
    var up = 0;
    for (var i = list.length - 1; i > 0; i--) {
      if (rateOf(list[i]) > rateOf(list[i - 1]) + 0.0005) up++;
      else break;
    }
    var down = 0;
    for (var j = list.length - 1; j > 0; j--) {
      if (rateOf(list[j]) < rateOf(list[j - 1]) - 0.0005) down++;
      else break;
    }

    var gradeDelta = (prevTotal !== null && rankGrade && Number(prev.ranks.grade))
      ? Number(prev.ranks.grade) - rankGrade : null;
    var classDelta = (prevTotal !== null && rankClass && Number(prev.ranks.class))
      ? Number(prev.ranks.class) - rankClass : null;

    /* 每个数字配一句判断 */
    var totalState;
    if (up >= 3) totalState = { text: '连涨 ' + up + ' 次', tone: 'good' };
    else if (up === 2) totalState = { text: '连涨 2 次', tone: 'good' };
    else if (up === 1) totalState = { text: '较上次 ' + signed(prevTotal === null ? 0 : total - prevTotal), tone: 'good' };
    else if (down >= 2) totalState = { text: '连跌 ' + down + ' 次', tone: 'bad' };
    else if (down === 1) totalState = { text: '较上次 ' + signed(total - prevTotal), tone: 'bad' };
    else totalState = { text: '与上次持平', tone: 'flat' };

    var gradeState = null;
    if (rankGrade && goalGrade) {
      gradeState = rankGrade <= goalGrade
        ? { text: '已进前 ' + goalGrade, tone: 'good' }
        : { text: '距前 ' + goalGrade + ' 还差 ' + (rankGrade - goalGrade) + ' 名', tone: 'warn' };
    } else if (rankGrade) {
      gradeState = { text: '第 ' + rankGrade + ' 名', tone: 'flat' };
    }

    var classState = null;
    if (rankClass && goalClass) {
      classState = rankClass <= goalClass
        ? { text: '已进前 ' + goalClass, tone: 'good' }
        : { text: '距前 ' + goalClass + ' 还差 ' + (rankClass - goalClass) + ' 名', tone: 'warn' };
    }

    var gapState = gap > 0
      ? { text: '还差 ' + gap + ' 分', tone: 'warn' }
      : { text: '已超 ' + Math.abs(gap) + ' 分', tone: 'good' };

    /* 各科达标情况 */
    var hit = 0, miss = 0;
    state.config.subjects.forEach(function (s) {
      var v = Number(last.scores[s.id]);
      var t = Number(s.target) || 0;
      if (isNaN(v) || !t) return;
      if (v >= t) hit++; else miss++;
    });

    var subjectState = miss === 0 && hit > 0
      ? { text: hit + ' 科全部达标', tone: 'good' }
      : { text: hit + ' 科达标 · ' + miss + ' 科没到', tone: miss >= 3 ? 'bad' : 'warn' };

    /* 一句话结论：先说往哪走，再说差多远 */
    var parts = [];
    if (up >= 2) parts.push('总分连涨 ' + up + ' 次');
    else if (down >= 2) parts.push('总分连跌 ' + down + ' 次');
    else if (prevTotal !== null) parts.push('总分较上次' + (total > prevTotal ? '涨' : total < prevTotal ? '跌' : '持平') + ' ' + Math.abs(total - prevTotal) + ' 分');

    if (gradeDelta !== null && gradeDelta > 0) parts.push('年级前进 ' + gradeDelta + ' 名');
    else if (gradeDelta !== null && gradeDelta < 0) parts.push('年级后退 ' + Math.abs(gradeDelta) + ' 名');
    else if (classDelta !== null && classDelta > 0) parts.push('班级前进 ' + classDelta + ' 名');

    parts.push(gap > 0 ? '离目标还差 ' + gap + ' 分' : '已超目标 ' + Math.abs(gap) + ' 分');

    return {
      total: total,
      full: full,
      gap: gap,
      goal: goal,
      headlines: parts,
      totalState: totalState,
      gradeState: gradeState,
      classState: classState,
      gapState: gapState,
      subjectState: subjectState,
      up: up,
      down: down
    };
  }

  /* 把明显不对的数据挑出来，让人能去改 */
  function audit(state) {
    var issues = [];
    var full = fullTotal(state);
    var classSize = Number(state.config.classSize) || 0;
    var gradeSize = Number(state.config.gradeSize) || 0;
    var seen = {};

    sorted(state).forEach(function (e) {
      var key = e.date + '|' + e.name;
      if (seen[key]) issues.push({ text: e.date + ' 有两场都叫「' + e.name + '」，走势上会重复算一次' });
      seen[key] = true;

      state.config.subjects.forEach(function (sub) {
        var v = Number(e.scores[sub.id]);
        if (isNaN(v)) return;
        if (v < 0) issues.push({ text: e.date + ' 的' + sub.name + '是负分' });
        else if (v > Number(sub.full)) issues.push({ text: e.date + ' 的' + sub.name + ' ' + v + ' 分超过满分 ' + sub.full });
      });

      var t = examTotal(state, e);
      if (t > full) issues.push({ text: e.date + ' 的总分 ' + t + ' 超过满分合计 ' + full });

      var rc = Number(e.ranks.class) || 0;
      var rg = Number(e.ranks.grade) || 0;
      if (rc && classSize && rc > classSize) issues.push({ text: e.date + ' 的班级排名 ' + rc + ' 超过班级人数 ' + classSize });
      if (rg && gradeSize && rg > gradeSize) issues.push({ text: e.date + ' 的年级排名 ' + rg + ' 超过年级人数 ' + gradeSize });

      var avg = e.averages || {};
      if (Number(avg.class) > full) issues.push({ text: e.date + ' 的班级平均 ' + avg.class + ' 超过满分 ' + full });
      if (Number(avg.grade) > full) issues.push({ text: e.date + ' 的年级平均 ' + avg.grade + ' 超过满分 ' + full });
      if (Number(avg.top) > full) issues.push({ text: e.date + ' 的年级最高 ' + avg.top + ' 超过满分 ' + full });
    });

    state.config.subjects.forEach(function (sub) {
      if (Number(sub.target) > Number(sub.full)) {
        issues.push({ text: sub.name + ' 的目标分 ' + sub.target + ' 高于满分 ' + sub.full });
      }
    });

    var goal = targetTotal(state);
    if (goal > full) issues.push({ text: '目标总分 ' + goal + ' 高于满分合计 ' + full });

    return issues;
  }


  /* ---------- 平滑进退、分布、贡献、投入排序 ---------- */

  /* 最近三次的平均变化，避免一次波动就上榜 */
  function smoothMovers(state, span) {
    span = span || 3;
    var list = sorted(state);
    if (list.length < 2) return { up: [], down: [] };
    var out = [];
    state.config.subjects.forEach(function (sub) {
      var series = list
        .map(function (e) { return Number(e.scores[sub.id]); })
        .filter(function (v) { return !isNaN(v); });
      if (series.length < 2) return;
      var tail = series.slice(-span - 1);
      var first = tail[0];
      var last = tail[tail.length - 1];
      var per = (last - first) / Math.max(1, tail.length - 1);
      out.push({ subject: sub, first: first, last: last, delta: last - first, per: per });
    });
    out.sort(function (a, b) { return b.per - a.per; });
    return {
      up: out.filter(function (x) { return x.per > 0.4; }).slice(0, 3),
      down: out.filter(function (x) { return x.per < -0.4; }).slice(-3).reverse()
    };
  }

  /* 各科在总分里的份量，以及这份量是在变大还是变小 */
  function contribution(state, exam) {
    var rows = [];
    var total = examTotal(state, exam);
    if (!total) return rows;
    state.config.subjects.forEach(function (sub) {
      var v = Number(exam.scores[sub.id]);
      if (isNaN(v)) return;
      rows.push({ subject: sub, value: v, share: v / total });
    });
    return rows.sort(function (a, b) { return b.share - a.share; });
  }

  /* 总分的分布：分成若干段，看每次落在哪 */
  function distribution(state, buckets) {
    buckets = buckets || 6;
    var list = sorted(state);
    if (!list.length) return null;
    var totals = list.map(function (e) { return examTotal(state, e); });
    var lo = Math.min.apply(null, totals);
    var hi = Math.max.apply(null, totals);
    if (hi - lo < 1) hi = lo + 1;
    var step = (hi - lo) / buckets;
    var bins = [];
    for (var i = 0; i < buckets; i++) {
      bins.push({ from: lo + step * i, to: lo + step * (i + 1), count: 0, exams: [] });
    }
    totals.forEach(function (v, idx) {
      var k = Math.min(buckets - 1, Math.floor((v - lo) / step));
      bins[k].count++;
      bins[k].exams.push(list[idx]);
    });
    return { bins: bins, list: list, totals: totals, lo: lo, hi: hi };
  }

  /* 最值得投入的科目：缺口占满分的比例越大越先补 */
  function priority(state, exam) {
    var rows = [];
    state.config.subjects.forEach(function (sub) {
      var v = Number(exam.scores[sub.id]);
      var f = Number(sub.full) || 0;
      if (isNaN(v) || !f) return;
      var gap = f - v;
      rows.push({
        subject: sub,
        value: v,
        full: f,
        gap: gap,
        gapRate: gap / f
      });
    });
    return rows.sort(function (a, b) { return (b.gapRate - a.gapRate) || (b.gap - a.gap); });
  }

  /* 一科多考几分，总分和名次会怎么动 */
  function sensitivity(state, subjectId, delta) {
    delta = delta === undefined ? 10 : delta;
    var list = sorted(state);
    if (!list.length) return null;
    var last = list[list.length - 1];
    var subject = state.config.subjects.find(function (s) { return s.id === subjectId; });
    if (!subject) return null;

    var base = examTotal(state, last);
    var after = base + delta;
    var result = {
      subject: subject,
      delta: delta,
      before: base,
      after: after,
      rankBefore: Number(last.ranks.grade) || null,
      rankAfter: null
    };

    /* 有名次也有均分时，按历史拟合一条「分差 → 名次」的线 */
    var pts = [];
    list.forEach(function (e) {
      var t = examTotal(state, e);
      var avg = Number(e.averages && e.averages.class) || null;
      var r = Number(e.ranks.grade) || null;
      if (avg && r) pts.push({ d: t - avg, r: r });
    });
    /* 只取最近四次，早期的关系放到现在已经不准了 */
    pts = pts.slice(-4);
    if (pts.length >= 2) {
      var md = mean(pts.map(function (x) { return x.d; }));
      var mr = mean(pts.map(function (x) { return x.r; }));
      var num = 0, den = 0;
      pts.forEach(function (x) {
        num += (x.d - md) * (x.r - mr);
        den += (x.d - md) * (x.d - md);
      });
      var slope = den ? num / den : 0;
      var curAvg = Number(last.averages && last.averages.class) || md;
      var curD = base - curAvg;
      if (slope !== 0 && result.rankBefore) {
        var est = mr + slope * (curD + delta);
        /* 外推太远就不靠谱，限制在这几次名次的上下界附近 */
        var bounds = pts.map(function (x) { return x.r; });
        var loR = Math.min.apply(null, bounds);
        var hiR = Math.max.apply(null, bounds);
        est = Math.min(hiR + (hiR - loR) * 0.2, Math.max(loR - (hiR - loR) * 0.2, est));
        result.rankAfter = Math.max(1, Math.round(est));
        result.rankDelta = result.rankBefore - result.rankAfter;
      }
    }
    return result;
  }

  /* 按本学期已有的速度，估下一次和学期末 */
  function termForecast(state) {
    var list = sorted(state);
    if (list.length < 3) return null;
    var p = pace(state);
    if (!p || !p.slope) return null;

    var bands = semesterBands(state);
    var lastBand = bands.length ? bands[bands.length - 1] : null;
    var inTerm = lastBand
      ? list.filter(function (e) { return new Date(e.date + 'T00:00:00').getTime() >= lastBand.startTs; })
      : list;
    if (inTerm.length < 2) return null;

    var totals = inTerm.map(function (e) { return examTotal(state, e); });
    var n = totals.length;
    var mx = (n - 1) / 2;
    var my = mean(totals);
    var num = 0, den = 0;
    totals.forEach(function (y, i) {
      num += (i - mx) * (y - my);
      den += (i - mx) * (i - mx);
    });
    var slope = den ? num / den : 0;
    var now = totals[n - 1];
    var cap = fullTotal(state) || Infinity;

    return {
      term: lastBand ? lastBand.label : '本学期',
      count: n,
      slope: slope,
      next: Math.max(0, Math.min(cap, now + slope)),
      end: Math.max(0, Math.min(cap, now + slope * Math.max(1, 6 - n))),
      now: now
    };
  }

  /* 偏科程度的历史，用来判断在收敛还是扩大 */
  function spreadHistory(state) {
    var list = sorted(state);
    var out = [];
    list.forEach(function (e) {
      var sp = subjectSpread(state, e);
      if (sp) out.push({ date: e.date, name: e.name, sd: sp.sd, spread: sp.spread });
    });
    return out;
  }

  /* 各科目标加起来和目标总分对不对得上 */
  function goalCheck(state) {
    var sum = state.config.subjects.reduce(function (acc, s) { return acc + (Number(s.target) || 0); }, 0);
    var goal = targetTotal(state);
    var explicit = Number(state.config.targetTotal) || 0;
    return {
      subjectSum: sum,
      goal: goal,
      explicit: explicit,
      mismatch: explicit > 0 && Math.abs(sum - explicit) > 1 ? sum - explicit : 0
    };
  }

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
    if (!Array.isArray(state.config.types) || !state.config.types.length) {
      state.config.types = ['月考', '期中', '期末', '联考', '模拟'];
    }
    if (Array.isArray(input.exams)) {
      state.exams = input.exams.filter(function (e) { return e && e.date; }).map(function (e) {
        return {
          id: e.id || uid(),
          name: e.name || '未命名考试',
          date: String(e.date).slice(0, 10),
          type: e.type || '月考',
          scores: e.scores || {},
          ranks: e.ranks || {},
          averages: e.averages || {},
          subjectAverages: e.subjectAverages || {},
          subjectRanks: e.subjectRanks || {}
        };
      });
    }
    state.exams.forEach(function (e) {
      var t = e.type || '月考';
      if (state.config.types.indexOf(t) < 0) state.config.types.push(t);
    });
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
    var head = ['考试名称', '日期', '类型']
      .concat(subjects.map(function (s) { return s.name; }))
      .concat(subjects.map(function (s) { return s.name + '名次'; }))
      .concat(subjects.map(function (s) { return s.name + '平均'; }))
      .concat(['班级排名', '年级排名', '班级平均', '年级平均', '年级最高']);
    var rows = sorted(state).map(function (e) {
      var avg = e.averages || {};
      var sr = e.subjectRanks || {};
      var sa = e.subjectAverages || {};
      return [e.name, e.date, e.type || '']
        .concat(subjects.map(function (s) { return e.scores[s.id] === undefined ? '' : e.scores[s.id]; }))
        .concat(subjects.map(function (s) { return sr[s.id] || ''; }))
        .concat(subjects.map(function (s) { return sa[s.id] || ''; }))
        .concat([e.ranks.class || '', e.ranks.grade || '', avg.class || '', avg.grade || '', avg.top || '']);
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
    var iAvgClass = find(['班级平均', '班平均', '班平']);
    var iAvgGrade = find(['年级平均', '年平均', '年平']);
    var iAvgTop = find(['年级最高', '最高分', '年最高']);
    if (iDate < 0) return { exams: [], errors: ['缺少「日期」列'] };

    var subjectCols = [];
    var subjectRankCols = [];
    var subjectAvgCols = [];
    state.config.subjects.forEach(function (s) {
      var idx = head.indexOf(s.name);
      if (idx < 0) idx = head.findIndex(function (h) { return h.replace(/\s/g, '') === s.name; });
      subjectCols.push({ id: s.id, idx: idx });
      var rIdx = find([s.name + '名次', s.name + '排名', s.name + '班名次']);
      subjectRankCols.push({ id: s.id, idx: rIdx });
      var aIdx = find([s.name + '平均', s.name + '班平均']);
      subjectAvgCols.push({ id: s.id, idx: aIdx });
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
      var saOut = {};
      subjectAvgCols.forEach(function (c) {
        if (c.idx < 0) return;
        var raw = String(line[c.idx] === undefined ? '' : line[c.idx]).trim();
        if (raw === '') return;
        var n = Number(raw.replace(/[^\d.]/g, ''));
        if (!isNaN(n) && n > 0) saOut[c.id] = n;
      });
      var srOut = {};
      subjectRankCols.forEach(function (c) {
        if (c.idx < 0) return;
        var raw = String(line[c.idx] === undefined ? '' : line[c.idx]).trim();
        if (raw === '') return;
        var n = Number(raw.replace(/[^\d]/g, ''));
        if (n > 0) srOut[c.id] = n;
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
        },
        averages: {
          class: iAvgClass >= 0 ? (Number(String(line[iAvgClass]).replace(/[^\d.]/g, '')) || null) : null,
          grade: iAvgGrade >= 0 ? (Number(String(line[iAvgGrade]).replace(/[^\d.]/g, '')) || null) : null,
          top: iAvgTop >= 0 ? (Number(String(line[iAvgTop]).replace(/[^\d.]/g, '')) || null) : null
        },
        subjectAverages: saOut,
        subjectRanks: srOut
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
        target.averages = Object.assign({}, target.averages || {}, {
          class: e.averages.class || (target.averages && target.averages.class),
          grade: e.averages.grade || (target.averages && target.averages.grade),
          top: e.averages.top || (target.averages && target.averages.top)
        });
        target.subjectRanks = Object.assign({}, target.subjectRanks || {}, e.subjectRanks || {});
        target.subjectAverages = Object.assign({}, target.subjectAverages || {}, e.subjectAverages || {});
        if (e.type) target.type = e.type;
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
    allSorted: allSorted,
    examTotal: examTotal,
    fullTotal: fullTotal,
    targetTotal: targetTotal,
    rate: rate,
    subjectSeries: subjectSeries,
    subjectRows: subjectRows,
    subjectStats: subjectStats,
    changeSince: changeSince,
    movers: movers,
    smoothMovers: smoothMovers,
    contribution: contribution,
    distribution: distribution,
    priority: priority,
    sensitivity: sensitivity,
    termForecast: termForecast,
    spreadHistory: spreadHistory,
    goalCheck: goalCheck,
    audit: audit,
    typeFacets: typeFacets,
    filterByType: filterByType,
    examVsPeers: examVsPeers,
    subjectRankOf: subjectRankOf,
    subjectSpread: subjectSpread,
    pace: pace,
    insight: insight,
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

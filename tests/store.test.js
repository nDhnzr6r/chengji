'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

/* 内存版 localStorage；failNext 用来模拟配额写满 */
const ls = {
  map: new Map(),
  failNext: false,
  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  },
  setItem(key, value) {
    if (this.failNext) {
      this.failNext = false;
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.map.set(key, String(value));
  },
  removeItem(key) {
    this.map.delete(key);
  }
};

global.window = { localStorage: ls };
require(path.join(__dirname, '..', 'assets', 'store.js'));
const S = global.window.Store;

test.beforeEach(() => {
  ls.map.clear();
  ls.failNext = false;
  S.storage.available = true;
  S.storage.reason = null;
  S.storage.broken = null;
});

/* 造一批指定总分的考试，分数平均摊到六科 */
function stateWithTotals(totals) {
  const state = S.defaultState();
  state.filter = 'all';
  state.exams = totals.map((total, i) => {
    const per = total / state.config.subjects.length;
    const scores = {};
    state.config.subjects.forEach((s) => { scores[s.id] = per; });
    return {
      id: 'e' + i,
      name: '第 ' + (i + 1) + ' 次',
      date: '2026-0' + (i + 1) + '-10',
      type: '月考',
      scores,
      ranks: {},
      averages: {}
    };
  });
  return state;
}

/* ---------------- 数据整理 ---------------- */

test('缺字段的记录被补齐，没有日期的行被丢掉', () => {
  const state = S.normalize({
    exams: [
      { date: '2026-03-01', name: '有日期', scores: { math: 100 } },
      { name: '没有日期' }
    ]
  });
  assert.equal(state.exams.length, 1);
  assert.equal(state.exams[0].name, '有日期');
  assert.equal(state.config.subjects.length, 6);
});

test('考试里出现的类型会补进类型列表', () => {
  const state = S.normalize({
    exams: [{ date: '2026-03-01', name: '周测一场', type: '周测', scores: {} }]
  });
  assert.ok(state.config.types.includes('周测'));
});

test('sample 为 false 时不被默认值改回来', () => {
  const state = S.normalize({ sample: false, exams: [] });
  assert.equal(state.sample, false);
});

/* ---------------- 排序与筛选 ---------------- */

test('按日期升序，筛选只留指定类型', () => {
  const state = S.defaultState();
  state.filter = 'all';
  state.exams = [
    { id: 'b', name: '后', date: '2026-05-01', type: '期中', scores: {} },
    { id: 'a', name: '前', date: '2026-03-01', type: '月考', scores: {} }
  ];
  assert.deepEqual(S.allSorted(state).map((e) => e.id), ['a', 'b']);

  state.filter = '期中';
  assert.deepEqual(S.sorted(state).map((e) => e.id), ['b']);
  assert.equal(S.allSorted(state).length, 2);
});

/* ---------------- 分数换算 ---------------- */

test('总分只累加配置里的科目', () => {
  const state = S.defaultState();
  const exam = { scores: { chinese: 100, math: 120, english: 110, physics: 70, chemistry: 80, biology: 90, 别的科目: 999 } };
  assert.equal(S.examTotal(state, exam), 570);
  assert.equal(S.fullTotal(state), 750);
});

test('得分率按满分折算', () => {
  assert.equal(S.rate(90, 150), 0.6);
  assert.equal(S.rate(0, 150), 0);
  assert.equal(S.rate(50, 0), 0);
});

test('单科班级名次换成百分比', () => {
  const state = S.defaultState();
  const info = S.subjectRankOf(state, { subjectRanks: { math: 9 } }, 'math');
  assert.equal(info.rank, 9);
  assert.equal(info.size, 45);
  assert.ok(Math.abs(info.topPct - 20) < 1e-9);
  assert.equal(S.subjectRankOf(state, { subjectRanks: {} }, 'math'), null);
});

/* ---------------- 线性拟合预测 ---------------- */

test('连续三场稳定上涨时按斜率预测下一场', () => {
  const p = S.pace(stateWithTotals([500, 520, 540]));
  assert.ok(Math.abs(p.slope - 20) < 1e-9);
  assert.ok(Math.abs(p.predict - 560) < 1e-9);
  /* 每场要 33 分才能到 640，20 分不算赶上 */
  assert.equal(p.onTrack, false);
});

test('预测不会超过满分，也不会低于零', () => {
  const high = S.pace(stateWithTotals([700, 720, 740]));
  assert.equal(high.predict, 750);

  const low = S.pace(stateWithTotals([400, 300, 200]));
  assert.ok(low.predict >= 0);
});

test('不足三场时不给预测', () => {
  assert.equal(S.pace(stateWithTotals([500, 520])).predict, null);
  assert.equal(S.pace(stateWithTotals([])), null);
});

test('预测区间夹在合理范围内', () => {
  const p = S.pace(stateWithTotals([500, 520, 540]));
  assert.ok(p.low <= p.predict);
  assert.ok(p.high >= p.predict);
  assert.ok(p.low >= 0);
});

/* ---------------- 学期归属 ---------------- */

test('按 9 月划分学年，1 月算上学期', () => {
  const state = S.defaultState();
  assert.equal(S.semesterOf(state, '2025-09-26').label, '高一上');
  assert.equal(S.semesterOf(state, '2026-01-15').label, '高一上');
  assert.equal(S.semesterOf(state, '2026-03-06').label, '高一下');
  assert.equal(S.semesterOf(state, '2026-09-11').label, '高二上');
  assert.equal(S.semesterOf(state, '2027-02-01').label, '高二下');
});

test('同一学期的考试归到一组', () => {
  const state = S.defaultState();
  state.filter = 'all';
  const groups = S.groupBySemester(state);
  assert.ok(groups.length > 1);
  assert.equal(groups[0].label, '高一上');
});

/* ---------------- 日期解析 ---------------- */

test('横线、斜杠、中文和 Excel 序列号都认', () => {
  assert.equal(S.normalizeDate('2026-11-05'), '2026-11-05');
  assert.equal(S.normalizeDate('2026/11/5'), '2026-11-05');
  assert.equal(S.normalizeDate('2026年11月5日'), '2026-11-05');
  assert.match(S.normalizeDate(46329), /^2026-11-\d{2}$/);
});

test('空值和读不懂的文本返回 null', () => {
  assert.equal(S.normalizeDate(''), null);
  assert.equal(S.normalizeDate(null), null);
  assert.equal(S.normalizeDate('不是日期'), null);
});

/* ---------------- CSV ---------------- */

test('CSV 解析认引号、逗号和转义引号', () => {
  const rows = S.parseCSV('a,b\r\n"x,y",z\r\n"他说 ""好""",w');
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x,y', 'z'],
    ['他说 "好"', 'w']
  ]);
});

test('导出再导入，记录不丢也不串', () => {
  const state = S.defaultState();
  state.filter = 'all';
  const rows = S.parseCSV(S.toCSV(state));
  const back = S.tableToExams(state, rows);

  assert.equal(back.exams.length, state.exams.length);
  assert.equal(back.exams[0].date, state.exams[0].date);
  assert.equal(back.exams[0].name, state.exams[0].name);
  assert.equal(back.exams[0].scores.math, state.exams[0].scores.math);
  assert.equal(back.exams[0].subjectRanks.math, state.exams[0].subjectRanks.math);
});

test('缺日期列的表格直接报错', () => {
  const state = S.defaultState();
  const result = S.tableToExams(state, [['考试名称', '语文'], ['没有日期', 100]]);
  assert.equal(result.exams.length, 0);
  assert.match(result.errors[0], /日期/);
});

/* ---------------- 排序与检查 ---------------- */

test('补差顺序按缺口占满分的比例排', () => {
  const state = S.defaultState();
  state.filter = 'all';
  const rows = S.priority(state, state.exams[state.exams.length - 1]);
  assert.equal(rows.length, 6);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i - 1].gapRate >= rows[i].gapRate);
  }
});

test('数据检查能发现超满分和名次越界', () => {
  const state = S.defaultState();
  state.filter = 'all';
  state.exams.push({
    id: 'bad', name: '坏数据', date: '2026-12-01', type: '月考',
    scores: { math: 999 }, ranks: { class: 99 }, averages: {}
  });
  const issues = S.audit(state);
  assert.ok(issues.some((i) => /超过满分/.test(i.text)));
  assert.ok(issues.some((i) => /超过班级人数/.test(i.text)));
});

/* ---------------- 存储 ---------------- */

test('保存之后能原样读回来', () => {
  const state = S.defaultState();
  state.exams = [];
  state.sample = false;
  assert.equal(S.save(state), true);

  const back = S.load();
  assert.equal(back.exams.length, 0);
  assert.equal(back.sample, false);
});

test('第一次打开没有存档时给示例数据并落盘', () => {
  const state = S.load();
  assert.equal(state.exams.length, 15);
  assert.ok(ls.map.has(S.STORAGE_KEY));
});

test('存储写满时保存返回 false 并说明原因', () => {
  ls.failNext = true;
  assert.equal(S.save(S.defaultState()), false);
  assert.match(S.storage.reason, /存储空间满了/);
});

test('浏览器禁止存储时保存返回 false', () => {
  S.storage.available = false;
  assert.equal(S.save(S.defaultState()), false);
  assert.match(S.storage.reason, /不让这个页面保存/);
});

test('存档读不出来时原样留底，不被覆盖', () => {
  const broken = '{"exams": [坏掉的';
  ls.map.set(S.STORAGE_KEY, broken);

  const state = S.load();
  assert.equal(S.storage.broken.raw, broken);
  assert.equal(ls.map.get(S.BROKEN_KEY), broken);
  assert.equal(S.readBroken(), broken);
  assert.ok(state.exams.length > 0);
});

test('留底可以丢弃', () => {
  ls.map.set(S.STORAGE_KEY, '破');
  S.load();
  assert.equal(S.brokenExists(), true);
  assert.equal(S.discardBroken(), true);
  assert.equal(S.brokenExists(), false);
});

test('占用体积按内容算出来', () => {
  S.save(S.defaultState());
  assert.ok(S.footprint() > 0);
});

/* ---------------- 其余计算不抛错 ---------------- */

test('总览用到的各项计算都能跑通', () => {
  const state = S.defaultState();
  state.filter = 'all';
  const last = state.exams[state.exams.length - 1];

  assert.ok(S.insight(state));
  assert.ok(S.typeStats(state).length > 0);
  assert.ok(S.typeFacets(state).length > 0);
  assert.ok(S.examVsPeers(state, last));
  assert.ok(S.subjectSpread(state, last));
  assert.ok(S.contribution(state, last));
  assert.ok(S.distribution(state));
  assert.ok(S.sensitivity(state, 'math', 10));
  assert.ok(S.termForecast(state));
  assert.ok(S.spreadHistory(state));
  assert.ok(S.goalCheck(state));
  assert.ok(S.movers(state));
  assert.ok(S.smoothMovers(state));
  assert.ok(S.changeSince(state, last));
  assert.ok(S.subjectStats(state, 'math'));
  assert.ok(S.semesterBands(state));
});

/* ---------------- 审查发现的问题 ---------------- */

test('筛选状态下导出 CSV 仍然带全部记录', () => {
  const state = S.defaultState();
  state.filter = '期中';
  assert.ok(S.sorted(state).length < S.allSorted(state).length);

  const rows = S.parseCSV(S.toCSV(state));
  assert.equal(rows.length, S.allSorted(state).length + 1);
});

test('上一场没填名次时不给凭空的进退', () => {
  const state = S.defaultState();
  state.filter = 'all';
  state.exams = [
    { id: 'a', name: '第一场', date: '2026-03-01', type: '月考', scores: { math: 100 }, ranks: {}, averages: {} },
    { id: 'b', name: '第二场', date: '2026-04-01', type: '月考', scores: { math: 110 }, ranks: { grade: 88, class: 10 }, averages: {} }
  ];
  const diff = S.changeSince(state, state.exams[1]);
  assert.equal(diff.gradeRank, null);
  assert.equal(diff.classRank, null);
  assert.equal(diff.total, 10);
});

test('只有一场考试时不说与上次持平', () => {
  const state = stateWithTotals([520]);
  const ins = S.insight(state);
  assert.equal(ins.totalState, null);
});

test('名次估算把分差减去均值再外推', () => {
  const state = S.defaultState();
  state.filter = 'all';
  const make = (id, date, total, avg, rank) => {
    const per = total / state.config.subjects.length;
    const scores = {};
    state.config.subjects.forEach((s) => { scores[s.id] = per; });
    return { id, name: id, date, type: '月考', scores, ranks: { grade: rank }, averages: { class: avg } };
  };
  state.exams = [
    make('a', '2026-03-01', 500, 450, 200),
    make('b', '2026-04-01', 520, 450, 180),
    make('c', '2026-05-01', 540, 450, 160)
  ];
  /* 分差 50→70→90 对应名次 200→180→160，斜率 -1，多 4 分就该进 4 名 */
  const r = S.sensitivity(state, 'math', 4);
  assert.equal(r.rankBefore, 160);
  assert.equal(r.rankAfter, 156);
  assert.equal(r.rankDelta, 4);
});

test('CSV 里的「缺考」不当成 0 分', () => {
  const state = S.defaultState();
  const rows = S.parseCSV('考试名称,日期,语文,数学\n测试,2026-03-01,缺考,120');
  const out = S.tableToExams(state, rows);
  assert.equal(out.exams.length, 1);
  assert.equal(out.exams[0].scores.chinese, undefined);
  assert.equal(out.exams[0].scores.math, 120);
});

test('不存在的月份和日期被拒', () => {
  assert.equal(S.normalizeDate('2026-13-01'), null);
  assert.equal(S.normalizeDate('2026-02-30'), null);
  assert.equal(S.normalizeDate('2026-00-10'), null);
  assert.equal(S.normalizeDate('2026-02-28'), '2026-02-28');
});

test('负数名次会被数据检查抓到', () => {
  const state = S.defaultState();
  state.filter = 'all';
  state.exams.push({
    id: 'neg', name: '负数名次', date: '2026-12-02', type: '月考',
    scores: { math: 100 }, ranks: { class: -3, grade: -5 }, averages: {}
  });
  const issues = S.audit(state);
  assert.ok(issues.some((i) => /班级排名是负数/.test(i.text)));
  assert.ok(issues.some((i) => /年级排名是负数/.test(i.text)));
});

test('同名同日的多场按顺序对上，不会全指到最后一条', () => {
  const state = S.defaultState();
  state.filter = 'all';
  state.exams = [
    { id: 'c', name: '重复', date: '2026-05-01', type: '月考', scores: { math: 80 }, ranks: {}, averages: {} },
    { id: 'd', name: '重复', date: '2026-05-01', type: '月考', scores: { math: 90 }, ranks: {}, averages: {} }
  ];
  const incoming = [
    { name: '重复', date: '2026-05-01', type: '月考', scores: { math: 85 }, ranks: {}, averages: {} },
    { name: '重复', date: '2026-05-01', type: '月考', scores: { math: 95 }, ranks: {}, averages: {} }
  ];
  const r = S.mergeExams(state, incoming);
  assert.equal(r.replaced, 2);
  assert.equal(state.exams[0].scores.math, 85);
  assert.equal(state.exams[1].scores.math, 95);
});

test('只导入同名记录的第一行时只改第一条', () => {
  const state = S.defaultState();
  state.filter = 'all';
  state.exams = [
    { id: 'c', name: '重复', date: '2026-05-01', type: '月考', scores: { math: 80 }, ranks: {}, averages: {} },
    { id: 'd', name: '重复', date: '2026-05-01', type: '月考', scores: { math: 90 }, ranks: {}, averages: {} }
  ];
  S.mergeExams(state, [
    { name: '重复', date: '2026-05-01', type: '月考', scores: { math: 85 }, ranks: {}, averages: {} }
  ]);
  assert.equal(state.exams[0].scores.math, 85);
  assert.equal(state.exams[1].scores.math, 90);
});

test('数据检查不受筛选影响', () => {
  const state = S.defaultState();
  state.filter = '期中';
  state.exams.push({
    id: 'bad2', name: '筛选外的坏数据', date: '2026-12-05', type: '期末',
    scores: { math: 999 }, ranks: {}, averages: {}
  });
  const issues = S.audit(state);
  assert.ok(issues.some((i) => /超过满分/.test(i.text)));
});

/* ---------------- 导入数据的安全性 ---------------- */

const EVIL = 'x"><img src=x onerror="alert(1)">';

test('备份里的 id 带标签会被换掉，不会拼进属性', () => {
  const state = S.normalize({
    config: { subjects: [{ id: EVIL, name: '数学', full: 150, target: 120 }] },
    exams: [{ id: EVIL, name: '考试', date: '2026-03-01', type: '月考', scores: {} }]
  });
  assert.doesNotMatch(state.exams[0].id, /["'<>\s]/);
  assert.doesNotMatch(state.config.subjects[0].id, /["'<>\s]/);
  assert.notEqual(state.exams[0].id, EVIL);
});

test('备份里的数值字段写成标签会被挡回默认值', () => {
  const state = S.normalize({
    config: {
      gradeSize: EVIL,
      classSize: EVIL,
      targetTotal: EVIL,
      subjects: [{ id: 'math', name: '数学', full: EVIL, target: EVIL }]
    },
    exams: [{
      id: 'e1', name: '考试', date: '2026-03-01', type: '月考',
      scores: { math: EVIL }, ranks: { grade: EVIL }, averages: { class: EVIL }
    }]
  });
  assert.equal(state.config.gradeSize, 620);
  assert.equal(state.config.classSize, 45);
  assert.equal(state.config.targetTotal, 640);
  assert.equal(typeof state.config.subjects[0].full, 'number');
  assert.equal(state.config.subjects[0].full, 100);
  assert.equal(state.exams[0].scores.math, undefined);
  assert.equal(state.exams[0].ranks.grade, undefined);
  assert.equal(state.exams[0].averages.class, undefined);
});

test('未知的配置键不会被合并进来', () => {
  const state = S.normalize({
    config: { someExtraKey: 'x', __proto__: { polluted: true } }
  });
  assert.equal(state.config.someExtraKey, undefined);
  assert.equal({}.polluted, undefined);
});

test('备份里的日期不合法时整条跳过', () => {
  const state = S.normalize({
    exams: [
      { id: 'a', name: '坏日期', date: '2026-13-01', type: '月考', scores: {} },
      { id: 'b', name: '好日期', date: '2026-03-01', type: '月考', scores: {} }
    ]
  });
  assert.equal(state.exams.length, 1);
  assert.equal(state.exams[0].name, '好日期');
});

test('同名 id 的重复记录会被分开', () => {
  const state = S.normalize({
    exams: [
      { id: 'same', name: 'A', date: '2026-03-01', type: '月考', scores: {} },
      { id: 'same', name: 'B', date: '2026-04-01', type: '月考', scores: {} }
    ]
  });
  assert.notEqual(state.exams[0].id, state.exams[1].id);
});

test('导出 CSV 时公式开头的名字会被标成文本', () => {
  const state = S.defaultState();
  state.filter = 'all';
  state.exams = [{
    id: 'f', name: '=HYPERLINK("http://x")', date: '2026-03-01', type: '月考',
    scores: { math: 100 }, ranks: {}, averages: {}
  }];
  const csv = S.toCSV(state);
  assert.ok(csv.indexOf("'=HYPERLINK") >= 0);
});

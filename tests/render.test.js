'use strict';

/* 视图层的冒烟测试：在最小的 DOM 桩上加载四个脚本，确认每个页面都能生成 HTML */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ls = {
  map: new Map(),
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; },
  setItem(key, value) { this.map.set(key, String(value)); },
  removeItem(key) { this.map.delete(key); }
};

function fakeNode() {
  const node = {
    style: { setProperty() {}, removeProperty() {}, getPropertyValue() { return ''; } },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {},
    children: [],
    innerHTML: '',
    textContent: '',
    offsetWidth: 800,
    offsetHeight: 600,
    clientWidth: 800,
    clientHeight: 600,
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    hasAttribute() { return false; },
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) { node.children.push(child); return child; },
    insertBefore(child) { return child; },
    removeChild() {},
    remove() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {},
    click() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }; }
  };
  return node;
}

global.window = {
  localStorage: ls,
  matchMedia() { return { matches: false, addEventListener() {} }; },
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1280,
  innerHeight: 800,
  scrollY: 0,
  scrollTo() {},
  location: { hash: '' },
  history: { replaceState() {} },
  requestAnimationFrame(fn) { fn(0); return 1; },
  cancelAnimationFrame() {},
  getComputedStyle() { return { getPropertyValue() { return '#000000'; } }; }
};

global.requestAnimationFrame = global.window.requestAnimationFrame;
global.cancelAnimationFrame = global.window.cancelAnimationFrame;
global.getComputedStyle = global.window.getComputedStyle;
global.document = {
  querySelector() { return null; },
  querySelectorAll() { return []; },
  getElementById() { return null; },
  addEventListener() {},
  removeEventListener() {},
  createElement() { return fakeNode(); },
  createElementNS() { return fakeNode(); },
  documentElement: fakeNode(),
  body: fakeNode(),
  head: fakeNode()
};

require(path.join(__dirname, '..', 'assets', 'store.js'));
require(path.join(__dirname, '..', 'assets', 'ui.js'));
require(path.join(__dirname, '..', 'assets', 'charts.js'));
require(path.join(__dirname, '..', 'assets', 'views.js'));

const S = global.window.Store;
const V = global.window.Views;
const C = global.window.Charts;

function freshState() {
  const state = S.defaultState();
  state.filter = 'all';
  return state;
}

function assertClean(html, where) {
  assert.equal(typeof html, 'string', where + ' 应当返回字符串');
  assert.ok(html.length > 0, where + ' 不应为空');
  assert.ok(!html.includes('undefined'), where + ' 不应出现 undefined');
  assert.ok(!html.includes('NaN'), where + ' 不应出现 NaN');
}

/* ---------------- 工具函数 ---------------- */

test('转义、补零、日期转换都走同一套实现', () => {
  assert.equal(S.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(S.pad2(7), '07');
  assert.equal(S.toISO(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(S.toISO(S.parseISO('2026-11-05')), '2026-11-05');
  assert.equal(S.parseISO('2026-13-01'), null);
  assert.equal(S.cnDate('2026-11-05'), '2026 年 11 月 5 日');
  assert.equal(S.cnDate(''), '—');
  assert.equal(S.cnDate('', '选择日期'), '选择日期');
});

test('符号与百分数格式化只有一份', () => {
  assert.equal(S.signed(12), '+12');
  assert.equal(S.signed(-12), '−12');
  assert.equal(S.signed(0), '0');
  assert.equal(S.signed(-1.25, 1), '−1.3');
  assert.equal(S.signed(null), '—');
  assert.equal(S.pctText(0.812, 1), '81.2%');
  assert.equal(S.pctText(0, 0), '0%');
});

test('日期取值与新窗口取值一致', () => {
  assert.equal(S.monthOf('2026-11-05'), 11);
  assert.equal(S.dateTs('2026-11-05'), new Date('2026-11-05T00:00:00').getTime());
});

test('线性拟合只有一份实现', () => {
  assert.equal(S.indexSlope([10, 20, 30]), 10);
  assert.equal(S.indexSlope([30, 20, 10]), -10);
  assert.equal(S.indexSlope([5]), 0);
  assert.equal(S.indexSlope([]), 0);
  assert.equal(S.indexSlope([7, 7, 7]), 0);
  assert.equal(S.slopeOf([0, 1, 2], [0, 2, 4]), 2);
  assert.equal(S.slopeOf([1], [5]), 0);
});

test('上一场查找统一到一个函数', () => {
  const state = freshState();
  const list = S.sorted(state);
  assert.equal(S.prevExamOf(list, list[0]), null);
  assert.equal(S.prevExamOf(list, list[1]).id, list[0].id);
  assert.equal(S.prevExamOf(list, { id: '不存在' }), null);
});

test('导出表头由科目列表生成', () => {
  const state = freshState();
  const head = S.examHeader(state.config.subjects);
  assert.equal(head[0], '考试名称');
  assert.equal(head.length, 3 + state.config.subjects.length * 3 + 5);
  assert.ok(head.includes('语文'));
  assert.ok(head.includes('语文名次'));
  assert.ok(head.includes('语文平均'));
  assert.ok(head.includes('年级最高'));
});

test('主题与配色的读写集中到数据层', () => {
  ls.map.clear();
  assert.equal(S.themeMode(), 'auto');
  assert.equal(S.paletteName(), 'classic');
  assert.equal(S.themeToggleOn(), true);

  S.writeKey(S.THEME_KEY, 'dark');
  S.writeKey(S.PALETTE_KEY, 'ink');
  S.writeKey(S.THEME_TOGGLE_KEY, 'off');
  assert.equal(S.themeMode(), 'dark');
  assert.equal(S.paletteName(), 'ink');
  assert.equal(S.themeToggleOn(), false);

  S.writeKey(S.THEME_KEY, '乱写的值');
  assert.equal(S.themeMode(), 'auto');
});

/* ---------------- 视图输出 ---------------- */

test('五个页面都能生成干净的 HTML', () => {
  const state = freshState();
  state.filter = 'all';
  const last = S.sorted(state).slice(-1)[0];

  assertClean(V.overview(state), '总览');
  assertClean(V.subjects(state, state.config.subjects[0].id), '单科分析');
  assertClean(V.compare(state, null, null), '两次对比');
  assertClean(V.exams(state), '考试记录');
  assertClean(V.settings(state, 'goal'), '设置');
  assertClean(V.detail(state, last.id), '考试详情');
  assertClean(V.sidebar(state, 'overview'), '侧栏');
});

test('设置页每个分区都能生成', () => {
  const state = freshState();
  ['goal', 'subjects', 'types', 'appearance', 'data', 'storage'].forEach((sec) => {
    assertClean(V.settingsPanel(state, sec), '设置分区 ' + sec);
  });
});

test('录入表单在新建和修改两种情况下都能生成', () => {
  const state = freshState();
  const exam = state.exams[0];
  assertClean(V.examForm(state, null), '新建表单');
  assertClean(V.examForm(state, exam), '修改表单');
});

test('每一科都能在表单里标缺考', () => {
  const state = freshState();
  const form = V.examForm(state, null);
  assert.equal((form.match(/data-absent="/g) || []).length, state.config.subjects.length);
  assert.ok(form.includes('缺考'));
});

test('缺考的那一科在详情页写成缺考，没填的仍然是横线', () => {
  const state = freshState();
  state.exams = [{
    id: 'a', name: '甲', date: '2026-03-01', type: '月考',
    scores: { math: 100 }, ranks: {}, averages: {}, absent: ['chinese']
  }];
  const html = V.detail(state, 'a');
  assertClean(html, '缺考详情');
  assert.ok(html.includes(S.ABSENT_TEXT), '缺考的科目要写缺考');
  assert.equal((html.match(/缺考/g) || []).length, 1);
});

test('单科拆件返回的每一块都能用', () => {
  const state = freshState();
  const parts = V.subjectParts(state, state.config.subjects[0]);
  ['kpi', 'kpiItems', 'chartCard', 'sideCard', 'sideBody', 'tableCard', 'tableRows', 'points', 'bands']
    .forEach((key) => { assert.ok(parts[key] !== undefined, '缺少 ' + key); });
  assert.ok(parts.points.length > 0);
  assertClean(parts.tableRows, '单科表格');
});

test('没有记录时各页面给空状态而不是报错', () => {
  const state = freshState();
  state.exams = [];
  state.filter = 'all';
  assertClean(V.overview(state), '空状态总览');
  assertClean(V.subjects(state, state.config.subjects[0].id), '空状态单科');
  assertClean(V.compare(state, null, null), '空状态对比');
  assertClean(V.exams(state), '空状态记录');
  assert.ok(V.detail(state, '不存在') .includes('没有这次考试'));
});

test('科目增减之后列表与表单跟着变', () => {
  const state = freshState();
  state.config.subjects = state.config.subjects.slice(0, 3);
  state.config.subjects.push({ id: 'history', name: '历史', full: 100, target: 80 });
  const html = V.exams(state);
  assertClean(html, '四科记录页');
  const form = V.examForm(state, null);
  assert.ok(form.includes('历史'), '表单要出现新增的科目');
  assert.ok(!form.includes('生物'), '已经删掉的科目不该出现');
});

test('类型被清空后页面照样能出', () => {
  const state = freshState();
  state.config.types = [];
  assertClean(V.exams(state), '无类型记录页');
  assertClean(V.examForm(state, null), '无类型表单');
});

test('配色缩略图不带内联颜色值', () => {
  const state = freshState();
  const html = V.settingsPanel(state, 'appearance');
  assertClean(html, '外观设置');
  assert.ok(!/#[0-9a-fA-F]{6}/.test(html), '缩略图不应写死十六进制颜色');
});

test('设置页的输入控件都带 data-cfg 和上下限', () => {
  const state = freshState();
  const html = V.settingsPanel(state, 'goal');
  const cfgs = html.match(/data-cfg="[^"]+"/g) || [];
  assert.equal(cfgs.length, 10, '设置项应有 10 个');

  /* 数字控件必须带上限，应用层不再另外维护一份范围 */
  const numbers = html.match(/<input[^>]*data-cfg="[^"]+"[^>]*type="number"[^>]*>/g) || [];
  assert.ok(numbers.length >= 9, '数字控件数量不对');
  numbers.forEach((tag) => {
    assert.ok(/max="\d+"/.test(tag), '缺少 max：' + tag);
    assert.ok(/min="\d+"/.test(tag), '缺少 min：' + tag);
  });
});

/* ---------------- 图表纯函数 ---------------- */

test('图表刻度是整齐的数字', () => {
  const scale = C.niceScale(52, 96, 4);
  assert.ok(scale.ticks.length >= 3);
  assert.equal(scale.lo % scale.step, 0);
  assert.ok(scale.hi >= 96);
});

/* 首次使用的产品导览 */
(function (global) {
  'use strict';

  var KEY = 'scorebook.tour.v1';

  var STEPS = [
    {
      sel: '.side',
      title: '五个页面都在这儿',
      text: '总览看最近一次和历次走势，单科分析看一科自己的起伏，两次对比挑两场并排看，考试记录按学期和类型列出来，设置里改目标、管类型和导入导出。',
      place: 'right'
    },
    {
      sel: '.verdict',
      title: '每次打开先看这两行',
      text: '上面一句是最近几次的概括：涨了几次、名次动了几名、离目标差多少。下面一行是按当前速度估的下次和学期末能到多少。',
      place: 'bottom'
    },
    {
      sel: '.kpi-strip',
      title: '四个数，各带一句判断',
      text: '总分、年级排名、班级排名、离目标差多少。每格右上角有一句判断，比如「连涨 4 次」「已进前 100」。没填的格子不会占位。',
      place: 'bottom'
    },
    {
      sel: '.card-trend',
      title: '走势与下一次',
      text: '右上角能换成得分率、年级名次或班级名次的曲线。虚线是目标，末端那个空心点按键算出来的速度往后延伸，标着下次大概多少。',
      place: 'bottom'
    },
    {
      sel: '.card-subjects',
      title: '这六科离目标多远',
      text: '横条是这一科这次的得分率，竖线是它的目标。越过竖线就是达标，会变成蓝色。',
      place: 'bottom'
    },
    {
      sel: '.card-analysis',
      title: '和同学比，和自己比',
      text: '填了班级平均之后，这里会说你比班平高多少、离年级最高差多少，并判断这次是题目难还是状态掉了。下半张是偏科程度和最近三场的进退。',
      place: 'top'
    },
    {
      sel: '.card-priority',
      title: '先补哪一科',
      text: '按缺口占满分的比例排。底下那句是一科的杠杆：这一科再多考十分，总分能到多少、年级大约进几名。',
      place: 'top'
    },
    {
      sel: '[data-action="new-exam"]',
      title: '下次考完从这里记',
      text: '填名称、日期和六科分数就行。名次、班级平均、各科名次都在底部的折叠区里，不填也能用。现成的表格能从设置页导进来。',
      place: 'bottom'
    }
  ];

  var root = null;
  var hole = null;
  var tip = null;
  var index = 0;
  var active = false;
  var currentTarget = null;
  var currentStep = null;

  function shouldRun() {
    try {
      return !global.localStorage.getItem(KEY);
    } catch (err) {
      return false;
    }
  }

  function markDone() {
    try {
      global.localStorage.setItem(KEY, '1');
    } catch (err) {
      /* 存不了就算了，下次还会出现 */
    }
  }

  function reset() {
    try {
      global.localStorage.removeItem(KEY);
    } catch (err) {
      /* ignore */
    }
  }

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'tour';
    root.innerHTML =
      '<div class="tour-hole"></div>' +
      '<div class="tour-tip">' +
      '  <span class="tour-count"></span>' +
      '  <h3 class="tour-title"></h3>' +
      '  <p class="tour-text"></p>' +
      '  <div class="tour-actions">' +
      '    <button type="button" class="tour-skip">跳过</button>' +
      '    <span class="tour-spacer"></span>' +
      '    <button type="button" class="tour-btn" data-tour="prev">上一步</button>' +
      '    <button type="button" class="tour-btn is-primary" data-tour="next">下一步</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(root);

    hole = root.querySelector('.tour-hole');
    tip = root.querySelector('.tour-tip');

    root.querySelector('.tour-skip').addEventListener('click', finish);
    root.querySelector('[data-tour="prev"]').addEventListener('click', prev);
    root.querySelector('[data-tour="next"]').addEventListener('click', next);

    root.addEventListener('click', function (evt) {
      if (evt.target === root || evt.target === hole) next();
    });

    document.addEventListener('keydown', onKey);
    global.addEventListener('scroll', onScroll, true);
  }

  function onKey(evt) {
    if (!active) return;
    if (evt.key === 'Escape') { evt.preventDefault(); finish(); }
    else if (evt.key === 'ArrowRight' || evt.key === 'Enter') { evt.preventDefault(); next(); }
    else if (evt.key === 'ArrowLeft') { evt.preventDefault(); prev(); }
  }

  function clearTour() {
    active = false;
    document.removeEventListener('keydown', onKey);
    global.removeEventListener('scroll', onScroll, true);
    currentTarget = null;
    currentStep = null;
    if (root) {
      root.classList.add('is-out');
      var el = root;
      root = null;
      hole = null;
      tip = null;
      setTimeout(function () { el.remove(); }, 220);
    }
  }

  function finish() {
    markDone();
    clearTour();
  }

  function next() {
    if (index >= STEPS.length - 1) { finish(); return; }
    index += 1;
    show();
  }

  function prev() {
    if (index <= 0) return;
    index -= 1;
    show();
  }

  function show() {
    var step = STEPS[index];
    var target = document.querySelector(step.sel);

    if (!target) { next(); return; }

    currentTarget = target;
    currentStep = step;

    var rect = target.getBoundingClientRect();
    var inView = rect.top >= 0 && rect.bottom <= global.innerHeight;
    if (!inView) {
      target.scrollIntoView({ block: 'center', behavior: 'auto' });
      rect = target.getBoundingClientRect();
    }

    paint(rect, step);

    tip.querySelector('.tour-count').textContent = (index + 1) + ' / ' + STEPS.length;
    tip.querySelector('.tour-title').textContent = step.title;
    tip.querySelector('.tour-text').textContent = step.text;

    var prevBtn = tip.querySelector('[data-tour="prev"]');
    var nextBtn = tip.querySelector('[data-tour="next"]');
    prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
    nextBtn.textContent = index === STEPS.length - 1 ? '知道了' : '下一步';

    positionTip(rect, step.place);
  }

  /* 把高亮框和气泡摆到目标身上 */
  function paint(rect, step) {
    var pad = 8;
    hole.style.left = (rect.left - pad) + 'px';
    hole.style.top = (rect.top - pad) + 'px';
    hole.style.width = (rect.width + pad * 2) + 'px';
    hole.style.height = (rect.height + pad * 2) + 'px';
    positionTip(rect, step.place);
  }

  /* 页面滚了就重新贴一次，不然框会留在原地 */
  var scrollRaf = null;
  var stopTimer = null;

  function onScroll() {
    if (!active || !currentTarget) return;
    root.classList.add('is-scrolling');
    clearTimeout(stopTimer);
    stopTimer = setTimeout(function () {
      if (root) root.classList.remove('is-scrolling');
    }, 140);
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = null;
      if (!active || !currentTarget) return;
      paint(currentTarget.getBoundingClientRect(), currentStep);
    });
  }

  function positionTip(rect, prefer) {
    var gap = 16;
    var tw = tip.offsetWidth;
    var th = tip.offsetHeight;
    var vw = global.innerWidth;
    var vh = global.innerHeight;
    var left;
    var top;

    if (prefer === 'right' && rect.right + gap + tw < vw - 16) {
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - th / 2;
    } else if (rect.bottom + gap + th < vh - 16) {
      left = rect.left + rect.width / 2 - tw / 2;
      top = rect.bottom + gap;
    } else if (rect.top - gap - th > 16) {
      left = rect.left + rect.width / 2 - tw / 2;
      top = rect.top - gap - th;
    } else {
      left = rect.left + rect.width / 2 - tw / 2;
      top = rect.bottom + gap;
    }

    left = Math.max(16, Math.min(vw - tw - 16, left));
    top = Math.max(16, Math.min(vh - th - 16, top));

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function start() {
    if (active) return;
    build();
    index = 0;
    active = true;
    root.classList.remove('is-out');
    show();
    requestAnimationFrame(function () {
      root.classList.add('is-in');
    });
  }

  global.addEventListener('resize', function () {
    if (active) clearTour();
  });

  global.Tour = {
    shouldRun: shouldRun,
    start: start,
    stop: finish,
    reset: reset
  };
})(window);

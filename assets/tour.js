/* 首次使用的产品导览 */
(function (global) {
  'use strict';

  var KEY = 'scorebook.tour.v1';

  var STEPS = [
    {
      sel: '.side',
      title: '这里是全部功能',
      text: '总览看最近一次和历次走势，单科分析看一科自己的起伏，两次对比挑两场考试并排看，考试记录按学期列出来。',
      place: 'right'
    },
    {
      sel: '.kpi-strip',
      title: '最近一次考试',
      text: '总分、年级和班级名次、离目标还差多少。哪一项没填，那一格就不出现。',
      place: 'bottom'
    },
    {
      sel: '.card-trend',
      title: '历次走势',
      text: '右上角可以换成得分率、年级名次或班级名次的曲线，虚线是目标。鼠标停在点上能看每一次的分数。',
      place: 'bottom'
    },
    {
      sel: '.card-subjects',
      title: '各科离目标多远',
      text: '横条是这一科这次的得分率，竖线是它的目标。越过竖线就是达标。',
      place: 'bottom'
    },
    {
      sel: '[data-action="new-exam"]',
      title: '下次考完从这里记',
      text: '填名称、日期和六科分数就行，名次可以空着。现成的表格也能从设置页导进来。',
      place: 'bottom'
    }
  ];

  var root = null;
  var hole = null;
  var tip = null;
  var index = 0;
  var active = false;

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

    var rect = target.getBoundingClientRect();
    var inView = rect.top >= 0 && rect.bottom <= global.innerHeight;
    if (!inView) {
      target.scrollIntoView({ block: 'center', behavior: 'auto' });
      rect = target.getBoundingClientRect();
    }

    var pad = 8;
    hole.style.left = (rect.left - pad) + 'px';
    hole.style.top = (rect.top - pad) + 'px';
    hole.style.width = (rect.width + pad * 2) + 'px';
    hole.style.height = (rect.height + pad * 2) + 'px';

    tip.querySelector('.tour-count').textContent = (index + 1) + ' / ' + STEPS.length;
    tip.querySelector('.tour-title').textContent = step.title;
    tip.querySelector('.tour-text').textContent = step.text;

    var prevBtn = tip.querySelector('[data-tour="prev"]');
    var nextBtn = tip.querySelector('[data-tour="next"]');
    prevBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
    nextBtn.textContent = index === STEPS.length - 1 ? '知道了' : '下一步';

    positionTip(rect, step.place);
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

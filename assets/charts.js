/* 图表层：手写 SVG，动效内置 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  /* 缓动：到点即停，起步快收尾慢 */
  var EASE = {
    out: 'cubic-bezier(0.22, 1, 0.36, 1)',
    soft: 'cubic-bezier(0.32, 0.72, 0, 1)',
    back: 'cubic-bezier(0.34, 1.4, 0.64, 1)'
  };

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    return node;
  }

  /* 悬浮提示里会放考试名称和日期，按文本转义再拼 */
  function escText(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function reduced() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function nextFrame(fn) {
    requestAnimationFrame(function () { requestAnimationFrame(fn); });
  }

  /* 整齐的刻度：4 到 6 条 */
  function niceScale(min, max, count) {
    count = count || 4;
    if (max === min) max = min + 1;
    var span = max - min;
    var rough = span / count;
    var mag = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    if (hi <= max) hi += step;
    var ticks = [];
    for (var v = lo; v <= hi + step * 0.001; v += step) {
      ticks.push(Math.round(v * 1000) / 1000);
    }
    return { lo: lo, hi: hi, step: step, ticks: ticks };
  }

  function fmtNumber(value, digits) {
    if (value === null || value === undefined || isNaN(value)) return '—';
    return Number(value).toFixed(digits === undefined ? 0 : digits);
  }

  /* ---------- 数字滚动 ---------- */

  function roll(el, from, to, opts) {
    opts = opts || {};
    var digits = opts.digits === undefined ? 0 : opts.digits;
    var dur = opts.duration === undefined ? 720 : opts.duration;
    var prefix = opts.prefix || '';
    var suffix = opts.suffix || '';
    var sign = opts.sign ? (to > from ? '+' : to < from ? '−' : '') : '';
    var end = sign ? Math.abs(to) : to;
    var start = sign ? Math.abs(from) : from;

    if (reduced() || dur === 0) {
      el.textContent = prefix + sign + fmtNumber(end, digits) + suffix;
      return;
    }
    var t0 = performance.now();
    var tick = function (now) {
      var p = Math.min(1, (now - t0) / dur);
      var eased = 1 - Math.pow(1 - p, 4);
      var v = start + (end - start) * eased;
      el.textContent = prefix + sign + fmtNumber(v, digits) + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = prefix + sign + fmtNumber(end, digits) + suffix;
    };
    requestAnimationFrame(tick);
  }

  /* ---------- 走势图 ---------- */

  function trend(host, opts) {
    var instance = {
      host: host,
      opts: opts || {},
      current: null,
      set: set,
      data: null
    };

    function set(points, o) {
      o = Object.assign({}, instance.opts, o || {});
      var prev = instance.current;
      var nextCount = (points || []).filter(function (p) {
        return p.value !== null && p.value !== undefined && !isNaN(p.value);
      }).length;
      var canMorph = !!(prev && prev.coords && prev.coords.length === nextCount && nextCount > 0 && !reduced() && o.animate !== false);
      var buildOpts = Object.assign({}, o, { animate: o.animate !== false && !canMorph });
      var built = build(points, buildOpts);
      instance.current = built;
      instance.data = points;
      instance.opts = o;
      if (built && prev && canMorph) morph(built, prev);
      return built;
    }

    function build(rawPoints, o) {
      var points = (rawPoints || []).filter(function (p) {
        return p.value !== null && p.value !== undefined && !isNaN(p.value);
      });
      host.innerHTML = '';
      host.classList.add('chart-host');

      if (!points.length) {
        var empty = document.createElement('div');
        empty.className = 'chart-empty';
        empty.textContent = o.emptyText || '还没有成绩记录';
        host.appendChild(empty);
        return null;
      }

      var W = Math.max(240, host.clientWidth || 640);
      var H = o.height || 300;
      var showBands = !!(o.bands && o.bands.length > 1 && o.xMode === 'time');
      var pad = { t: showBands ? 40 : 26, r: o.padRight === undefined ? 46 : o.padRight, b: 30, l: o.padLeft || 42 };
      var plotW = W - pad.l - pad.r;
      var plotH = H - pad.t - pad.b;

      var values = points.map(function (p) { return p.value; });
      var dataMin = Math.min.apply(null, values);
      var dataMax = Math.max.apply(null, values);
      var rawSpan = Math.max(dataMax - dataMin, o.minPad || 8);
      var padV = rawSpan * 0.16;
      var lo0 = dataMin - padV;
      var hi0 = dataMax + padV;
      if (o.target) {
        var tPad = Math.max(4, rawSpan * 0.03);
        lo0 = Math.min(lo0, o.target - tPad);
        hi0 = Math.max(hi0, o.target + tPad);
      }
      /* 预测值也要落在刻度里，不然点会飘出去 */
      if (o.forecast && typeof o.forecast.value === 'number') {
        var fPad = rawSpan * 0.06;
        lo0 = Math.min(lo0, o.forecast.value - fPad);
        hi0 = Math.max(hi0, o.forecast.value + fPad);
      }
      /* 分数、得分率、名次都不是负数，底端不低于 0 */
      if (o.floor !== false) {
        lo0 = Math.max(o.floor === undefined ? 0 : o.floor, lo0);
        hi0 = Math.max(hi0, lo0 + 1);
      }
      var scale = niceScale(lo0, hi0, o.ticks || 5);

      var useTime = o.xMode === 'time' && points.every(function (p) { return typeof p.ts === 'number'; });
      var tsMin = useTime ? Math.min.apply(null, points.map(function (p) { return p.ts; })) : 0;
      var tsMax = useTime ? Math.max.apply(null, points.map(function (p) { return p.ts; })) : 0;

      /* 给预测点留出右侧一段空位 */
      var hasForecast = !!(o.forecast && typeof o.forecast.value === 'number');
      var xSpan = useTime ? (tsMax - tsMin) : Math.max(points.length - 1, 1);
      var lead = hasForecast ? xSpan * 0.16 : 0;

      var x = function (i) {
        if (useTime && tsMax > tsMin) {
          return pad.l + ((points[i].ts - tsMin) / (xSpan + lead)) * plotW;
        }
        return pad.l + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
      };
      var y = function (v) {
        var p = (v - scale.lo) / (scale.hi - scale.lo);
        return o.invert ? pad.t + p * plotH : pad.t + plotH - p * plotH;
      };

      var tsToX = function (ts) {
        if (!useTime || tsMax <= tsMin) return pad.l;
        return pad.l + ((ts - tsMin) / (xSpan + lead)) * plotW;
      };

      var svg = el('svg', {
        class: 'chart',
        viewBox: '0 0 ' + W + ' ' + H,
        width: '100%',
        height: H,
        'aria-label': o.label || '走势图',
        role: 'img'
      });

      /* 学期分段：一条竖虚线，顶上一个学期名 */
      var gBands = null;
      if (showBands) {
        gBands = el('g', { class: 'chart-bands' });
        o.bands.forEach(function (b) {
          var sx = tsToX(b.startTs);
          var ex = tsToX(b.endTs);
          if (ex < pad.l - 4 || sx > W - pad.r + 4) return;
          if (b.dividerTs) {
            var dx = tsToX(b.dividerTs);
            if (dx > pad.l + 8 && dx < W - pad.r - 8) {
              gBands.appendChild(el('line', {
                x1: dx, x2: dx, y1: pad.t - 10, y2: pad.t + plotH, class: 'band-divider'
              }));
            }
          }
          var mid = (Math.max(sx, pad.l) + Math.min(ex, W - pad.r)) / 2;
          var label = el('text', { x: mid, y: 16, class: 'band-label', 'text-anchor': 'middle' });
          label.textContent = b.label;
          gBands.appendChild(label);
        });
      }

      var gGrid = el('g', { class: 'chart-grid' });
      var gPlot = el('g', { class: 'chart-plot' });
      var gMarks = el('g', { class: 'chart-marks' });
      var gTarget = el('g', { class: 'chart-target' });

      scale.ticks.forEach(function (v) {
        var yy = y(v);
        gGrid.appendChild(el('line', {
          x1: pad.l, x2: W - pad.r, y1: yy, y2: yy,
          class: v === 0 ? 'grid-base' : 'grid-line'
        }));
        var label = el('text', { x: pad.l - 10, y: yy + 3.5, class: 'axis-y', 'text-anchor': 'end' });
        label.textContent = fmtNumber(v, o.yDigits || 0);
        gGrid.appendChild(label);
      });

      if (o.target) {
        var ty = y(o.target);
        gTarget.appendChild(el('line', { x1: pad.l, x2: W - pad.r, y1: ty, y2: ty, class: 'target-line' }));
        var tlabel = el('text', { x: W - pad.r, y: ty - 7, class: 'target-label', 'text-anchor': 'end' });
        tlabel.textContent = (o.targetLabel || '目标') + ' ' + fmtNumber(o.target, o.digits || 0);
        gTarget.appendChild(tlabel);
      }

      var coords = points.map(function (p, i) { return [x(i), y(p.value)]; });
      var d = coords.map(function (c, i) { return (i ? 'L' : 'M') + c[0].toFixed(2) + ' ' + c[1].toFixed(2); }).join(' ');
      var baseY = o.invert ? pad.t : pad.t + plotH;
      var areaD = d + ' L' + coords[coords.length - 1][0].toFixed(2) + ' ' + baseY + ' L' + coords[0][0].toFixed(2) + ' ' + baseY + ' Z';

      var showArea = o.area !== false;
      var area = showArea ? el('path', { d: areaD, class: 'chart-area' }) : null;
      var line = el('path', { d: d, class: 'chart-line' });
      if (area) gPlot.appendChild(area);
      gPlot.appendChild(line);

      var gHi = null;
      if (typeof o.highlightIndex === 'number' && coords[o.highlightIndex]) {
        var hc = coords[o.highlightIndex];
        gHi = el('g', { class: 'chart-hi' });
        gHi.appendChild(el('line', { x1: hc[0], x2: hc[0], y1: pad.t + 6, y2: pad.t + plotH, class: 'hl-line' }));
        gHi.appendChild(el('circle', { cx: hc[0], cy: hc[1], r: 8, class: 'hl-ring' }));
      }

      var dots = coords.map(function (c, i) {
        var dot = el('circle', { cx: c[0], cy: c[1], r: points.length > 14 ? 2.6 : 3.2, class: 'chart-dot' });
        dot.style.setProperty('--i', i);
        gMarks.appendChild(dot);
        return dot;
      });

      var lastIndex = coords.length - 1;
      var lastDot = el('circle', { cx: coords[lastIndex][0], cy: coords[lastIndex][1], r: 4.6, class: 'chart-dot-last' });
      gMarks.appendChild(lastDot);

      /* 往右延伸一段虚线，落一个空心点，标出下次大概多少 */
      var forecastMark = null;
      if (hasForecast) {
        var fx0 = coords[lastIndex][0];
        var fy0 = coords[lastIndex][1];
        var fx1 = pad.l + plotW - 6;
        var fy1 = y(o.forecast.value);
        var gForecast = el('g', { class: 'chart-forecast' });
        gForecast.appendChild(el('line', {
          x1: fx0, y1: fy0, x2: fx1, y2: fy1,
          class: 'forecast-line'
        }));
        forecastMark = el('circle', { cx: fx1, cy: fy1, r: 4, class: 'forecast-dot' });
        gForecast.appendChild(forecastMark);
        if (o.forecast.label) {
          var lb = el('text', {
            x: fx1, y: fy1 + 17,
            'text-anchor': 'end',
            class: 'forecast-label'
          });
          lb.textContent = o.forecast.label;
          gForecast.appendChild(lb);
        }
        gMarks.appendChild(gForecast);
      }

      var gAxis = el('g', { class: 'chart-axis' });
      var minGap = W < 520 ? 56 : 68;
      var chosen = [];
      points.forEach(function (p, i) {
        if (!chosen.length || x(i) - x(chosen[chosen.length - 1]) >= minGap) chosen.push(i);
      });
      if (chosen.length && chosen[chosen.length - 1] !== lastIndex) {
        if (chosen.length > 1 && x(lastIndex) - x(chosen[chosen.length - 1]) < minGap * 0.72) chosen.pop();
        chosen.push(lastIndex);
      }
      chosen.forEach(function (i) {
        var label = el('text', {
          x: x(i), y: H - 10, class: 'axis-x',
          'text-anchor': points.length === 1 ? 'middle' : i === 0 ? 'start' : i === lastIndex ? 'end' : 'middle'
        });
        label.textContent = points[i].label;
        gAxis.appendChild(label);
      });

      if (o.annotateLast === true) {
        var lastVal = points[lastIndex].value;
        var lx = coords[lastIndex][0];
        var ly = coords[lastIndex][1];
        var anchorEnd = lx > W - pad.r - 24;
        var tagText = el('text', {
          x: anchorEnd ? lx - 11 : lx + 11,
          y: o.invert ? ly + 16 : ly - 11,
          class: 'tag-value',
          'text-anchor': anchorEnd ? 'end' : 'start'
        });
        tagText.textContent = fmtNumber(lastVal, o.digits || 0) + (o.unit || '');
        gMarks.appendChild(tagText);
      }

      if (o.target && o.showGap !== false) {
        var gap = points[lastIndex].value - o.target;
        var gy1 = coords[lastIndex][1];
        var gy2 = y(o.target);
        if (Math.abs(gy2 - gy1) > 12) {
          var gx = coords[lastIndex][0];
          var brace = el('g', { class: 'chart-gap' });
          brace.appendChild(el('line', { x1: gx, x2: gx, y1: gy1 - 5, y2: gy2 + 5, class: 'gap-line' }));
          brace.appendChild(el('line', { x1: gx - 3.5, x2: gx + 3.5, y1: gy1, y2: gy1, class: 'gap-tick' }));
          brace.appendChild(el('line', { x1: gx - 3.5, x2: gx + 3.5, y1: gy2, y2: gy2, class: 'gap-tick' }));
          var gtext = el('text', { x: gx - 8, y: (gy1 + gy2) / 2 + 4, class: 'gap-label', 'text-anchor': 'end' });
          gtext.textContent = (gap > 0 ? '+' : '−') + fmtNumber(Math.abs(gap), o.digits || 0);
          brace.appendChild(gtext);
          gTarget.appendChild(brace);
        }
      }

      svg.appendChild(gGrid);
      svg.appendChild(gTarget);
      if (gHi) svg.appendChild(gHi);
      svg.appendChild(gPlot);
      svg.appendChild(gAxis);
      svg.appendChild(gMarks);
      if (gBands) svg.insertBefore(gBands, svg.firstChild);
      host.appendChild(svg);

      /* 入场 */
      if (!reduced() && o.animate !== false) {
        var len = line.getTotalLength();
        line.style.strokeDasharray = len + ' ' + len;
        line.style.strokeDashoffset = len;
        if (area) area.style.opacity = '0';
        gGrid.style.opacity = '0';
        gTarget.style.opacity = '0';
        dots.forEach(function (dt) { dt.style.opacity = '0'; });
        lastDot.style.opacity = '0';

        nextFrame(function () {
          gGrid.style.transition = 'opacity 420ms ' + EASE.soft;
          gGrid.style.opacity = '1';
          line.style.transition = 'stroke-dashoffset 1250ms ' + EASE.out;
          line.style.strokeDashoffset = '0';
          if (area) {
            area.style.transition = 'opacity 900ms ' + EASE.soft + ' 260ms';
            area.style.opacity = '1';
          }
          gTarget.style.transition = 'opacity 520ms ' + EASE.soft + ' 480ms';
          gTarget.style.opacity = '1';
          dots.forEach(function (dt, i) {
            dt.style.transition = 'opacity 340ms ' + EASE.soft + ' ' + (340 + i * 62) + 'ms';
            dt.style.opacity = '1';
          });
          lastDot.style.transition = 'opacity 360ms ' + EASE.soft + ' ' + (380 + points.length * 62) + 'ms';
          lastDot.style.opacity = '1';
        });
      }

      /* 悬停 */
      var hoverLine = el('line', { class: 'hover-line', x1: 0, x2: 0, y1: pad.t, y2: pad.t + plotH });
      var hoverDot = el('circle', { class: 'hover-dot', r: 5 });
      svg.appendChild(hoverLine);
      svg.appendChild(hoverDot);

      var tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.setAttribute('role', 'status');
      host.appendChild(tip);

      function hide() {
        hoverLine.style.opacity = '0';
        hoverDot.style.opacity = '0';
        tip.classList.remove('is-on');
      }
      hide();

      function move(evt) {
        var rect = svg.getBoundingClientRect();
        var px = (evt.clientX - rect.left) * (W / rect.width);
        var nearest = 0, best = Infinity;
        coords.forEach(function (c, i) {
          var dx = Math.abs(c[0] - px);
          if (dx < best) { best = dx; nearest = i; }
        });
        var c = coords[nearest];
        hoverLine.style.transform = 'translateX(' + c[0].toFixed(1) + 'px)';
        hoverLine.style.opacity = '1';
        hoverDot.style.transform = 'translate(' + c[0].toFixed(1) + 'px, ' + c[1].toFixed(1) + 'px)';
        hoverDot.style.opacity = '1';

        var p = points[nearest];
        if (nearest !== move._last) {
          move._last = nearest;
          tip.innerHTML = '<span class="tip-date">' + escText(p.full) + '</span><span class="tip-value">' +
            fmtNumber(p.value, o.digits || 0) + (o.unit || '') + '</span>' +
            (p.sub ? '<span class="tip-sub">' + escText(p.sub) + '</span>' : '');
          tip.classList.remove('is-updated');
          void tip.offsetWidth;
          tip.classList.add('is-updated');
        }
        var left = (c[0] / W) * host.clientWidth;
        tip.classList.add('is-on');
        var tw = tip.offsetWidth;
        tip.style.setProperty('--tx', Math.max(4, Math.min(left - tw / 2, host.clientWidth - tw - 4)).toFixed(1) + 'px');
        tip.style.setProperty('--ty', (c[1] - 12).toFixed(1) + 'px');
      }

      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerleave', hide);

      return {
        svg: svg,
        coords: coords,
        scale: scale,
        line: line,
        area: area,
        areaBaseY: baseY,
        dots: dots,
        lastDot: lastDot,
        forecastDot: forecastMark,
        targetLine: gTarget,
        yFunc: y,
        pad: pad
      };
    }

    /* 指标切换：曲线从旧形状过渡到新形状 */
    function morph(built, prev) {
      var from = prev.coords;
      var to = built.coords;
      var n = to.length;
      var dur = 700;
      var area = built.area;
      var line = built.line;

      line.style.strokeDasharray = '';
      line.style.strokeDashoffset = '';
      if (area) area.style.opacity = '1';

      var pathFrom = from.map(function (c, i) { return (i ? 'L' : 'M') + c[0].toFixed(2) + ' ' + c[1].toFixed(2); }).join(' ');
      line.setAttribute('d', pathFrom);

      built.dots.forEach(function (dt, i) { dt.setAttribute('cx', from[i][0]); dt.setAttribute('cy', from[i][1]); });
      built.lastDot.setAttribute('cx', from[n - 1][0]);
      built.lastDot.setAttribute('cy', from[n - 1][1]);

      var areaBase = built.areaBaseY;
      var t0 = performance.now();
      function frame(now) {
        var p = Math.min(1, (now - t0) / dur);
        var e = 1 - Math.pow(1 - p, 3);
        var seg = [];
        for (var i = 0; i < n; i++) {
          var fx = from[i][0] + (to[i][0] - from[i][0]) * e;
          var fy = from[i][1] + (to[i][1] - from[i][1]) * e;
          seg.push((i ? 'L' : 'M') + fx.toFixed(2) + ' ' + fy.toFixed(2));
          built.dots[i].setAttribute('cx', fx);
          built.dots[i].setAttribute('cy', fy);
        }
        line.setAttribute('d', seg.join(' '));
        built.lastDot.setAttribute('cx', to[n - 1][0]);
        built.lastDot.setAttribute('cy', to[n - 1][1]);
        if (area && areaBase !== undefined) {
          area.setAttribute('d', seg.join(' ') +
            ' L' + to[n - 1][0].toFixed(2) + ' ' + areaBase +
            ' L' + to[0][0].toFixed(2) + ' ' + areaBase + ' Z');
        }
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);

      /* 刻度换一套：数字从左侧滑进来，网格线淡入 */
      var grid = built.svg.querySelector('.chart-grid');
      var target = built.svg.querySelector('.chart-target');
      if (grid) {
        var texts = Array.prototype.slice.call(grid.querySelectorAll('text'));
        texts.forEach(function (t) {
          t.style.opacity = '0';
          t.style.transform = 'translateX(-6px)';
        });
        grid.style.opacity = '0';
        requestAnimationFrame(function () {
          grid.style.transition = 'opacity 240ms linear';
          grid.style.opacity = '1';
          texts.forEach(function (t, i) {
            t.style.transition = 'opacity 240ms linear ' + (i * 36) + 'ms, transform 320ms cubic-bezier(0.22, 1, 0.36, 1) ' + (i * 36) + 'ms';
            t.style.opacity = '1';
            t.style.transform = 'none';
          });
        });
      }
      if (target) {
        target.style.opacity = '0';
        target.style.transition = 'opacity 300ms linear 180ms';
        requestAnimationFrame(function () { target.style.opacity = '1'; });
      }
    }

    if (opts && opts.points) set(opts.points, opts);
    return instance;
  }

  /* ---------- 雷达图 ---------- */

  function radar(host, opts) {
    host.innerHTML = '';
    var labels = opts.labels || [];
    var layers = opts.layers || [];
    var n = labels.length;
    if (!n) {
      host.innerHTML = '<div class="chart-empty">还没有数据</div>';
      return;
    }
    var size = opts.size || 300;
    var pad = 44;
    var R = size / 2 - pad;
    var cx = size / 2;
    var cy = size / 2;

    function pt(i, ratio) {
      var angle = -Math.PI / 2 + (Math.PI * 2 * i) / n;
      return [cx + Math.cos(angle) * R * ratio, cy + Math.sin(angle) * R * ratio];
    }

    var svg = el('svg', {
      class: 'radar',
      viewBox: '0 0 ' + size + ' ' + size,
      width: '100%',
      height: size,
      role: 'img',
      'aria-label': opts.label || '各科得分率雷达图'
    });

    /* 网格环 */
    var gGrid = el('g', { class: 'radar-grid' });
    [0.25, 0.5, 0.75, 1].forEach(function (r) {
      var d = [];
      for (var i = 0; i < n; i++) {
        var p = pt(i, r);
        d.push((i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2));
      }
      gGrid.appendChild(el('path', { d: d.join(' ') + ' Z', class: r === 1 ? 'radar-ring is-outer' : 'radar-ring' }));
    });
    for (var i = 0; i < n; i++) {
      var e = pt(i, 1);
      gGrid.appendChild(el('line', { x1: cx, y1: cy, x2: e[0], y2: e[1], class: 'radar-spoke' }));
    }
    svg.appendChild(gGrid);

    /* 层 */
    var layerEls = [];
    layers.forEach(function (layer) {
      var d = [];
      for (var i = 0; i < n; i++) {
        var v = Math.max(0, Math.min(1, layer.values[i] || 0));
        var p = pt(i, v);
        d.push((i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2));
      }
      var path = el('path', {
        d: d.join(' ') + ' Z',
        class: 'radar-shape ' + (layer.style === 'dash' ? 'is-target' : 'is-now')
      });
      path.style.transformOrigin = cx + 'px ' + cy + 'px';
      svg.appendChild(path);
      layerEls.push(path);
    });

    /* 标签 */
    var gLabels = el('g', { class: 'radar-labels' });
    labels.forEach(function (label, i) {
      var p = pt(i, 1.16);
      var anchor = Math.abs(p[0] - cx) < 6 ? 'middle' : p[0] > cx ? 'start' : 'end';
      var t = el('text', {
        x: p[0], y: p[1], class: 'radar-label', 'text-anchor': anchor, 'dominant-baseline': 'middle'
      });
      t.textContent = label;
      gLabels.appendChild(t);
    });
    svg.appendChild(gLabels);
    host.appendChild(svg);

    if (!reduced() && opts.animate !== false) {
      layerEls.forEach(function (path, idx) {
        path.style.transform = 'scale(0.02)';
        path.style.opacity = '0';
        requestAnimationFrame(function () {
          path.style.transition = 'transform 720ms ' + EASE.out + ' ' + (idx * 90) + 'ms, opacity 420ms linear ' + (idx * 90) + 'ms';
          path.style.transform = 'scale(1)';
          path.style.opacity = '1';
        });
      });
    }
  }

  /* ---------- 目标对照条 ---------- */

  function bullets(host, opts) {
    var rows = opts.rows || [];
    host.innerHTML = '';
    if (!rows.length) {
      host.innerHTML = '<div class="chart-empty">' + (opts.emptyText || '还没有数据') + '</div>';
      return;
    }
    var list = document.createElement('div');
    list.className = 'bullets';

    rows.forEach(function (row) {
      var item = document.createElement('div');
      item.className = 'bullet-row';

      var name = document.createElement('span');
      name.className = 'bullet-name';
      name.textContent = row.label;

      var track = document.createElement('div');
      track.className = 'bullet-track';
      var fill = document.createElement('div');
      fill.className = 'bullet-fill' + (row.hit ? ' is-hit' : '');
      fill.style.width = '0%';
      fill.setAttribute('data-w', (row.rate * 100).toFixed(2) + '%');
      track.appendChild(fill);
      if (row.targetRate) {
        var tick = document.createElement('div');
        tick.className = 'bullet-tick';
        tick.style.left = (row.targetRate * 100).toFixed(2) + '%';
        track.appendChild(tick);
      }

      var value = document.createElement('span');
      value.className = 'bullet-value num';
      value.textContent = row.valueText;

      var note = document.createElement('span');
      note.className = 'bullet-note num' + (row.hit ? ' is-hit' : '');
      note.textContent = row.note || '';

      item.appendChild(name);
      item.appendChild(track);
      item.appendChild(value);
      item.appendChild(note);
      list.appendChild(item);
    });

    host.appendChild(list);

    if (!reduced() && opts.animate !== false) {
      nextFrame(function () {
        list.querySelectorAll('.bullet-fill').forEach(function (fill, i) {
          fill.style.transition = 'width 1000ms ' + EASE.out + ' ' + (i * 80) + 'ms';
          fill.style.width = fill.getAttribute('data-w');
        });
      });
    } else {
      list.querySelectorAll('.bullet-fill').forEach(function (fill) {
        fill.style.width = fill.getAttribute('data-w');
      });
    }
  }

  /* ---------- 极简迷你走势 ---------- */

  function spark(host, values, opts) {
    opts = opts || {};
    host.innerHTML = '';
    var vals = values.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });
    if (vals.length < 2) {
      var dash = document.createElement('span');
      dash.className = 'spark-empty';
      dash.textContent = '—';
      host.appendChild(dash);
      return;
    }
    var W = 72, H = 22, p = 3;
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = max - min || 1;
    var pts = vals.map(function (v, i) {
      return [
        p + ((W - p * 2) * i) / (vals.length - 1),
        H - p - ((v - min) / span) * (H - p * 2)
      ];
    });
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'spark', width: W, height: H, 'aria-hidden': 'true' });
    svg.appendChild(el('path', {
      d: pts.map(function (c, i) { return (i ? 'L' : 'M') + c[0].toFixed(1) + ' ' + c[1].toFixed(1); }).join(' '),
      class: 'spark-line'
    }));
    var last = pts[pts.length - 1];
    svg.appendChild(el('circle', { cx: last[0], cy: last[1], r: 2, class: 'spark-dot' }));
    host.appendChild(svg);
  }

  global.Charts = {
    EASE: EASE,
    el: el,
    reduced: reduced,
    roll: roll,
    trend: trend,
    radar: radar,
    bullets: bullets,
    spark: spark,
    niceScale: niceScale
  };
})(window);

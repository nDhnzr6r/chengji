/* 图表层：手写 SVG，动效内置 */
(function (global) {
  'use strict';

  var S = global.Store;

  var NS = 'http://www.w3.org/2000/svg';

  /* 图表的固定尺寸集中在这里 */
  var LAYOUT = {
    height: 300,
    minWidth: 240,
    padLeft: 42,
    padRight: 46,
    padTop: 26,
    padTopBanded: 40,
    padBottom: 30,
    padBottomTwoLine: 44,
    axisGap: 10,
    axisGapTwoLine: 26,
    minPad: 8,
    /* 上下留白与预测留位的比例 */
    edgeRatio: 0.16,
    targetRatio: 0.03,
    forecastRatio: 0.06,
    /* 宽度低于这个值时按窄屏处理 */
    compactWidth: 520
  };

  /* 缓动：与样式里的五条曲线对应 */
  var EASE = {
    out: 'cubic-bezier(0.22, 1, 0.36, 1)',
    soft: 'cubic-bezier(0.32, 0.72, 0, 1)',
    land: 'cubic-bezier(0.34, 1.4, 0.64, 1)'
  };

  /* 时间线：全部毫秒，起点相对图表自己的起跑时刻 */
  var TIME = {
    grid: 0,
    line: 50,
    area: 200,
    target: 250,
    dots: 350,
    dotStep: 30,
    last: 550,
    forecast: 650,
    forecastDot: 750,
    forecastLabel: 800,
    dur: {
      grid: 300,
      line: 700,
      area: 500,
      target: 300,
      label: 250,
      dot: 250,
      morph: 600,
      radar: 800,
      radarStep: 100,
      bar: 600,
      barStep: 50
    }
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

  function reduced() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function nextFrame(fn) {
    requestAnimationFrame(function () {
      requestAnimationFrame(fn);
    });
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
    var dur = opts.duration === undefined ? 400 : opts.duration;
    var delay = opts.delay || 0;
    var prefix = opts.prefix || '';
    var suffix = opts.suffix || '';
    var sign = opts.sign ? (to > from ? '+' : to < from ? '−' : '') : '';
    var end = sign ? Math.abs(to) : to;

    /* 同一个数字上的新滚动取消旧的，从当前显示的值接着走 */
    if (el._roll) {
      clearTimeout(el._roll.timer);
      cancelAnimationFrame(el._roll.raf);
      if (from === undefined) from = el._roll.value;
      el._roll = null;
    }
    if (from === undefined) from = 0;
    var start = sign ? Math.abs(from) : from;

    var write = function (v) {
      el.textContent = prefix + sign + fmtNumber(v, digits) + suffix;
    };

    if (reduced() || dur === 0) {
      write(end);
      return;
    }

    write(start);
    var state = { timer: null, raf: 0, value: start };
    el._roll = state;

    var run = function () {
      var t0 = performance.now();
      var tick = function (now) {
        var p = Math.min(1, (now - t0) / dur);
        var eased = 1 - Math.pow(1 - p, 4);
        var v = start + (end - start) * eased;
        state.value = v;
        write(v);
        if (p < 1) state.raf = requestAnimationFrame(tick);
        else {
          state.value = end;
          write(end);
          el._roll = null;
        }
      };
      state.raf = requestAnimationFrame(tick);
    };

    if (delay) state.timer = setTimeout(run, delay);
    else run();
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
      var canMorph = !!(
        prev &&
        prev.coords &&
        prev.coords.length === nextCount &&
        nextCount > 0 &&
        !reduced() &&
        o.animate !== false
      );
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
      host.replaceChildren();
      host.classList.add('chart-host');

      if (!points.length) {
        var empty = document.createElement('div');
        empty.className = 'chart-empty';
        empty.textContent = o.emptyText || '还没有成绩记录';
        host.appendChild(empty);
        return null;
      }

      var W = Math.max(LAYOUT.minWidth, host.clientWidth || 640);
      var H = o.height || LAYOUT.height;
      var showBands = !!(o.bands && o.bands.length > 1 && o.xMode === 'time');
      /* 只有明确要求时才把横轴写成两行，别的图 sub 是给悬浮提示用的 */
      var twoLine =
        !!o.stackAxis &&
        points.some(function (p) {
          return p.sub;
        });
      var pad = {
        t: showBands ? LAYOUT.padTopBanded : LAYOUT.padTop,
        r: o.padRight === undefined ? LAYOUT.padRight : o.padRight,
        b: twoLine ? LAYOUT.padBottomTwoLine : LAYOUT.padBottom,
        l: o.padLeft || LAYOUT.padLeft
      };
      var plotW = W - pad.l - pad.r;
      var plotH = H - pad.t - pad.b;

      var values = points.map(function (p) {
        return p.value;
      });
      var dataMin = Math.min.apply(null, values);
      var dataMax = Math.max.apply(null, values);
      var rawSpan = Math.max(dataMax - dataMin, o.minPad || LAYOUT.minPad);
      var padV = rawSpan * LAYOUT.edgeRatio;
      var lo0 = dataMin - padV;
      var hi0 = dataMax + padV;
      if (o.target) {
        var tPad = Math.max(4, rawSpan * LAYOUT.targetRatio);
        lo0 = Math.min(lo0, o.target - tPad);
        hi0 = Math.max(hi0, o.target + tPad);
      }
      /* 预测值也要落在刻度里，不然点会飘出去 */
      if (o.forecast && typeof o.forecast.value === 'number') {
        var fPad = rawSpan * LAYOUT.forecastRatio;
        lo0 = Math.min(lo0, o.forecast.value - fPad);
        hi0 = Math.max(hi0, o.forecast.value + fPad);
      }
      /* 分数、得分率、名次都不是负数，底端不低于 0 */
      if (o.floor !== false) {
        lo0 = Math.max(o.floor === undefined ? 0 : o.floor, lo0);
        hi0 = Math.max(hi0, lo0 + 1);
      }
      var scale = niceScale(lo0, hi0, o.ticks || 5);

      var useTime =
        o.xMode === 'time' &&
        points.every(function (p) {
          return typeof p.ts === 'number';
        });
      var tsMin = useTime
        ? Math.min.apply(
            null,
            points.map(function (p) {
              return p.ts;
            })
          )
        : 0;
      var tsMax = useTime
        ? Math.max.apply(
            null,
            points.map(function (p) {
              return p.ts;
            })
          )
        : 0;

      /* 给预测点留出右侧一段空位 */
      var hasForecast = !!(o.forecast && typeof o.forecast.value === 'number');
      var xSpan = useTime ? tsMax - tsMin : Math.max(points.length - 1, 1);
      var lead = hasForecast ? xSpan * LAYOUT.edgeRatio : 0;

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
              gBands.appendChild(
                el('line', {
                  x1: dx,
                  x2: dx,
                  y1: pad.t - 10,
                  y2: pad.t + plotH,
                  class: 'band-divider'
                })
              );
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
        gGrid.appendChild(
          el('line', {
            x1: pad.l,
            x2: W - pad.r,
            y1: yy,
            y2: yy,
            class: v === 0 ? 'grid-base' : 'grid-line'
          })
        );
        var label = el('text', { x: pad.l - 10, y: yy + 3.5, class: 'axis-y', 'text-anchor': 'end' });
        label.textContent = fmtNumber(v, o.yDigits || 0);
        gGrid.appendChild(label);
      });

      if (o.target) {
        var ty = y(o.target);
        gTarget.appendChild(el('line', { x1: pad.l, x2: W - pad.r, y1: ty, y2: ty, class: 'target-line' }));
        var labelY = ty - 7;
        if (labelY < pad.t + 10) labelY = ty + 14;
        var tlabel = el('text', { x: pad.l + 6, y: labelY, class: 'target-label', 'text-anchor': 'start' });
        tlabel.textContent = (o.targetLabel || '目标') + ' ' + fmtNumber(o.target, o.digits || 0);
        gTarget.appendChild(tlabel);
      }

      var coords = points.map(function (p, i) {
        return [x(i), y(p.value)];
      });
      var d = coords
        .map(function (c, i) {
          return (i ? 'L' : 'M') + c[0].toFixed(2) + ' ' + c[1].toFixed(2);
        })
        .join(' ');
      var baseY = o.invert ? pad.t : pad.t + plotH;
      var areaD =
        d +
        ' L' +
        coords[coords.length - 1][0].toFixed(2) +
        ' ' +
        baseY +
        ' L' +
        coords[0][0].toFixed(2) +
        ' ' +
        baseY +
        ' Z';

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
      var lastDot = el('circle', {
        cx: coords[lastIndex][0],
        cy: coords[lastIndex][1],
        r: 4.6,
        class: 'chart-dot-last'
      });
      gMarks.appendChild(lastDot);

      /* 往右延伸一段虚线，落一个空心点，标出下次大概多少 */
      var forecastMark = null;
      if (hasForecast) {
        var fx0 = coords[lastIndex][0];
        var fy0 = coords[lastIndex][1];
        var fx1 = pad.l + plotW - 6;
        var fy1 = y(o.forecast.value);
        var gForecast = el('g', { class: 'chart-forecast' });
        gForecast.appendChild(
          el('line', {
            x1: fx0,
            y1: fy0,
            x2: fx1,
            y2: fy1,
            class: 'forecast-line'
          })
        );
        forecastMark = el('circle', { cx: fx1, cy: fy1, r: 4, class: 'forecast-dot' });
        gForecast.appendChild(forecastMark);
        if (o.forecast.label) {
          var lb = el('text', {
            x: fx1,
            y: fy1 + 17,
            'text-anchor': 'end',
            class: 'forecast-label'
          });
          lb.textContent = o.forecast.label;
          gForecast.appendChild(lb);
        }
        gMarks.appendChild(gForecast);
      }

      var gAxis = el('g', { class: 'chart-axis' });
      var measure = twoLine
        ? (function () {
            var ctx = document.createElement('canvas').getContext('2d');
            ctx.font = '10px "Geist", "PingFang SC", "Microsoft YaHei", sans-serif';
            return function (t) {
              return ctx.measureText(String(t || '')).width;
            };
          })()
        : null;
      var chosen = [];

      if (twoLine) {
        /* 一行排开，按实际文字宽度留位置，实在挤到放不下的才让掉 */
        var textHalf = function (i) {
          /* 日期那行字号小一点，按实际字号折算 */
          return Math.max(measure(points[i].label), measure(points[i].sub || '') * 0.9) / 2;
        };
        /* 第一个贴左边、最后一个贴右边，这两个不是居中锚点 */
        var leftEdge = function (i) {
          var half = textHalf(i);
          if (i === 0) return x(i);
          if (i === lastIndex) return x(i) - half * 2;
          return x(i) - half;
        };
        var rightEdge = function (i) {
          var half = textHalf(i);
          if (i === 0) return x(i) + half * 2;
          if (i === lastIndex) return x(i);
          return x(i) + half;
        };
        var gap = W < LAYOUT.compactWidth ? 12 : 8;
        var lastRight = -Infinity;
        points.forEach(function (p, i) {
          if (leftEdge(i) >= lastRight + gap) {
            chosen.push(i);
            lastRight = rightEdge(i);
          }
        });
        /* 最后一场总要露出来，和谁挤就把谁让掉 */
        if (chosen.length && chosen[chosen.length - 1] !== lastIndex) {
          while (chosen.length) {
            var prev = chosen[chosen.length - 1];
            if (leftEdge(lastIndex) >= rightEdge(prev) + gap) break;
            chosen.pop();
          }
          chosen.push(lastIndex);
        }
      } else {
        var minGap = W < LAYOUT.compactWidth ? 56 : 68;
        points.forEach(function (p, i) {
          if (!chosen.length || x(i) - x(chosen[chosen.length - 1]) >= minGap) chosen.push(i);
        });
        if (chosen.length && chosen[chosen.length - 1] !== lastIndex) {
          if (chosen.length > 1 && x(lastIndex) - x(chosen[chosen.length - 1]) < minGap * 0.72) chosen.pop();
          chosen.push(lastIndex);
        }
      }
      chosen.forEach(function (i) {
        var anchor = points.length === 1 ? 'middle' : i === 0 ? 'start' : i === lastIndex ? 'end' : 'middle';
        var yBase = twoLine ? H - LAYOUT.axisGapTwoLine : H - LAYOUT.axisGap;
        var label = el('text', {
          x: x(i),
          y: yBase,
          class: 'axis-x' + (twoLine ? ' axis-x-two' : ''),
          'text-anchor': anchor
        });
        if (twoLine) {
          var line1 = el('tspan', { x: x(i) });
          line1.textContent = points[i].label;
          var line2 = el('tspan', { x: x(i), dy: 13, class: 'axis-x-sub' });
          line2.textContent = points[i].sub || '';
          label.appendChild(line1);
          label.appendChild(line2);
        } else {
          label.textContent = points[i].label;
        }
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
        var toTarget = points[lastIndex].value - o.target;
        var gy1 = coords[lastIndex][1];
        var gy2 = y(o.target);
        if (Math.abs(gy2 - gy1) > 12) {
          var gx = coords[lastIndex][0];
          var brace = el('g', { class: 'chart-gap' });
          brace.appendChild(el('line', { x1: gx, x2: gx, y1: gy1 - 5, y2: gy2 + 5, class: 'gap-line' }));
          brace.appendChild(el('line', { x1: gx - 3.5, x2: gx + 3.5, y1: gy1, y2: gy1, class: 'gap-tick' }));
          brace.appendChild(el('line', { x1: gx - 3.5, x2: gx + 3.5, y1: gy2, y2: gy2, class: 'gap-tick' }));
          var gtext = el('text', { x: gx - 8, y: (gy1 + gy2) / 2 + 4, class: 'gap-label', 'text-anchor': 'end' });
          gtext.textContent = (toTarget > 0 ? '+' : '−') + fmtNumber(Math.abs(toTarget), o.digits || 0);
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

      /* 入场：结构先到，数据按自己的节拍生长，注解最后亮起 */
      if (!reduced() && o.animate !== false) {
        var delay = o.delay || 0;
        var len = line.getTotalLength();
        line.style.strokeDasharray = len + ' ' + len;
        line.style.strokeDashoffset = len;
        if (area) area.style.opacity = '0';
        gGrid.style.opacity = '0';
        var targetLines = gTarget.querySelectorAll('.target-line, .gap-line, .gap-tick');
        var targetLabels = gTarget.querySelectorAll('.target-label, .gap-label');
        targetLines.forEach(function (node) {
          node.style.opacity = '0';
        });
        targetLabels.forEach(function (node) {
          node.style.opacity = '0';
          node.style.transform = 'translateY(2px)';
        });
        if (gHi) gHi.style.opacity = '0';
        dots.forEach(function (dt) {
          dt.style.opacity = '0';
        });
        lastDot.style.opacity = '0';
        lastDot.style.transform = 'scale(0.6)';
        var fLine = svg.querySelector('.forecast-line');
        var fLabel = svg.querySelector('.forecast-label');
        if (fLine) fLine.style.opacity = '0';
        if (forecastMark) {
          forecastMark.style.opacity = '0';
          forecastMark.style.transform = 'scale(1.04)';
        }
        if (fLabel) {
          fLabel.style.opacity = '0';
          fLabel.style.transform = 'translateY(2px)';
        }

        nextFrame(function () {
          gGrid.style.transition = 'opacity ' + TIME.dur.grid + 'ms ' + EASE.soft + ' ' + delay + 'ms';
          gGrid.style.opacity = '1';
          line.style.transition =
            'stroke-dashoffset ' + TIME.dur.line + 'ms ' + EASE.out + ' ' + (delay + TIME.line) + 'ms';
          line.style.strokeDashoffset = '0';
          if (area) {
            area.style.transition = 'opacity ' + TIME.dur.area + 'ms ' + EASE.soft + ' ' + (delay + TIME.area) + 'ms';
            area.style.opacity = '1';
          }
          targetLines.forEach(function (node) {
            node.style.transition =
              'opacity ' + TIME.dur.target + 'ms ' + EASE.soft + ' ' + (delay + TIME.target) + 'ms';
            node.style.opacity = '1';
          });
          targetLabels.forEach(function (node) {
            node.style.transition =
              'opacity ' +
              TIME.dur.label +
              'ms ' +
              EASE.out +
              ' ' +
              (delay + TIME.last) +
              'ms, transform ' +
              TIME.dur.label +
              'ms ' +
              EASE.out +
              ' ' +
              (delay + TIME.last) +
              'ms';
            node.style.opacity = '1';
            node.style.transform = 'none';
          });
          if (gHi) {
            gHi.style.transition = 'opacity ' + TIME.dur.label + 'ms ' + EASE.out + ' ' + (delay + TIME.last) + 'ms';
            gHi.style.opacity = '1';
          }
          dots.forEach(function (dt, i) {
            dt.style.transition =
              'opacity ' + TIME.dur.dot + 'ms ' + EASE.soft + ' ' + (delay + TIME.dots + i * TIME.dotStep) + 'ms';
            dt.style.opacity = '1';
          });
          lastDot.style.transition =
            'opacity ' +
            TIME.dur.dot +
            'ms ' +
            EASE.land +
            ' ' +
            (delay + TIME.last) +
            'ms, transform ' +
            TIME.dur.dot +
            'ms ' +
            EASE.land +
            ' ' +
            (delay + TIME.last) +
            'ms';
          lastDot.style.opacity = '1';
          lastDot.style.transform = 'none';
          if (fLine) {
            fLine.style.transition =
              'opacity ' + TIME.dur.target + 'ms ' + EASE.soft + ' ' + (delay + TIME.forecast) + 'ms';
            fLine.style.opacity = '1';
          }
          if (forecastMark) {
            forecastMark.style.transition =
              'opacity ' +
              TIME.dur.dot +
              'ms ' +
              EASE.land +
              ' ' +
              (delay + TIME.forecastDot) +
              'ms, transform ' +
              TIME.dur.dot +
              'ms ' +
              EASE.land +
              ' ' +
              (delay + TIME.forecastDot) +
              'ms';
            forecastMark.style.opacity = '1';
            forecastMark.style.transform = 'none';
          }
          if (fLabel) {
            fLabel.style.transition =
              'opacity ' +
              TIME.dur.label +
              'ms ' +
              EASE.out +
              ' ' +
              (delay + TIME.forecastLabel) +
              'ms, transform ' +
              TIME.dur.label +
              'ms ' +
              EASE.out +
              ' ' +
              (delay + TIME.forecastLabel) +
              'ms';
            fLabel.style.opacity = '1';
            fLabel.style.transform = 'none';
          }
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
        var nearest = 0,
          best = Infinity;
        coords.forEach(function (c, i) {
          var dx = Math.abs(c[0] - px);
          if (dx < best) {
            best = dx;
            nearest = i;
          }
        });
        var c = coords[nearest];
        hoverLine.style.transform = 'translateX(' + c[0].toFixed(1) + 'px)';
        hoverLine.style.opacity = '1';
        hoverDot.style.transform = 'translate(' + c[0].toFixed(1) + 'px, ' + c[1].toFixed(1) + 'px)';
        hoverDot.style.opacity = '1';

        var p = points[nearest];
        if (nearest !== move._last) {
          move._last = nearest;
          tip.innerHTML =
            '<span class="tip-date">' +
            S.esc(p.full) +
            '</span><span class="tip-value">' +
            fmtNumber(p.value, o.digits || 0) +
            (o.unit || '') +
            '</span>' +
            (p.sub ? '<span class="tip-sub">' + S.esc(p.sub) + '</span>' : '');
          tip.classList.remove('is-updated');
          void tip.offsetWidth;
          tip.classList.add('is-updated');
        }
        var left = (c[0] / W) * host.clientWidth;
        tip.classList.add('is-on');
        var tw = tip.offsetWidth;
        tip.style.setProperty(
          '--tx',
          Math.max(4, Math.min(left - tw / 2, host.clientWidth - tw - 4)).toFixed(1) + 'px'
        );
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

    /* 指标切换：曲线从当前位置过渡到新形状，连续切换会接着走 */
    function morph(built, prev) {
      if (built._morph) cancelAnimationFrame(built._morph);
      var from = prev.coords;
      var to = built.coords;
      var n = to.length;
      var dur = TIME.dur.morph;
      var area = built.area;
      var line = built.line;

      line.style.strokeDasharray = '';
      line.style.strokeDashoffset = '';
      if (area) area.style.opacity = '1';

      var pathFrom = from
        .map(function (c, i) {
          return (i ? 'L' : 'M') + c[0].toFixed(2) + ' ' + c[1].toFixed(2);
        })
        .join(' ');
      line.setAttribute('d', pathFrom);

      built.dots.forEach(function (dt, i) {
        dt.setAttribute('cx', from[i][0]);
        dt.setAttribute('cy', from[i][1]);
      });
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
          /* 记住当前插值，下一次切换从这里接上 */
          built.coords[i][0] = fx;
          built.coords[i][1] = fy;
          seg.push((i ? 'L' : 'M') + fx.toFixed(2) + ' ' + fy.toFixed(2));
          built.dots[i].setAttribute('cx', fx);
          built.dots[i].setAttribute('cy', fy);
        }
        line.setAttribute('d', seg.join(' '));
        built.lastDot.setAttribute('cx', to[n - 1][0]);
        built.lastDot.setAttribute('cy', to[n - 1][1]);
        if (area && areaBase !== undefined) {
          area.setAttribute(
            'd',
            seg.join(' ') +
              ' L' +
              to[n - 1][0].toFixed(2) +
              ' ' +
              areaBase +
              ' L' +
              to[0][0].toFixed(2) +
              ' ' +
              areaBase +
              ' Z'
          );
        }
        if (p < 1) built._morph = requestAnimationFrame(frame);
        else built._morph = null;
      }
      built._morph = requestAnimationFrame(frame);

      /* 刻度换一套：旧的先退，新的再进，不跟曲线抢同一时刻 */
      var grid = built.svg.querySelector('.chart-grid');
      if (grid) {
        var texts = Array.prototype.slice.call(grid.querySelectorAll('text'));
        grid.style.opacity = '0';
        texts.forEach(function (t) {
          t.style.opacity = '0';
        });
        requestAnimationFrame(function () {
          grid.style.transition = 'opacity ' + TIME.dur.label + 'ms linear';
          grid.style.opacity = '1';
          texts.forEach(function (t) {
            t.style.transition = 'opacity ' + TIME.dur.label + 'ms ' + EASE.out + ' 180ms';
            t.style.opacity = '1';
          });
        });
      }

      /* 目标线与预测段在曲线走起来之后再亮 */
      var target = built.svg.querySelector('.chart-target');
      var forecast = built.svg.querySelector('.chart-forecast');
      [target, forecast].forEach(function (node) {
        if (!node) return;
        node.style.opacity = '0';
        requestAnimationFrame(function () {
          node.style.transition = 'opacity ' + TIME.dur.target + 'ms ' + EASE.soft + ' 150ms';
          node.style.opacity = '1';
        });
      });
    }

    if (opts && opts.points) set(opts.points, opts);
    return instance;
  }

  /* ---------- 雷达图 ---------- */

  function radar(host, opts) {
    host.replaceChildren();
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
        x: p[0],
        y: p[1],
        class: 'radar-label',
        'text-anchor': anchor,
        'dominant-baseline': 'middle'
      });
      t.textContent = label;
      gLabels.appendChild(t);
    });
    svg.appendChild(gLabels);
    host.appendChild(svg);

    if (!reduced() && opts.animate !== false) {
      if (opts.from) {
        /* 换一组数据：两层各自从旧形状长到新形状 */
        layerEls.forEach(function (path, idx) {
          var fromVals = opts.from[idx] || [];
          var start = [];
          for (var i = 0; i < n; i++) {
            var p0 = pt(i, Math.max(0, Math.min(1, fromVals[i] || 0)));
            start.push([p0[0], p0[1]]);
          }
          var target = [];
          for (var j = 0; j < n; j++) {
            var p1 = pt(j, Math.max(0, Math.min(1, layers[idx].values[j] || 0)));
            target.push([p1[0], p1[1]]);
          }
          var t0 = performance.now();
          var frame = function (now) {
            var p = Math.min(1, (now - t0) / TIME.dur.line);
            var e = 1 - Math.pow(1 - p, 3);
            var seg = [];
            for (var k = 0; k < n; k++) {
              var x = start[k][0] + (target[k][0] - start[k][0]) * e;
              var y = start[k][1] + (target[k][1] - start[k][1]) * e;
              seg.push((k ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2));
            }
            path.setAttribute('d', seg.join(' ') + ' Z');
            if (p < 1) requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
        return;
      }
      layerEls.forEach(function (path, idx) {
        path.style.transform = 'scale(0.02)';
        path.style.opacity = '0';
        requestAnimationFrame(function () {
          path.style.transition =
            'transform ' +
            TIME.dur.radar +
            'ms ' +
            EASE.out +
            ' ' +
            idx * TIME.dur.radarStep +
            'ms, opacity ' +
            TIME.dur.target +
            'ms linear ' +
            idx * TIME.dur.radarStep +
            'ms';
          path.style.transform = 'scale(1)';
          path.style.opacity = '1';
        });
      });
    }
  }

  /* ---------- 目标对照条 ---------- */

  function bullets(host, opts) {
    var rows = opts.rows || [];
    host.replaceChildren();
    if (!rows.length) {
      host.innerHTML = '<div class="chart-empty">' + (opts.emptyText || '还没有数据') + '</div>';
      return;
    }
    var list = document.createElement('div');
    list.className = 'bullets';

    rows.forEach(function (row, index) {
      var item = document.createElement('div');
      item.className = 'bullet-row';

      var name = document.createElement('span');
      name.className = 'bullet-name';
      name.textContent = row.label;

      var track = document.createElement('div');
      track.className = 'bullet-track';
      var fill = document.createElement('div');
      fill.className = 'bullet-fill' + (row.hit ? ' is-hit' : '');
      var fromRate = opts.from && opts.from[index] !== undefined ? opts.from[index] : 0;
      fill.style.transform = 'scaleX(' + fromRate + ')';
      fill.setAttribute('data-w', Math.max(0, Math.min(1, row.rate)).toFixed(4));
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
          fill.style.transition = 'transform ' + TIME.dur.bar + 'ms ' + EASE.out + ' ' + i * TIME.dur.barStep + 'ms';
          fill.style.transform = 'scaleX(' + fill.getAttribute('data-w') + ')';
        });
      });
    } else {
      list.querySelectorAll('.bullet-fill').forEach(function (fill) {
        fill.style.transform = 'scaleX(' + fill.getAttribute('data-w') + ')';
      });
    }
  }

  global.Charts = {
    COMPACT_WIDTH: LAYOUT.compactWidth,
    reduced: reduced,
    roll: roll,
    trend: trend,
    radar: radar,
    bullets: bullets,
    niceScale: niceScale
  };
})(window);

/* 自建控件：下拉选择与日期选择 */
(function (global) {
  'use strict';

  var S = global.Store;

  var CLOSE_OUT = 180;
  var ENTER_IN = 250;

  function reduceMotion() {
    return !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function closeAll(except) {
    document.querySelectorAll('.sel.is-open, .datep.is-open').forEach(function (node) {
      if (node === except) return;
      if (node.classList.contains('sel')) closeSelect(node, true);
      else closeDate(node, true);
    });
  }

  /* ---------------- 下拉选择 ---------------- */

  function setSelect(root, value, silent) {
    var options = root.querySelectorAll('.sel-opt');
    var found = null;
    options.forEach(function (opt) {
      var on = opt.getAttribute('data-value') === value;
      opt.classList.toggle('is-on', on);
      opt.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) found = opt;
    });
    if (!found && options.length) {
      found = options[0];
      found.classList.add('is-on');
    }
    root.setAttribute('data-value', found ? found.getAttribute('data-value') : '');
    var text = root.querySelector('.sel-text');
    if (text && found) text.textContent = found.getAttribute('data-label') || found.textContent.trim();
    if (!silent) {
      root.dispatchEvent(
        new CustomEvent('selchange', {
          bubbles: true,
          detail: { value: root.getAttribute('data-value') }
        })
      );
    }
  }

  function openSelect(root) {
    closeAll(root);
    var pop = root.querySelector('.sel-pop');
    if (!pop) return;
    if (root._closeTimer) {
      clearTimeout(root._closeTimer);
      root._closeTimer = 0;
    }
    root.classList.remove('is-closing');
    root.classList.add('is-open');
    pop.hidden = false;
    pop.querySelectorAll('.sel-opt').forEach(function (opt, i) {
      opt.style.setProperty('--i', i);
    });
    root.querySelector('.sel-btn').setAttribute('aria-expanded', 'true');
    var on = pop.querySelector('.sel-opt.is-on');
    if (on) on.focus();
  }

  function closeSelect(root, silent) {
    var pop = root.querySelector('.sel-pop');
    if (root._closeTimer) clearTimeout(root._closeTimer);
    root.classList.remove('is-open');
    if (pop && !reduceMotion()) {
      pop.hidden = false;
      root.classList.add('is-closing');
      root._closeTimer = setTimeout(function () {
        pop.hidden = true;
        root.classList.remove('is-closing');
        root._closeTimer = 0;
      }, CLOSE_OUT);
    } else if (pop) {
      pop.hidden = true;
      root.classList.remove('is-closing');
    }
    var btn = root.querySelector('.sel-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      if (!silent) btn.focus();
    }
  }

  function initSelect(root) {
    var btn = root.querySelector('.sel-btn');
    var pop = root.querySelector('.sel-pop');
    if (!btn || !pop) return;

    btn.addEventListener('click', function (evt) {
      evt.stopPropagation();
      if (root.classList.contains('is-open')) closeSelect(root);
      else openSelect(root);
    });

    pop.addEventListener('click', function (evt) {
      var opt = evt.target.closest('.sel-opt');
      if (!opt) return;
      setSelect(root, opt.getAttribute('data-value'));
      closeSelect(root);
    });

    root.addEventListener('keydown', function (evt) {
      var opts = Array.prototype.slice.call(pop.querySelectorAll('.sel-opt'));
      var idx = opts.indexOf(document.activeElement);
      if (evt.key === 'ArrowDown') {
        evt.preventDefault();
        if (!root.classList.contains('is-open')) {
          openSelect(root);
          return;
        }
        opts[Math.min(opts.length - 1, idx + 1)].focus();
      } else if (evt.key === 'ArrowUp') {
        evt.preventDefault();
        if (!root.classList.contains('is-open')) {
          openSelect(root);
          return;
        }
        opts[Math.max(0, idx - 1)].focus();
      } else if (evt.key === 'Enter' || evt.key === ' ') {
        if (root.classList.contains('is-open') && idx >= 0) {
          evt.preventDefault();
          setSelect(root, opts[idx].getAttribute('data-value'));
          closeSelect(root);
        }
      } else if (evt.key === 'Escape') {
        if (root.classList.contains('is-open')) {
          evt.preventDefault();
          /* 收下拉就到此为止，别把整张录入表单一起关掉 */
          evt.stopPropagation();
          closeSelect(root);
        }
      }
    });

    var initial = root.getAttribute('data-value') || '';
    if (initial) setSelect(root, initial, true);
  }

  /* ---------------- 日期选择 ---------------- */

  function calPop(root) {
    return root._pop || root.querySelector('.cal-pop');
  }

  function calEl(root, sel) {
    var pop = calPop(root);
    return pop ? pop.querySelector(sel) : null;
  }

  function calState(root) {
    if (!root._cal) root._cal = { view: 'day', date: new Date() };
    return root._cal;
  }

  function calTitleText(st) {
    if (st.view === 'day') return st.date.getFullYear() + ' 年 ' + (st.date.getMonth() + 1) + ' 月';
    if (st.view === 'month') return st.date.getFullYear() + ' 年';
    var start = Math.floor(st.date.getFullYear() / 12) * 12;
    return start + ' – ' + (start + 11);
  }

  function paintCal(root, st) {
    ['day', 'month', 'year'].forEach(function (k) {
      var p = calEl(root, '[data-panel="' + k + '"]');
      if (p) p.hidden = k !== st.view;
    });
    if (st.view === 'day') renderDays(root, st.date);
    else if (st.view === 'month') renderMonths(root, st.date);
    else renderYears(root, Math.floor(st.date.getFullYear() / 12) * 12, st.date);
  }

  function crossTitle(root, text) {
    var title = calEl(root, '.cal-title');
    if (!title) return;
    title.textContent = text;
    title.classList.remove('is-swapping');
    void title.offsetWidth;
    title.classList.add('is-swapping');
  }

  /* 翻页与换视图：旧面板先走，新面板再进；同面板则先退后进 */
  function renderCal(root, animate, dir) {
    var st = calState(root);
    var target = calEl(root, '[data-panel="' + st.view + '"]');
    var text = calTitleText(st);

    if (!animate || reduceMotion() || !target) {
      paintCal(root, st);
      var title = calEl(root, '.cal-title');
      if (title) title.textContent = text;
      return;
    }

    var shown = [];
    ['day', 'month', 'year'].forEach(function (k) {
      var panel = calEl(root, '[data-panel="' + k + '"]');
      if (panel && !panel.hidden) shown.push(panel);
    });
    var same = shown.length === 1 && shown[0] === target;
    var dirValue = dir === -1 ? -1 : 1;
    crossTitle(root, text);

    if (same) {
      target.style.setProperty('--dir', dirValue);
      target.classList.remove('is-entering');
      target.classList.add('is-leaving');
      setTimeout(function () {
        target.classList.remove('is-leaving');
        paintCal(root, st);
        target.classList.add('is-entering');
        setTimeout(function () {
          target.classList.remove('is-entering');
        }, ENTER_IN);
      }, CLOSE_OUT);
      return;
    }

    var leaving = shown.filter(function (p) {
      return p !== target;
    });
    leaving.forEach(function (p) {
      p.style.setProperty('--dir', dirValue);
      p.classList.add('is-leaving');
    });
    setTimeout(function () {
      leaving.forEach(function (p) {
        p.classList.remove('is-leaving');
      });
      paintCal(root, st);
      target.style.setProperty('--dir', dirValue);
      target.classList.add('is-entering');
      setTimeout(function () {
        target.classList.remove('is-entering');
      }, ENTER_IN);
    }, CLOSE_OUT);
  }

  function renderDays(root, viewDate) {
    var selected = S.parseISO(root.getAttribute('data-value'));
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var grid = calEl(root, '.cal-grid');
    grid.replaceChildren();

    var first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    var startOffset = (first.getDay() + 6) % 7; /* 周一开头 */
    var daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    var prevDays = new Date(viewDate.getFullYear(), viewDate.getMonth(), 0).getDate();

    var cells = [];
    for (var i = startOffset - 1; i >= 0; i--) {
      cells.push({
        day: prevDays - i,
        outside: true,
        date: new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, prevDays - i)
      });
    }
    for (var d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, outside: false, date: new Date(viewDate.getFullYear(), viewDate.getMonth(), d) });
    }
    var tail = (7 - (cells.length % 7)) % 7;
    for (var t = 1; t <= tail; t++) {
      cells.push({ day: t, outside: true, date: new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, t) });
    }

    cells.forEach(function (cell) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      btn.textContent = cell.day;
      btn.setAttribute('data-iso', S.toISO(cell.date));
      if (cell.outside) btn.classList.add('is-outside');
      if (selected && S.toISO(cell.date) === S.toISO(selected)) btn.classList.add('is-selected');
      if (cell.date.getTime() === today.getTime()) btn.classList.add('is-today');
      grid.appendChild(btn);
    });
  }

  function renderMonths(root, date) {
    var box = calEl(root, '.cal-months');
    box.replaceChildren();
    for (var m = 0; m < 12; m++) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-month' + (m === date.getMonth() ? ' is-selected' : '');
      btn.textContent = m + 1 + ' 月';
      btn.setAttribute('data-month', m);
      box.appendChild(btn);
    }
  }

  function renderYears(root, start, date) {
    var box = calEl(root, '.cal-years');
    box.replaceChildren();
    for (var i = 0; i < 12; i++) {
      var y = start + i;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-year' + (y === date.getFullYear() ? ' is-selected' : '');
      btn.textContent = y;
      btn.setAttribute('data-year', y);
      box.appendChild(btn);
    }
  }

  function setDate(root, iso, silent) {
    root.setAttribute('data-value', iso);
    var text = root.querySelector('.date-text');
    if (text) text.textContent = iso || '选择日期';
    if (!silent) {
      root.dispatchEvent(new CustomEvent('datechange', { bubbles: true, detail: { value: iso } }));
    }
  }

  function openDate(root) {
    closeAll(root);
    var pop = root._pop || root.querySelector('.cal-pop');
    var current = S.parseISO(root.getAttribute('data-value')) || new Date();
    var st = calState(root);
    st.view = 'day';
    st.date = new Date(current.getFullYear(), current.getMonth(), 1);
    if (root._closeTimer) {
      clearTimeout(root._closeTimer);
      root._closeTimer = 0;
    }
    root.classList.remove('is-closing');
    renderCal(root);
    root.classList.add('is-open');
    pop.hidden = false;
    root.querySelector('.date-btn').setAttribute('aria-expanded', 'true');
    positionPop(root, pop);
  }

  function positionPop(root, pop) {
    var btn = root.querySelector('.date-btn');
    var host = pop.parentElement;
    if (!host || host === root) return;
    var br = btn.getBoundingClientRect();
    var hr = host.getBoundingClientRect();
    var popW = pop.offsetWidth || 258;
    var popH = pop.offsetHeight || 300;
    var left = br.left - hr.left;
    if (left + popW > hr.width - 10) left = hr.width - popW - 10;
    var top = br.bottom - hr.top + 6;
    if (top + popH > hr.height - 10) {
      var up = br.top - hr.top - popH - 6;
      if (up > 8) top = up;
      /* 上下都放不下就贴到宿主能容下的最低位置，别让它溢出被裁 */
      else if (hr.height - popH - 8 > 8) top = hr.height - popH - 8;
    }
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  function closeDate(root, silent) {
    var pop = root._pop || root.querySelector('.cal-pop');
    var btn = root.querySelector('.date-btn');
    if (root._closeTimer) clearTimeout(root._closeTimer);
    root.classList.remove('is-open');
    if (pop && !reduceMotion()) {
      pop.hidden = false;
      root.classList.add('is-closing');
      root._closeTimer = setTimeout(function () {
        pop.hidden = true;
        root.classList.remove('is-closing');
        root._closeTimer = 0;
      }, CLOSE_OUT);
    } else if (pop) {
      pop.hidden = true;
      root.classList.remove('is-closing');
    }
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      if (!silent) btn.focus();
    }
  }

  function initDate(root) {
    var btn = root.querySelector('.date-btn');
    var pop = root.querySelector('.cal-pop');
    if (!btn || !pop) return;

    /* 弹层留在原地会被可滚动容器裁掉，挪到对话框这一层 */
    var dlg = root.closest('dialog');
    if (dlg) {
      dlg.appendChild(pop);
      pop.classList.add('cal-in-dialog');
    }
    root._pop = pop;

    /* 弹层挪出来之后就不是 root 的后代了，键位得在它自己身上接 */
    pop.addEventListener('keydown', function (evt) {
      if (evt.key !== 'Escape' || pop.hidden) return;
      evt.preventDefault();
      evt.stopPropagation();
      closeDate(root);
    });

    btn.addEventListener('click', function (evt) {
      evt.stopPropagation();
      if (root.classList.contains('is-open')) closeDate(root);
      else openDate(root);
    });

    /* 也可以直接把日期敲进来 */
    var typeBox = pop.querySelector('.cal-type');
    if (typeBox) {
      var commitTyped = function () {
        var text = typeBox.value.trim();
        if (!text) return false;
        var iso = S.normalizeDate(text);
        if (!iso) {
          typeBox.classList.add('is-bad');
          setTimeout(function () {
            typeBox.classList.remove('is-bad');
          }, 700);
          return false;
        }
        var st0 = calState(root);
        st0.date = S.parseISO(iso) || st0.date;
        st0.view = 'day';
        typeBox.value = '';
        setDate(root, iso);
        renderCal(root, false);
        closeDate(root);
        return true;
      };

      typeBox.addEventListener('keydown', function (evt) {
        if (evt.key === 'Escape') {
          evt.stopPropagation();
          typeBox.value = '';
          return;
        }
        if (evt.key !== 'Enter') return;
        evt.preventDefault();
        commitTyped();
      });

      /* 敲完直接点别处也算数，不用非得按回车 */
      typeBox.addEventListener('change', commitTyped);
    }

    /* 标题：日 → 月 → 年 → 日 */
    var titleBtn = pop.querySelector('.cal-title-btn');
    if (titleBtn) {
      titleBtn.addEventListener('click', function (evt) {
        evt.stopPropagation();
        var st = calState(root);
        st.view = st.view === 'day' ? 'month' : st.view === 'month' ? 'year' : 'day';
        renderCal(root, true);
        positionPop(root, pop);
      });
    }

    /* 左右箭头：按当前视图翻页 */
    pop.querySelectorAll('.cal-nav').forEach(function (nav) {
      nav.addEventListener('click', function (evt) {
        evt.stopPropagation();
        var st = calState(root);
        var step = Number(nav.getAttribute('data-step'));
        var y = st.date.getFullYear();
        var m = st.date.getMonth();
        if (st.view === 'day') st.date = new Date(y, m + step, 1);
        else if (st.view === 'month') st.date = new Date(y + step, m, 1);
        else st.date = new Date(y + step * 12, m, 1);
        renderCal(root, true, step);
        positionPop(root, pop);
      });
    });

    pop.addEventListener('click', function (evt) {
      evt.stopPropagation();
      var st = calState(root);

      var day = evt.target.closest('.cal-day');
      if (day) {
        setDate(root, day.getAttribute('data-iso'));
        day.classList.add('is-picked');
        closeDate(root);
        return;
      }

      var month = evt.target.closest('.cal-month');
      if (month) {
        st.date = new Date(st.date.getFullYear(), Number(month.getAttribute('data-month')), 1);
        st.view = 'day';
        renderCal(root, true);
        positionPop(root, pop);
        return;
      }

      var year = evt.target.closest('.cal-year');
      if (year) {
        st.date = new Date(Number(year.getAttribute('data-year')), st.date.getMonth(), 1);
        st.view = 'month';
        renderCal(root, true);
        positionPop(root, pop);
        return;
      }

      var todayBtn = evt.target.closest('[data-today]');
      if (todayBtn) {
        var now = new Date();
        setDate(root, S.toISO(now));
        st.view = 'day';
        st.date = new Date(now.getFullYear(), now.getMonth(), 1);
        renderCal(root, true);
        closeDate(root);
      }
    });

    root.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape' && root.classList.contains('is-open')) {
        evt.preventDefault();
        evt.stopPropagation();
        closeDate(root);
      }
    });

    var initial = root.getAttribute('data-value');
    if (initial) setDate(root, initial, true);
  }

  document.addEventListener('click', function (evt) {
    if (!evt.target.closest('.sel') && !evt.target.closest('.datep')) closeAll(null);
  });

  global.UI = {
    mountAll: function (root) {
      (root || document).querySelectorAll('.sel').forEach(initSelect);
      (root || document).querySelectorAll('.datep').forEach(initDate);
    }
  };
})(window);

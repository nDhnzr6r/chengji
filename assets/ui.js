/* 自建控件：下拉选择与日期选择 */
(function (global) {
  'use strict';

  function pad2(n) { return ('0' + n).slice(-2); }

  function toISO(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseISO(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    var p = s.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  function cnDate(iso) {
    var d = parseISO(iso);
    if (!d) return '选择日期';
    return d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  function closeAll(except) {
    document.querySelectorAll('.sel.is-open, .datep.is-open').forEach(function (node) {
      if (node !== except) {
        node.classList.remove('is-open');
        var pop = node.querySelector('.sel-pop') || node._pop;
        if (pop) pop.hidden = true;
        var btn = node.querySelector('.sel-btn, .date-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
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
      root.dispatchEvent(new CustomEvent('selchange', {
        bubbles: true,
        detail: { value: root.getAttribute('data-value') }
      }));
    }
  }

  function openSelect(root) {
    closeAll(root);
    var pop = root.querySelector('.sel-pop');
    root.classList.add('is-open');
    pop.hidden = false;
    root.querySelector('.sel-btn').setAttribute('aria-expanded', 'true');
    var on = pop.querySelector('.sel-opt.is-on');
    if (on) on.focus();
  }

  function closeSelect(root) {
    root.classList.remove('is-open');
    var pop = root.querySelector('.sel-pop');
    if (pop) pop.hidden = true;
    var btn = root.querySelector('.sel-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
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
        if (!root.classList.contains('is-open')) { openSelect(root); return; }
        opts[Math.min(opts.length - 1, idx + 1)].focus();
      } else if (evt.key === 'ArrowUp') {
        evt.preventDefault();
        if (!root.classList.contains('is-open')) { openSelect(root); return; }
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

  function renderCal(root, animate) {
    var st = calState(root);
    var title = calEl(root, '.cal-title');
    ['day', 'month', 'year'].forEach(function (k) {
      var p = calEl(root, '[data-panel="' + k + '"]');
      if (p) p.hidden = k !== st.view;
    });

    if (st.view === 'day') {
      title.textContent = st.date.getFullYear() + ' 年 ' + (st.date.getMonth() + 1) + ' 月';
      renderDays(root, st.date);
    } else if (st.view === 'month') {
      title.textContent = st.date.getFullYear() + ' 年';
      renderMonths(root, st.date);
    } else {
      var start = Math.floor(st.date.getFullYear() / 12) * 12;
      title.textContent = start + ' – ' + (start + 11);
      renderYears(root, start, st.date);
    }

    if (animate) {
      var panel = calEl(root, '[data-panel="' + st.view + '"]');
      if (panel) {
        panel.classList.remove('cal-swap');
        void panel.offsetWidth;
        panel.classList.add('cal-swap');
      }
    }
  }

  function renderDays(root, viewDate) {
    var selected = parseISO(root.getAttribute('data-value'));
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var grid = calEl(root, '.cal-grid');
    grid.innerHTML = '';

    var first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    var startOffset = (first.getDay() + 6) % 7; /* 周一开头 */
    var daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
    var prevDays = new Date(viewDate.getFullYear(), viewDate.getMonth(), 0).getDate();

    var cells = [];
    for (var i = startOffset - 1; i >= 0; i--) {
      cells.push({ day: prevDays - i, outside: true, date: new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, prevDays - i) });
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
      btn.setAttribute('data-iso', toISO(cell.date));
      if (cell.outside) btn.classList.add('is-outside');
      if (selected && toISO(cell.date) === toISO(selected)) btn.classList.add('is-selected');
      if (cell.date.getTime() === today.getTime()) btn.classList.add('is-today');
      grid.appendChild(btn);
    });
  }

  function renderMonths(root, date) {
    var box = calEl(root, '.cal-months');
    box.innerHTML = '';
    for (var m = 0; m < 12; m++) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-month' + (m === date.getMonth() ? ' is-selected' : '');
      btn.textContent = (m + 1) + ' 月';
      btn.setAttribute('data-month', m);
      box.appendChild(btn);
    }
  }

  function renderYears(root, start, date) {
    var box = calEl(root, '.cal-years');
    box.innerHTML = '';
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
    var current = parseISO(root.getAttribute('data-value')) || new Date();
    var st = calState(root);
    st.view = 'day';
    st.date = new Date(current.getFullYear(), current.getMonth(), 1);
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
    }
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, top) + 'px';
  }

  function closeDate(root) {
    root.classList.remove('is-open');
    var pop = root._pop || root.querySelector('.cal-pop');
    if (pop) pop.hidden = true;
    var btn = root.querySelector('.date-btn');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
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

    btn.addEventListener('click', function (evt) {
      evt.stopPropagation();
      if (root.classList.contains('is-open')) closeDate(root);
      else openDate(root);
    });

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
        renderCal(root, true);
        positionPop(root, pop);
      });
    });

    pop.addEventListener('click', function (evt) {
      evt.stopPropagation();
      var st = calState(root);

      var day = evt.target.closest('.cal-day');
      if (day) {
        setDate(root, day.getAttribute('data-iso'));
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
        setDate(root, toISO(now));
        st.view = 'day';
        st.date = new Date(now.getFullYear(), now.getMonth(), 1);
        renderCal(root, true);
        closeDate(root);
      }
    });

    root.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape' && root.classList.contains('is-open')) {
        evt.preventDefault();
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
    initSelect: initSelect,
    initDate: initDate,
    setSelect: setSelect,
    setDate: setDate,
    closeAll: closeAll,
    toISO: toISO,
    parseISO: parseISO,
    cnDate: cnDate,
    mountAll: function (root) {
      (root || document).querySelectorAll('.sel').forEach(initSelect);
      (root || document).querySelectorAll('.datep').forEach(initDate);
    }
  };
})(window);

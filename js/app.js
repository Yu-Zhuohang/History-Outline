/* ==========================================================================
   js/app.js —— 数据加载、时间线渲染、事件联动
   阶段：第二阶段（核心交互）
   职责：
     1. fetch 读取 data/events.json；
     2. 按年份渲染左侧竖排时间线（数据驱动，不再依赖 HTML 里的静态节点）；
     3. 点击 / 回车 / 空格 选中节点 → 高亮 + 地图定位 + 考点面板更新；
     4. 数据或地图异常时给出可读提示，不白屏。
   ========================================================================== */

(function () {
  'use strict';

  var DATA_URL = 'data/events.json';
  var MOBILE_BREAKPOINT = 768;

  var state = {
    events: [],                       // 已排序的事件数组
    byId: Object.create(null),        // id → 事件对象
    activeId: null                    // 当前选中节点
  };

  /* ---------------------------------------------------------------- 工具 --- */

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function makeEl(tag, className, content) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined && content !== null) el.textContent = String(content);
    return el;
  }

  /* 时间线里用简称，避免一行塞不下：去掉末尾括号注释 */
  function shortTitle(title) {
    var short = String(title || '').replace(/\s*（[^）]*）\s*$/, '').trim();
    return short || String(title || '');
  }

  /* 地点同样处理："广东虎门（销烟与海防要地）" → "广东虎门" */
  function shortLocation(location) {
    var short = String(location || '').replace(/（[^）]*）/g, '').replace(/\s{2,}/g, ' ').trim();
    return short || String(location || '');
  }

  /* ------------------------------------------------------ 时间线渲染 --- */

  function renderTimeline(events) {
    var container = document.getElementById('timeline');
    if (!container) return;

    clearNode(container);

    var fragment = document.createDocumentFragment();

    events.forEach(function (item) {
      var node = document.createElement('div');
      node.className = 'timeline-item';
      node.setAttribute('role', 'listitem');
      node.setAttribute('tabindex', '0');
      node.setAttribute('data-id', item.id);
      node.setAttribute('aria-label', String(item.year) + '年 ' + item.title);

      var yearEl = makeEl('span', 'year', item.year);
      var bodyEl = makeEl('div', 'node-body');
      bodyEl.appendChild(makeEl('span', 'title', shortTitle(item.title)));
      bodyEl.appendChild(makeEl('span', 'location', shortLocation(item.locationName)));

      node.appendChild(yearEl);
      node.appendChild(bodyEl);

      node.addEventListener('click', onItemClick);
      node.addEventListener('keydown', onItemKeydown);

      fragment.appendChild(node);
    });

    container.appendChild(fragment);
  }

  function updateMeta(count) {
    var meta = document.getElementById('event-meta');
    if (!meta) return;
    meta.textContent = '按年份排序 · 共 ' + count + ' 个节点';
  }

  /* ------------------------------------------------------ 选中与联动 --- */

  function onItemClick(event) {
    var id = event.currentTarget.getAttribute('data-id');
    selectEvent(id);
  }

  function onItemKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    var id = event.currentTarget.getAttribute('data-id');
    selectEvent(id);
  }

  function setActive(id) {
    var nodes = document.querySelectorAll('.timeline-item');
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var isActive = node.getAttribute('data-id') === id;
      node.classList.toggle('active', isActive);
      if (isActive) {
        node.setAttribute('aria-current', 'true');
      } else {
        node.removeAttribute('aria-current');
      }
    }
    state.activeId = id;
  }

  function selectEvent(id, options) {
    var settings = options || {};
    var scrollToMap = settings.scrollToMap !== false;

    var item = state.byId[id];
    if (!item) {
      showPanelError('没有找到这条事件数据', 'id：' + id, '请检查 data/events.json 中的 id 是否与时间线一致。');
      return;
    }

    setActive(id);
    renderDetail(item);

    var hasCoords = typeof item.lat === 'number' && typeof item.lng === 'number';

    if (hasCoords && typeof window.focusOnEvent === 'function') {
      var ok = window.focusOnEvent(item.lat, item.lng, item.title, item.mapNote);
      if (!ok) showMapNotice('地图不可用，已仅显示文字讲解。');
    }

    // 移动端：点击后把地图区域滚进视野（从 URL 直接定位时不滚，避免和节点定位打架）
    if (scrollToMap && window.innerWidth <= MOBILE_BREAKPOINT) {
      var mapEl = document.getElementById('map');
      if (mapEl && mapEl.scrollIntoView) {
        mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  /* ------------------------------------------------------ 考点面板渲染 --- */

  function renderDetail(item) {
    var panel = document.getElementById('detail-panel');
    if (!panel) return;

    clearNode(panel);

    var keyPoints = item.keyPoints || {};

    panel.appendChild(makeEl('h2', 'detail-title', item.title));

    var meta = makeEl('p', 'detail-meta');
    meta.appendChild(makeEl('strong', null, '时间：'));
    meta.appendChild(document.createTextNode(item.date || '—'));
    meta.appendChild(document.createTextNode('　'));
    meta.appendChild(makeEl('strong', null, '地点：'));
    meta.appendChild(document.createTextNode(item.locationName || '—'));
    panel.appendChild(meta);

    var sections = [
      { title: '背景', text: keyPoints.background, className: null },
      { title: '内容', text: keyPoints.content, className: null },
      { title: '意义', text: keyPoints.significance, className: null },
      { title: '易考提示', text: keyPoints.examTips, className: 'exam-tip' }
    ];

    sections.forEach(function (section) {
      if (!section.text) return;
      panel.appendChild(makeEl('h3', null, section.title));
      panel.appendChild(makeEl('p', section.className, section.text));
    });

    // 视觉层：重放面板入场动画（阶段三唯一新增的 JS，只切 class，不碰数据与交互）
    panel.classList.remove('content-enter');
    void panel.offsetWidth;
    panel.classList.add('content-enter');
  }

  /* ---------------------------------------------------------- 异常提示 --- */

  function showPanelError(title, detail, hint) {
    var panel = document.getElementById('detail-panel');
    if (!panel) return;
    clearNode(panel);
    panel.appendChild(makeEl('h2', 'status-title', title));
    if (detail) panel.appendChild(makeEl('p', 'status-detail', detail));
    if (hint) panel.appendChild(makeEl('p', 'status-hint', hint));
  }

  function showMapNotice(message) {
    var container = document.getElementById('map');
    if (!container) return;
    // map.js 已经写过更具体的降级说明时不要覆盖它
    if (container.classList.contains('map-unavailable') && container.textContent.trim()) return;
    container.classList.add('map-unavailable');
    container.textContent = message;
  }

  /* ---------------------------------------------------------- 数据加载 --- */

  function onLoadError(error) {
    console.error('[app] data/events.json 加载失败：', error);

    if (window.location.protocol === 'file:') {
      console.warn('[app] 当前是 file:// 协议，请改用本地服务器打开，例如：python -m http.server 8000');
      showPanelError(
        '事件数据加载失败',
        '当前以 file:// 方式打开页面，浏览器出于安全限制禁止读取本地 JSON 文件。',
        '请在项目目录执行 python -m http.server 8000（或任意静态服务器），再访问 http://localhost:8000。'
      );
      return;
    }

    showPanelError(
      '事件数据加载失败',
      error && error.message ? error.message : '未知错误',
      '请确认 data/events.json 存在且为合法 JSON，然后刷新页面。'
    );
  }

  function loadEvents() {
    if (typeof window.fetch !== 'function') {
      showPanelError('浏览器版本过低', '当前浏览器不支持 fetch，无法加载事件数据。', '请使用较新版本的 Chrome、Edge、Firefox 或 Safari。');
      return;
    }

    window
      .fetch(DATA_URL, { cache: 'no-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error('数据不是非空数组');
        }

        data.forEach(function (item) {
          if (item && item.id) state.byId[item.id] = item;
        });

        state.events = data.slice().sort(function (a, b) {
          if (a.year !== b.year) return a.year - b.year;
          return String(a.date || '').localeCompare(String(b.date || ''));
        });

        renderTimeline(state.events);
        updateMeta(state.events.length);

        // 支持 ?id=xxx 或 #xxx 直接定位到某个事件（便于分享和自测）
        openFromUrl();
      })
      .catch(onLoadError);
  }

  function openFromUrl() {
    var fromQuery = new URLSearchParams(window.location.search).get('id');
    var fromHash = window.location.hash ? window.location.hash.replace(/^#/, '') : '';
    var id = fromQuery || decodeURIComponent(fromHash);
    if (!id || !state.byId[id]) return;

    selectEvent(id, { scrollToMap: false });

    var node = document.querySelector('.timeline-item[data-id="' + id + '"]');
    if (node && node.scrollIntoView) {
      node.scrollIntoView({ block: 'center' });
    }
  }

  /* -------------------------------------------------------------- 启动 --- */

  function boot() {
    if (typeof window.initHistoryMap === 'function') {
      window.initHistoryMap();
    }
    loadEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

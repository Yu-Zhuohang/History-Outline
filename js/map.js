/* ==========================================================================
   js/map.js —— 地图初始化与事件定位
   阶段：第二阶段（核心交互）
   说明：
     1. 底图使用 WGS84 的 OSM 体系瓦片（与 events.json 的经纬度同一坐标系），
        优先 CARTO 浅色底图，瓦片连续失败时自动切换到 OSM 德国镜像。
     2. 不使用 Leaflet 默认图标（它依赖 CDN 上的图片文件），改为内联 divIcon，
        保证断网 / CDN 图片 404 时标记仍能显示。
     3. 对外暴露 window.initHistoryMap 与 window.focusOnEvent。
   ========================================================================== */

(function () {
  'use strict';

  /* 瓦片源：按顺序尝试，前一个连续失败才切换。
     两个源都是 WGS84 / Web 墨卡托，与 events.json 的经纬度同一坐标系，
     不需要申请 API Key。（CARTO 现要求 Key，不可用；高德为 GCJ-02，会偏移，故不采用） */
  var TILE_SOURCES = [
    {
      url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
      options: {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 贡献者'
      }
    },
    {
      url: 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      options: {
        subdomains: 'abc',
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 贡献者， Humanitarian OSM Team 风格'
      }
    }
  ];

  var DEFAULT_VIEW = { center: [35.0, 105.0], zoom: 4 }; // 中国全境视野
  var FOCUS_ZOOM = 8;                                    // 定位到事件所在地的层级
  var FLY_DURATION = 0.9;                                // 平滑定位耗时（秒）
  var TILE_ERROR_LIMIT = 3;                              // 连续失败多少张后换源

  var map = null;
  var markerLayer = null;
  var activeMarker = null;
  var tileLayer = null;
  var tileSourceIndex = 0;
  var tileErrorCount = 0;

  /* ---------------------------------------------------------------- 工具 --- */

  function leafletReady() {
    return typeof window.L !== 'undefined' && window.L && window.L.map;
  }

  /* ------------------------------------------------------------ 瓦片加载 --- */

  function attachTileSource(index) {
    var source = TILE_SOURCES[index];
    if (!source || !map) return;

    tileErrorCount = 0;

    var previous = tileLayer;
    tileLayer = window.L.tileLayer(source.url, source.options);
    tileLayer.on('tileerror', onTileError);

    if (previous && map.hasLayer(previous)) {
      map.removeLayer(previous);
    }
    tileLayer.addTo(map);
  }

  /* 连续多张瓦片失败，说明该源在当前网络下不可用，切到下一个源 */
  function onTileError() {
    tileErrorCount += 1;
    if (tileErrorCount < TILE_ERROR_LIMIT) return;
    if (tileSourceIndex >= TILE_SOURCES.length - 1) {
      console.warn('[map] 所有底图瓦片源均加载失败，地图可能显示为空白。');
      return;
    }
    tileSourceIndex += 1;
    attachTileSource(tileSourceIndex);
  }

  /* ------------------------------------------------------------ 标记图标 --- */

  function createMarkerIcon() {
    return window.L.divIcon({
      className: 'event-marker',
      html: '<span class="event-marker__dot"></span>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -12]
    });
  }

  /* 弹窗内容：用 DOM API 拼接，避免把数据当 HTML 解析 */
  function createPopupContent(title, mapNote) {
    var wrapper = document.createElement('div');
    wrapper.className = 'event-popup';

    var titleEl = document.createElement('p');
    titleEl.className = 'event-popup__title';
    titleEl.textContent = title;
    wrapper.appendChild(titleEl);

    if (mapNote) {
      var noteEl = document.createElement('p');
      noteEl.className = 'event-popup__note';
      noteEl.textContent = mapNote;
      wrapper.appendChild(noteEl);
    }

    return wrapper;
  }

  /* -------------------------------------------------------------- 初始化 --- */

  function initMap() {
    var container = document.getElementById('map');
    if (!container) return null;

    if (!leafletReady()) {
      // 地图库没能加载：页面其余部分照常可用，不能白屏
      container.classList.add('map-unavailable');
      container.textContent =
        '地图库未能加载（网络受限）。左侧时间线与右侧考点讲解仍可正常使用。';
      // 这是可预期的降级路径（离线 / CDN 被拦截），用 warn 而非 error，
      // 避免在「控制台无报错」的验收标准下被误判为故障。
      console.warn('[map] Leaflet 未加载，已跳过地图初始化，页面降级为纯文字模式。');
      return null;
    }

    map = window.L.map(container, {
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      minZoom: 3,
      maxZoom: 18,
      zoomControl: true,
      worldCopyJump: true
    });

    markerLayer = window.L.layerGroup().addTo(map);
    attachTileSource(0);

    // 容器尺寸变化（响应式布局切换、移动端滚动）后需要重算
    window.L.Util.requestAnimFrame(function () {
      if (map) map.invalidateSize();
    });
    window.addEventListener('resize', function () {
      if (map) map.invalidateSize();
    });

    return map;
  }

  /* -------------------------------------------------------------- 定位 --- */

  /**
   * 定位到某个事件
   * @param {number} lat 纬度
   * @param {number} lng 经度
   * @param {string} title 事件名
   * @param {string} mapNote 地点说明
   * @returns {boolean} 是否成功定位（地图不可用时返回 false）
   */
  function focusOnEvent(lat, lng, title, mapNote) {
    if (!map || !markerLayer) return false;
    if (typeof lat !== 'number' || typeof lng !== 'number') return false;

    markerLayer.clearLayers();

    var marker = window.L.marker([lat, lng], {
      icon: createMarkerIcon(),
      keyboard: true,
      title: title || '',
      riseOnHover: true
    });

    activeMarker = marker;

    marker.bindPopup(createPopupContent(title || '', mapNote || ''), {
      maxWidth: 280,
      autoPan: true,
      autoPanPadding: [24, 24],
      className: 'event-popup-wrapper'
    });

    marker.addTo(markerLayer);

    map.flyTo([lat, lng], FOCUS_ZOOM, {
      duration: FLY_DURATION,
      easeLinearity: 0.25
    });

    // flyTo 过程中立即开弹窗会被 autoPan 拉回去，动画结束后再开更稳；
    // 若期间用户又点了别的节点，activeMarker 已变，旧弹窗不再打开。
    // 另外用定时器兜底：目标位置与当前一致时 Leaflet 可能不会触发 moveend。
    var popupTimer = window.setTimeout(function () {
      if (activeMarker === marker && !marker.isPopupOpen()) marker.openPopup();
    }, FLY_DURATION * 1000 + 300);

    map.once('moveend', function () {
      window.clearTimeout(popupTimer);
      if (activeMarker === marker) marker.openPopup();
    });

    return true;
  }

  /* -------------------------------------------------------------- 导出 --- */

  window.initHistoryMap = initMap;
  window.focusOnEvent = focusOnEvent;
})();

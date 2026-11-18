/**
 * map.js - Leaflet 高機能・シック＆エレガントマップ制御
 * 
 * - 全画面避難マップ (MapManager)
 * - ホーム画面インラインミニマップ (HomeMiniMap)
 * - CartoDB Dark Matter & OpenStreetMap 自動フォールバック
 */

const MapManager = {
  map: null,
  currentLocationMarker: null,
  currentAccuracyCircle: null,
  placeMarkers: {},
  routeLayerGroup: null,
  selectedPlaceId: null,
  onPlaceSelectCallback: null,
  isInitialized: false,

  initMap(containerId = 'map-container', onPlaceSelect = null) {
    if (this.map) return;

    const container = document.getElementById(containerId);
    if (!container) return;

    this.onPlaceSelectCallback = onPlaceSelect;

    this.map = L.map(containerId, {
      center: [35.6812, 139.7671],
      zoom: 16,
      zoomControl: false,
      attributionControl: true
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // 完全無料・APIキー不要の公式 OpenStreetMap タイル (CSSフィルターでシックなダークテーマに描画)
    const osmTile = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });

    osmTile.addTo(this.map);
    this.routeLayerGroup = L.layerGroup().addTo(this.map);
    this.isInitialized = true;

    // 初回サイズ補正
    this.invalidateSize();
  },

  updateCurrentLocation(location, panToCenter = false) {
    if (!this.map || !location) return;

    const latLng = [location.latitude, location.longitude];

    const currentLocIcon = L.divIcon({
      className: 'current-location-marker-container',
      html: `
        <div class="current-location-wave"></div>
        <div class="current-location-pulse"></div>
        <div class="current-location-dot"></div>
      `,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    if (!this.currentLocationMarker) {
      this.currentLocationMarker = L.marker(latLng, {
        icon: currentLocIcon,
        zIndexOffset: 1000
      }).addTo(this.map);
    } else {
      this.currentLocationMarker.setLatLng(latLng);
    }

    if (location.accuracy && location.accuracy > 0) {
      if (!this.currentAccuracyCircle) {
        this.currentAccuracyCircle = L.circle(latLng, {
          radius: Math.min(location.accuracy, 150),
          color: '#0284C7',
          fillColor: '#0EA5E9',
          fillOpacity: 0.12,
          weight: 1.5,
          dashArray: '4, 4'
        }).addTo(this.map);
      } else {
        this.currentAccuracyCircle.setLatLng(latLng);
        this.currentAccuracyCircle.setRadius(Math.min(location.accuracy, 150));
      }
    }

    if (panToCenter) {
      this.map.setView(latLng, 16, { animate: true, duration: 0.8 });
    }
  },

  renderPlaceMarkers(places) {
    if (!this.map) return;

    Object.values(this.placeMarkers).forEach(marker => this.map.removeLayer(marker));
    this.placeMarkers = {};

    places.forEach((place, index) => {
      const isTopScore = index === 0;
      const markerClass = isTopScore ? 'place-marker-icon super-place' : 'place-marker-icon';

      const customIcon = L.divIcon({
        className: 'place-marker-container',
        html: `
          <div class="${markerClass}">
            <span class="marker-symbol">${isTopScore ? '👑' : '🏛️'}</span>
          </div>
          <div class="marker-pin-label">${place.name.length > 8 ? place.name.slice(0, 8) + '…' : place.name}</div>
        `,
        iconSize: [44, 44],
        iconAnchor: [22, 44],
        popupAnchor: [0, -44]
      });

      const marker = L.marker([place.latitude, place.longitude], {
        icon: customIcon
      }).addTo(this.map);

      const evalData = place.evaluation || calculateRecommendationScore(place, LocationManager.currentLocation);

      const popupContent = `
        <div class="map-popup-card">
          <div class="popup-top">
            <span class="popup-badge ${evalData.badgeClass}">${evalData.rank}</span>
            <span class="popup-dist">🚶 約${evalData.walkingMinutes}分 (${evalData.formattedDistance})</span>
          </div>
          <div class="popup-title">${place.name}</div>
          <div class="popup-features">
            <span class="feat-tag">❄️ 強冷房</span>
            ${place.waterDispenser ? '<span class="feat-tag water">💧 無料給水</span>' : ''}
            <span class="feat-tag">🪑 休憩座席</span>
          </div>
          <button class="popup-select-btn" onclick="window.CoolNaviApp.selectPlaceFromMap('${place.id}')">
            ここへナビ開始 ➔
          </button>
        </div>
      `;

      marker.bindPopup(popupContent, { maxWidth: 280, className: 'glass-popup' });

      marker.on('click', () => {
        if (this.onPlaceSelectCallback) {
          this.onPlaceSelectCallback(place);
        }
      });

      this.placeMarkers[place.id] = marker;
    });
  },

  drawRoadRoute(routeData, autoFit = true) {
    if (!this.map || !this.routeLayerGroup) return;

    this.routeLayerGroup.clearLayers();
    if (!routeData || !routeData.coordinates || routeData.coordinates.length < 2) return;

    // 1. スカイブルー光彩背景線 (白基調地図に美しく調和)
    const glowPolyline = L.polyline(routeData.coordinates, {
      color: '#0284C7',
      weight: 12,
      opacity: 0.18,
      lineCap: 'round',
      lineJoin: 'round'
    });
    this.routeLayerGroup.addLayer(glowPolyline);

    // 2. コアの道路沿いルートライン (上質なディープセルリアン)
    const mainPolyline = L.polyline(routeData.coordinates, {
      color: '#0284C7',
      weight: 5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    });
    this.routeLayerGroup.addLayer(mainPolyline);

    // 3. 進行方向の動的ドット (清潔感のあるホワイト)
    const animatedLine = L.polyline(routeData.coordinates, {
      color: '#FFFFFF',
      weight: 2.5,
      opacity: 0.95,
      dashArray: '5, 10'
    });
    this.routeLayerGroup.addLayer(animatedLine);

    // 4. 曲がり角マーカー (オレンジ)
    if (routeData.steps && routeData.steps.length > 2) {
      routeData.steps.slice(1, -1).forEach(step => {
        const turnDot = L.circleMarker(step.location, {
          radius: 5,
          color: '#FFFFFF',
          fillColor: '#FF6B00',
          fillOpacity: 1,
          weight: 2.5
        });
        turnDot.bindTooltip(step.instruction, { direction: 'top', offset: [0, -8] });
        this.routeLayerGroup.addLayer(turnDot);
      });
    }

    if (autoFit) {
      this.map.fitBounds(mainPolyline.getBounds(), {
        padding: [60, 60],
        maxZoom: 17
      });
    }
  },

  clearRoute() {
    if (this.routeLayerGroup) {
      this.routeLayerGroup.clearLayers();
    }
  },

  selectDestination(place) {
    this.selectedPlaceId = place ? place.id : null;
    if (place && this.map && this.placeMarkers[place.id]) {
      this.placeMarkers[place.id].openPopup();
    }
  },

  invalidateSize(forcePan = true) {
    if (!this.map) return;
    // タブ切り替えのアニメーションとSafariレンダリングに合わせた4段階リフレッシュ
    [0, 80, 200, 500].forEach(delay => {
      setTimeout(() => {
        if (this.map) {
          this.map.invalidateSize();
          if (forcePan && this.currentLocationMarker) {
            this.map.panTo(this.currentLocationMarker.getLatLng(), { animate: false });
          }
        }
      }, delay);
    });
  }
};

/**
 * HomeMiniMap - ホーム画面専用インラインミニマップ制御
 * ホーム画面を開いた瞬間に現在地と最寄り避難所の位置関係を直感表示
 */
const HomeMiniMap = {
  map: null,
  currentMarker: null,
  placeMarkers: [],
  routeLine: null,

  init(containerId = 'home-mini-map', onClick = null) {
    if (this.map) return;
    const container = document.getElementById(containerId);
    if (!container) return;

    this.map = L.map(containerId, {
      center: [35.6812, 139.7671],
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      touchZoom: true,
      doubleClickZoom: false,
      scrollWheelZoom: false
    });

    // 完全無料・APIキー不要の公式 OpenStreetMap タイル
    const osmTile = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19
    });

    osmTile.addTo(this.map);

    if (onClick) {
      this.map.on('click', onClick);
    }

    this.invalidate();
  },

  update(currentLocation, topPlaces = []) {
    if (!this.map || !currentLocation) return;

    const currentLatLng = [currentLocation.latitude, currentLocation.longitude];

    // 現在地マーカー
    const locIcon = L.divIcon({
      className: 'current-location-marker-container',
      html: `
        <div class="current-location-wave"></div>
        <div class="current-location-pulse"></div>
        <div class="current-location-dot"></div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    if (!this.currentMarker) {
      this.currentMarker = L.marker(currentLatLng, { icon: locIcon, zIndexOffset: 500 }).addTo(this.map);
    } else {
      this.currentMarker.setLatLng(currentLatLng);
    }

    // 既存シェルターピン消去
    this.placeMarkers.forEach(m => this.map.removeLayer(m));
    this.placeMarkers = [];

    const boundsPoints = [currentLatLng];

    // 上位シェルターをプロット
    topPlaces.slice(0, 4).forEach((place, idx) => {
      const isTop = idx === 0;
      const pLatLng = [place.latitude, place.longitude];
      boundsPoints.push(pLatLng);

      const pIcon = L.divIcon({
        className: 'place-marker-container',
        html: `
          <div class="place-marker-icon ${isTop ? 'super-place' : ''}" style="width:34px;height:34px;font-size:1.1rem;">
            <span class="marker-symbol">${isTop ? '👑' : '🏛️'}</span>
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 34]
      });

      const marker = L.marker(pLatLng, { icon: pIcon }).addTo(this.map);
      this.placeMarkers.push(marker);
    });

    // 1位への誘導点線
    if (this.routeLine) {
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }

    if (topPlaces.length > 0) {
      const topTarget = [topPlaces[0].latitude, topPlaces[0].longitude];
      this.routeLine = L.polyline([currentLatLng, topTarget], {
        color: '#0284C7',
        weight: 3.5,
        opacity: 0.9,
        dashArray: '6, 8'
      }).addTo(this.map);
    }

    // 範囲自動フィット
    if (boundsPoints.length > 1) {
      try {
        const bounds = L.latLngBounds(boundsPoints);
        this.map.fitBounds(bounds, { padding: [35, 35], maxZoom: 17, animate: false });
      } catch (e) {
        this.map.setView(currentLatLng, 16);
      }
    } else {
      this.map.setView(currentLatLng, 16);
    }

    this.invalidate();
  },

  invalidate() {
    if (!this.map) return;
    [0, 100, 300].forEach(d => {
      setTimeout(() => {
        if (this.map) this.map.invalidateSize();
      }, d);
    });
  }
};

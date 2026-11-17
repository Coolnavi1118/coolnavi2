/**
 * map.js - Leaflet 高機能・シック＆エレガントマップ制御 (CartoDB Dark Matter & ゴールド/シアンアクセント)
 */

const MapManager = {
  map: null,
  currentLocationMarker: null,
  currentAccuracyCircle: null,
  placeMarkers: {},
  routeLayerGroup: null,
  selectedPlaceId: null,
  onPlaceSelectCallback: null,

  initMap(containerId = 'map-container', onPlaceSelect = null) {
    if (this.map) return;

    this.onPlaceSelectCallback = onPlaceSelect;

    this.map = L.map(containerId, {
      center: [35.6812, 139.7671],
      zoom: 16,
      zoomControl: false
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // シックで上質な CartoDB Dark Matter タイル
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(this.map);

    this.routeLayerGroup = L.layerGroup().addTo(this.map);
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
          color: '#38BDF8',
          fillColor: '#38BDF8',
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

    // 1. シャンパンゴールド光彩背景線
    const glowPolyline = L.polyline(routeData.coordinates, {
      color: '#D4AF37',
      weight: 12,
      opacity: 0.22,
      lineCap: 'round',
      lineJoin: 'round'
    });
    this.routeLayerGroup.addLayer(glowPolyline);

    // 2. コアの道路沿いルートライン (シックなシャンパンゴールド)
    const mainPolyline = L.polyline(routeData.coordinates, {
      color: '#D4AF37',
      weight: 4.5,
      opacity: 0.95,
      lineCap: 'round',
      lineJoin: 'round'
    });
    this.routeLayerGroup.addLayer(mainPolyline);

    // 3. 進行方向の動的ドット (プラチナホワイト)
    const animatedLine = L.polyline(routeData.coordinates, {
      color: '#F3E5AB',
      weight: 2,
      opacity: 0.85,
      dashArray: '5, 10'
    });
    this.routeLayerGroup.addLayer(animatedLine);

    // 4. 曲がり角マーカー (シアン)
    if (routeData.steps && routeData.steps.length > 2) {
      routeData.steps.slice(1, -1).forEach(step => {
        const turnDot = L.circleMarker(step.location, {
          radius: 5,
          color: '#FFFFFF',
          fillColor: '#38BDF8',
          fillOpacity: 1,
          weight: 2
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

  invalidateSize() {
    if (this.map) {
      setTimeout(() => {
        this.map.invalidateSize();
      }, 150);
    }
  }
};

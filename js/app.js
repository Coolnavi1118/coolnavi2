/**
 * app.js - CoolNavi アプリケーション全体制御 (ハイエンドグラスモルフィズム & フィルター & 日陰案内)
 */

window.CoolNaviApp = {
  currentTab: 'home',
  currentLocation: null,
  selectedPlace: null,
  currentRoute: null,
  weatherData: null,
  activeSort: 'recommend', // 'recommend' | 'distance'
  activeFilterChip: 'all',  // 'all' | 'cool' | 'water' | 'seat' | 'empty'

  async init() {
    this.bindEvents();

    MapManager.initMap('map-container', (place) => {
      this.onPlaceMarkerClicked(place);
    });

    const arVideo = document.getElementById('ar-video');
    ARManager.init(arVideo, (state) => {
      this.renderAROverlay(state);
    });

    await this.refreshLocation(false);
  },

  bindEvents() {
    // ボトムナビ
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        if (tab) this.switchTab(tab);
      });
    });

    // メインCTA
    const btnFindPlaces = document.getElementById('btn-find-places');
    if (btnFindPlaces) {
      btnFindPlaces.addEventListener('click', () => this.switchTab('list'));
    }

    const btnQuickMap = document.getElementById('btn-quick-map');
    if (btnQuickMap) {
      btnQuickMap.addEventListener('click', () => this.switchTab('map'));
    }

    const btnQuickAR = document.getElementById('btn-quick-ar');
    if (btnQuickAR) {
      btnQuickAR.addEventListener('click', async () => {
        const topPlace = PlacesManager.getTopRecommendedPlace(this.currentLocation);
        if (topPlace) {
          await this.startARForPlace(topPlace.id);
        } else {
          this.switchTab('list');
        }
      });
    }

    // 現在地更新
    const btnRefreshLocation = document.getElementById('btn-refresh-location');
    if (btnRefreshLocation) {
      btnRefreshLocation.addEventListener('click', () => this.refreshLocation(true));
    }

    const btnFetchOpenData = document.getElementById('btn-fetch-opendata');
    if (btnFetchOpenData) {
      btnFetchOpenData.addEventListener('click', async () => {
        if (!this.currentLocation) {
          this.refreshLocation(true);
          return;
        }
        this.showToast('現在地周辺の避難所を検索中...');
        await PlacesManager.fetchPlacesByLocation(this.currentLocation.latitude, this.currentLocation.longitude);
        this.renderAllViews();
        this.showToast('避難所データを最新に更新しました');
      });
    }

    // ソートタブ
    const sortRecommendBtn = document.getElementById('sort-recommend-btn');
    const sortDistanceBtn = document.getElementById('sort-distance-btn');
    if (sortRecommendBtn && sortDistanceBtn) {
      sortRecommendBtn.addEventListener('click', () => {
        sortRecommendBtn.classList.add('active');
        sortDistanceBtn.classList.remove('active');
        this.activeSort = 'recommend';
        this.renderPlacesList();
      });
      sortDistanceBtn.addEventListener('click', () => {
        sortDistanceBtn.classList.add('active');
        sortRecommendBtn.classList.remove('active');
        this.activeSort = 'distance';
        this.renderPlacesList();
      });
    }

    // スマートフィルターチップ (クイック絞り込み)
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.activeFilterChip = e.currentTarget.dataset.filter;
        this.renderPlacesList();
      });
    });

    // 地図センターボタン
    const btnMapCenter = document.getElementById('btn-map-center');
    if (btnMapCenter) {
      btnMapCenter.addEventListener('click', () => {
        if (this.currentLocation) {
          MapManager.updateCurrentLocation(this.currentLocation, true);
        } else {
          this.refreshLocation(true);
        }
      });
    }

    // AR終了
    const btnCloseAR = document.getElementById('btn-close-ar');
    if (btnCloseAR) {
      btnCloseAR.addEventListener('click', () => {
        ARManager.stopAR();
        this.switchTab('home');
      });
    }

    // ARカメラ/レーダー切替
    const btnToggleARCamera = document.getElementById('btn-toggle-ar-camera');
    if (btnToggleARCamera) {
      btnToggleARCamera.addEventListener('click', async () => {
        if (ARManager.isCameraActive) {
          ARManager.stopCamera();
          document.getElementById('ar-container').classList.add('radar-only-mode');
          btnToggleARCamera.textContent = '📷 カメラビュー';
        } else {
          try {
            await ARManager.startCamera();
            document.getElementById('ar-container').classList.remove('radar-only-mode');
            btnToggleARCamera.textContent = '🧭 2Dレーダー';
          } catch (e) {
            this.showToast('カメラを起動できませんでした');
          }
        }
      });
    }

    // 道路ナビ/直線ナビ切替
    const btnToggleARMode = document.getElementById('btn-toggle-ar-mode');
    if (btnToggleARMode) {
      btnToggleARMode.addEventListener('click', () => {
        const newMode = ARManager.toggleNavMode();
        btnToggleARMode.textContent = newMode === 'road' ? '🛣️ 道路交差点ナビ' : '📍 直線直感ナビ';
        this.showToast(newMode === 'road' ? '交差点ターンバイターン案内に切り替えました' : '直線直感案内に切り替えました');
      });
    }

    // モーダル
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => this.closeAllModals());
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.closeAllModals();
      });
    });

    // 状況報告
    document.querySelectorAll('.report-choice-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const reportType = e.currentTarget.dataset.type;
        if (this.selectedPlace && reportType) {
          PlacesManager.addReport(this.selectedPlace.id, reportType);
          this.showToast('状況報告を受理しました。ありがとうございます！');
          this.closeAllModals();
          this.renderAllViews();
        }
      });
    });
  },

  async refreshLocation(showFeedback = false) {
    const locStatusText = document.getElementById('current-location-status');
    const homeCard = document.getElementById('home-top-place-card');

    if (locStatusText) locStatusText.innerHTML = '<span class="loc-spinner"></span> <strong>現在地GPSを高精度測位中...</strong>';
    if (homeCard) {
      homeCard.innerHTML = `
        <div class="loading-spinner-wrap">
          <div class="shimmer-circle"></div>
          <p>あなたの周辺のクーリングシェルターを探索中...</p>
        </div>
      `;
    }

    try {
      const position = await LocationManager.getCurrentPosition();
      this.currentLocation = position;

      if (locStatusText) {
        locStatusText.innerHTML = `📍 <strong>現在地取得完了</strong> <span class="loc-acc">±${Math.round(position.accuracy)}m</span>`;
      }

      MapManager.updateCurrentLocation(this.currentLocation, true);

      await Promise.all([
        PlacesManager.fetchLiveWeather(position.latitude, position.longitude),
        PlacesManager.fetchPlacesByLocation(position.latitude, position.longitude)
      ]);

      this.weatherData = PlacesManager.weather;
      this.renderWeather(this.weatherData);
      this.renderAllViews();

      if (showFeedback) this.showToast('現在地のクーリングシェルターを更新しました');
    } catch (error) {
      console.warn('現在地取得エラー:', error.message);
      if (locStatusText) {
        locStatusText.innerHTML = `⚠️ <strong>位置情報の許可が必要です</strong>`;
      }
      if (homeCard) {
        homeCard.innerHTML = `
          <div class="empty-list-card">
            <div class="empty-icon">📍</div>
            <h4>位置情報の利用が許可されていません</h4>
            <p>あなたのすぐ近くにあるクーリングシェルターを探すため、ブラウザ設定で位置情報を「許可」してください。</p>
            <button class="btn-primary-glow" onclick="window.CoolNaviApp.refreshLocation(true)">
              🔄 再試行する
            </button>
          </div>
        `;
      }
      if (showFeedback) alert(error.message);
    }
  },

  renderWeather(weather) {
    if (!weather) return;
    const tempEl = document.getElementById('weather-temp');
    const maxTempEl = document.getElementById('weather-max-temp');
    const alertEl = document.getElementById('weather-alert-badge');
    const msgEl = document.getElementById('weather-message');
    const humidityEl = document.getElementById('weather-humidity');
    const wbgtEl = document.getElementById('weather-wbgt');

    if (tempEl) tempEl.textContent = `${weather.currentTemp}℃`;
    if (maxTempEl) maxTempEl.textContent = `最高 ${weather.maxTemp}℃`;
    if (humidityEl) humidityEl.textContent = `${weather.humidity || 65}%`;
    if (wbgtEl) wbgtEl.textContent = `${weather.wbgt || 29}℃`;

    if (alertEl) {
      alertEl.textContent = weather.heatStrokeAlert;
      alertEl.className = weather.heatStrokeAlert.includes('危険') ? 'weather-alert danger-high pulse-glow' :
                          weather.heatStrokeAlert.includes('厳重') ? 'weather-alert danger pulse-glow' : 'weather-alert pulse-glow';
    }
    if (msgEl) msgEl.textContent = weather.message;
  },

  renderAllViews() {
    this.renderHomeTopPlace();
    this.renderPlacesList();
    this.renderMapPlaces();
  },

  renderHomeTopPlace() {
    const topPlace = PlacesManager.getTopRecommendedPlace(this.currentLocation);
    const cardEl = document.getElementById('home-top-place-card');
    if (!cardEl) return;

    if (!topPlace) {
      cardEl.innerHTML = '<p class="empty-text">現在地周辺のクーリングシェルターを探索中...</p>';
      return;
    }

    const evalData = topPlace.evaluation;
    // 太陽日陰アドバイス
    const bearing = calculateBearing(this.currentLocation.latitude, this.currentLocation.longitude, topPlace.latitude, topPlace.longitude);
    const shade = getShadeAdvice(bearing, this.currentLocation.latitude, this.currentLocation.longitude);

    cardEl.innerHTML = `
      <div class="top-place-glass">
        <div class="top-place-ribbon">
          <span class="ribbon-glow">🥇 最優先避難シェルター</span>
          <span class="score-badge">${evalData.score}点</span>
        </div>

        <h3 class="top-place-name">${topPlace.name}</h3>

        <div class="top-place-metrics">
          <div class="metric-col">
            <span class="metric-val">約${evalData.walkingMinutes}<small>分</small></span>
            <span class="metric-lbl">徒歩所要時間</span>
          </div>
          <div class="metric-col">
            <span class="metric-val">${evalData.formattedDistance}</span>
            <span class="metric-lbl">実歩行距離</span>
          </div>
          <div class="metric-col">
            <span class="metric-val">${topPlace.capacity || 50}<small>名</small></span>
            <span class="metric-lbl">受入定員</span>
          </div>
        </div>

        <!-- 日陰歩行アシストバナー -->
        <div class="shade-advice-pill">
          <span class="shade-icon">☂️</span>
          <span class="shade-text"><strong>日陰ナビ:</strong> ${shade.text}</span>
        </div>

        <div class="feature-tags-glow">
          <span class="tag-pill-glow ac">❄️ 強冷房</span>
          ${topPlace.waterDispenser ? '<span class="tag-pill-glow water">💧 無料給水</span>' : ''}
          <span class="tag-pill-glow seat">🪑 休憩席</span>
          <span class="tag-pill-glow public">🏛️ 公的指定</span>
        </div>

        <p class="top-place-desc">${topPlace.description}</p>

        ${topPlace.recentReport ? `
          <div class="recent-report-chip">
            💬 直近の状況: <strong>${topPlace.recentReport.label}</strong> (${topPlace.recentReport.timeFormatted})
          </div>
        ` : ''}

        <div class="top-place-actions">
          <button class="btn-primary-glow" onclick="window.CoolNaviApp.startARForPlace('${topPlace.id}')">
            🧭 道路沿いARで避難誘導
          </button>
          <button class="btn-secondary-glass" onclick="window.CoolNaviApp.showPlaceDetail('${topPlace.id}')">
            詳細・設備
          </button>
        </div>
      </div>
    `;
  },

  renderPlacesList() {
    const listEl = document.getElementById('places-list-container');
    if (!listEl) return;

    let evaluatedList = PlacesManager.getEvaluatedPlaces(this.currentLocation, this.activeSort);

    // フィルターチップによる絞り込み
    if (this.activeFilterChip === 'cool') {
      evaluatedList = evaluatedList.filter(p => p.airConditioner);
    } else if (this.activeFilterChip === 'water') {
      evaluatedList = evaluatedList.filter(p => p.waterDispenser);
    } else if (this.activeFilterChip === 'seat') {
      evaluatedList = evaluatedList.filter(p => p.seat);
    } else if (this.activeFilterChip === 'empty') {
      evaluatedList = evaluatedList.filter(p => p.crowdLevel === 'low');
    }

    if (evaluatedList.length === 0) {
      listEl.innerHTML = '<div class="empty-list-card"><p>条件に一致する避難所が見つかりませんでした。</p></div>';
      return;
    }

    listEl.innerHTML = evaluatedList.map((place, index) => {
      const evalData = place.evaluation;
      const rankNumber = index + 1;
      const rankIcon = rankNumber === 1 ? '🥇' : rankNumber === 2 ? '🥈' : rankNumber === 3 ? '🥉' : `${rankNumber}.`;

      return `
        <div class="place-glass-card" data-id="${place.id}">
          <div class="place-card-top">
            <span class="place-rank-badge">${rankIcon}</span>
            <div class="place-title-wrap">
              <h4 class="place-name">${place.name}</h4>
              <div class="place-sub-badges">
                <span class="badge-cooling-score">冷却指数 ${evalData.score}%</span>
                <span class="shelter-authority-pill">${place.designatedAuthority || '指定避難施設'}</span>
              </div>
            </div>
          </div>

          <div class="place-metrics-bar">
            <span class="metric-dist">🚶 <strong>約${evalData.walkingMinutes}分</strong> (${evalData.formattedDistance})</span>
            <span class="metric-capacity">定員: ${place.capacity || 50}名</span>
            <span class="crowd-status crowd-${place.crowdLevel}">
              ${place.crowdLevel === 'low' ? '🟢 ゆったり快適' : place.crowdLevel === 'medium' ? '🟡 適度な混雑' : '🔴 やや混雑'}
            </span>
          </div>

          <div class="feature-tags-glow mini">
            <span class="tag-pill-glow ac">❄️ 冷房</span>
            ${place.waterDispenser ? '<span class="tag-pill-glow water">💧 給水</span>' : ''}
            <span class="tag-pill-glow seat">🪑 座席</span>
            ${place.toilet ? '<span class="tag-pill-glow">🚻 トイレ</span>' : ''}
          </div>

          ${place.recentReport ? `
            <div class="recent-report-chip compact">
              💬 状況: <strong>${place.recentReport.label}</strong>
            </div>
          ` : ''}

          <div class="place-card-actions">
            <button class="card-btn-glass" onclick="window.CoolNaviApp.showPlaceDetail('${place.id}')">
              詳細
            </button>
            <button class="card-btn-glass outline" onclick="window.CoolNaviApp.showOnMap('${place.id}')">
              🗺️ 経路
            </button>
            <button class="card-btn-glow" onclick="window.CoolNaviApp.startARForPlace('${place.id}')">
              🧭 ARナビ
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  renderMapPlaces() {
    const list = PlacesManager.getEvaluatedPlaces(this.currentLocation, 'recommend');
    MapManager.renderPlaceMarkers(list);
  },

  switchTab(tabName) {
    if (this.currentTab === 'ar' && tabName !== 'ar') {
      ARManager.stopAR();
    }

    this.currentTab = tabName;

    document.querySelectorAll('.tab-view').forEach(view => view.classList.remove('active'));
    const targetView = document.getElementById(`tab-view-${tabName}`);
    if (targetView) targetView.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(item => {
      if (item.dataset.tab === tabName) item.classList.add('active');
      else item.classList.remove('active');
    });

    if (tabName === 'map') {
      MapManager.invalidateSize();
      if (this.selectedPlace) {
        this.loadAndDrawRoute(this.selectedPlace);
      }
    }
  },

  async onPlaceMarkerClicked(place) {
    this.selectedPlace = place;
    this.showMapPlaceBanner(place);
    await this.loadAndDrawRoute(place);
  },

  async loadAndDrawRoute(place) {
    if (!this.currentLocation || !place) return;
    try {
      const route = await RoutingManager.getWalkingRoute(
        this.currentLocation.latitude,
        this.currentLocation.longitude,
        place.latitude,
        place.longitude
      );
      this.currentRoute = route;
      MapManager.drawRoadRoute(route, true);
    } catch (e) {
      console.warn('道路ルート取得エラー:', e);
    }
  },

  showMapPlaceBanner(place) {
    const banner = document.getElementById('map-bottom-banner');
    if (!banner) return;

    const evalData = place.evaluation || calculateRecommendationScore(place, this.currentLocation);

    banner.innerHTML = `
      <div class="map-banner-glass">
        <div class="map-banner-header">
          <div>
            <h4>${place.name}</h4>
            <span class="meta">🚶 道路歩行 約${evalData.walkingMinutes}分 (${evalData.formattedDistance}) / 定員: ${place.capacity || 50}名</span>
          </div>
          <button class="banner-close-btn" onclick="document.getElementById('map-bottom-banner').classList.remove('active')">✕</button>
        </div>
        <div class="map-banner-actions">
          <button class="btn-primary-glow" onclick="window.CoolNaviApp.startARForPlace('${place.id}')">
            🧭 道路沿いARで避難開始
          </button>
          <button class="btn-secondary-glass" onclick="window.CoolNaviApp.showPlaceDetail('${place.id}')">
            施設詳細
          </button>
        </div>
      </div>
    `;
    banner.classList.add('active');
  },

  async selectPlaceFromMap(placeId) {
    const place = PlacesManager.getPlaceById(placeId);
    if (!place) return;
    this.selectedPlace = place;
    this.showMapPlaceBanner(place);
    await this.loadAndDrawRoute(place);
  },

  async showOnMap(placeId) {
    const place = PlacesManager.getPlaceById(placeId);
    if (!place) return;
    this.selectedPlace = place;
    this.switchTab('map');
    MapManager.selectDestination(place);
    this.showMapPlaceBanner(place);
    await this.loadAndDrawRoute(place);
  },

  showPlaceDetail(placeId) {
    const place = PlacesManager.getPlaceById(placeId);
    if (!place) return;

    this.selectedPlace = place;
    const evalData = calculateRecommendationScore(place, this.currentLocation);
    const reports = PlacesManager.getReportsForPlace(place.id);

    const modalBody = document.getElementById('modal-place-detail-body');
    if (!modalBody) return;

    const distScore = evalData.distance <= 150 ? 35 : evalData.distance <= 350 ? 30 : evalData.distance <= 700 ? 24 : evalData.distance <= 1200 ? 15 : 8;
    const acScore = place.airConditioner ? 25 : 0;
    const csScore = place.coolingShelter ? 15 : 0;
    const seatScore = place.seat ? 10 : 0;
    const waterScore = place.waterDispenser ? 5 : 0;

    modalBody.innerHTML = `
      <div class="detail-header-glass">
        <div class="shelter-badge-glow">🏛️ ${place.designatedAuthority || '指定暑熱避難施設'}</div>
        <h2>${place.name}</h2>
        <div class="detail-meta-row">
          <span>🚶 徒歩 約<strong>${evalData.walkingMinutes}分</strong> (${evalData.formattedDistance})</span>
          <span>受入定員: <strong>${place.capacity || 50}名</strong></span>
        </div>
      </div>

      <div class="detail-section glass-box">
        <h4>📊 冷却・避難適合指数: <strong>${evalData.score}点</strong></h4>
        <div class="score-bars-glow">
          <div class="score-bar-row">
            <div class="score-label-flex">
              <span>距離・近さ</span>
              <span>${distScore}/35点</span>
            </div>
            <div class="bar-track"><div class="bar-fill dist" style="width: ${(distScore/35)*100}%;"></div></div>
          </div>
          <div class="score-bar-row">
            <div class="score-label-flex">
              <span>強冷房設備</span>
              <span>${acScore}/25点</span>
            </div>
            <div class="bar-track"><div class="bar-fill ac" style="width: ${(acScore/25)*100}%;"></div></div>
          </div>
          <div class="score-bar-row">
            <div class="score-label-flex">
              <span>公的指定・座席</span>
              <span>${csScore + seatScore}/25点</span>
            </div>
            <div class="bar-track"><div class="bar-fill seat" style="width: ${((csScore + seatScore)/25)*100}%;"></div></div>
          </div>
          <div class="score-bar-row">
            <div class="score-label-flex">
              <span>冷水給水</span>
              <span>${waterScore}/5点</span>
            </div>
            <div class="bar-track"><div class="bar-fill water" style="width: ${(waterScore/5)*100}%;"></div></div>
          </div>
        </div>
      </div>

      <div class="detail-section glass-box">
        <h4>🏢 シェルター設備</h4>
        <div class="detail-grid-modern">
          <div class="grid-pill ${place.airConditioner ? 'active' : ''}">
            <span class="icon">❄️</span>
            <span class="text">強冷房完備</span>
          </div>
          <div class="grid-pill ${place.seat ? 'active' : ''}">
            <span class="icon">🪑</span>
            <span class="text">休憩ソファー・座席</span>
          </div>
          <div class="grid-pill ${place.waterDispenser ? 'active' : ''}">
            <span class="icon">💧</span>
            <span class="text">無料冷水・給水機</span>
          </div>
          <div class="grid-pill ${place.toilet ? 'active' : ''}">
            <span class="icon">🚻</span>
            <span class="text">公衆トイレ完備</span>
          </div>
        </div>
      </div>

      <div class="detail-section glass-box">
        <h4>ℹ️ 施設概要</h4>
        <table class="detail-table-clean">
          <tr><th>施設種別</th><td>${place.facilityType || '指定暑熱避難所'}</td></tr>
          <tr><th>所在地</th><td>${place.address}</td></tr>
          <tr><th>受入時間</th><td>${place.openingHours}</td></tr>
          <tr><th>受入定員</th><td>約${place.capacity || 50}名</td></tr>
        </table>
        <p class="detail-desc-box">${place.description}</p>
      </div>

      <div class="detail-section glass-box">
        <div class="report-header-flex">
          <h4>💬 現在の利用状況報告</h4>
          <button class="btn-sm-report-glow" onclick="window.CoolNaviApp.openReportModal()">
            ＋ 状況を投稿
          </button>
        </div>
        ${reports.length > 0 ? `
          <div class="reports-mini-list">
            ${reports.map(r => `
              <div class="report-pill-item">
                <span class="report-tag">${r.label}</span>
                <span class="report-time">${r.timeFormatted || '最近'}</span>
              </div>
            `).join('')}
          </div>
        ` : `
          <p class="empty-reports-text">直近の報告はありません。利用された際はぜひ状況を共有してください。</p>
        `}
      </div>

      <div class="detail-actions-fixed">
        <button class="btn-primary-glow" onclick="window.CoolNaviApp.startARForPlace('${place.id}')">
          🧭 道路沿いARで避難誘導
        </button>
        <button class="btn-secondary-glass" onclick="window.CoolNaviApp.showOnMap('${place.id}')">
          🗺️ 避難経路
        </button>
      </div>
    `;

    document.getElementById('modal-place-detail').classList.add('active');
  },

  openReportModal() {
    if (!this.selectedPlace) return;
    document.getElementById('modal-report-target-name').textContent = this.selectedPlace.name;
    document.getElementById('modal-report').classList.add('active');
  },

  closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
  },

  async startARForPlace(placeId) {
    const place = PlacesManager.getPlaceById(placeId);
    if (!place) return;

    this.selectedPlace = place;
    this.closeAllModals();
    this.switchTab('ar');

    const arTargetName = document.getElementById('ar-target-name');
    if (arTargetName) arTargetName.textContent = place.name;

    let route = this.currentRoute;
    if (!route || route.isRoadNetwork === false) {
      try {
        route = await RoutingManager.getWalkingRoute(
          this.currentLocation.latitude,
          this.currentLocation.longitude,
          place.latitude,
          place.longitude
        );
        this.currentRoute = route;
      } catch (e) {
        console.warn('ARルート取得エラー:', e);
      }
    }

    ARManager.setNavigation(place, this.currentLocation, route);

    try {
      const result = await ARManager.startAR();
      const container = document.getElementById('ar-container');
      const toggleBtn = document.getElementById('btn-toggle-ar-camera');

      if (!result.camera) {
        container.classList.add('radar-only-mode');
        if (toggleBtn) toggleBtn.textContent = '📷 カメラビュー';
        this.showToast('2Dレーダーモードで避難方向を案内します');
      } else {
        container.classList.remove('radar-only-mode');
        if (toggleBtn) toggleBtn.textContent = '🧭 2Dレーダー';
      }
    } catch (e) {
      console.warn('AR起動例外:', e);
    }
  },

  renderAROverlay(state) {
    const arrowEl = document.getElementById('ar-direction-arrow');
    const targetRing = document.getElementById('ar-target-ring');
    const distEl = document.getElementById('ar-distance-text');
    const walkEl = document.getElementById('ar-walking-text');
    const guideEl = document.getElementById('ar-guide-message');
    const compassHeadingEl = document.getElementById('ar-compass-heading');
    const radarIndicator = document.getElementById('radar-target-dot');
    const horizonBar = document.getElementById('ar-horizon-bar');
    const shadeBanner = document.getElementById('ar-shade-banner');

    const turnCard = document.getElementById('ar-turn-card');
    const turnIconEl = document.getElementById('ar-turn-icon');
    const turnTextEl = document.getElementById('ar-turn-instruction');
    const turnStepEl = document.getElementById('ar-turn-step-count');
    const floatingPin = document.getElementById('ar-floating-pin');

    // 1. 中央コンパス矢印の回転 & ロックオン発光
    if (arrowEl) {
      arrowEl.style.transform = `rotate(${state.relativeAngle}deg)`;
      if (state.isStraight) {
        arrowEl.classList.add('locked-on');
        if (targetRing) targetRing.classList.add('locked-on');
      } else {
        arrowEl.classList.remove('locked-on');
        if (targetRing) targetRing.classList.remove('locked-on');
      }
    }

    // 2. ジャイロ地平線インジケーター (ロール傾きに追従)
    if (horizonBar) {
      horizonBar.style.transform = `rotate(${-state.roll}deg) translateY(${state.screenYPercent * 2}px)`;
    }

    // 3. ターンバイターン指示カード
    if (turnCard && state.currentStepInfo) {
      turnCard.style.display = 'flex';
      if (turnIconEl) turnIconEl.textContent = state.turnIcon;
      if (turnTextEl) turnTextEl.textContent = state.stepInstruction;
      if (turnStepEl) {
        turnStepEl.textContent = `交差点 ${state.currentStepInfo.stepIndex + 1} / ${state.currentStepInfo.totalSteps}`;
      }
    }

    // 4. 日陰アシストバナー
    if (shadeBanner && state.shadeAdvice) {
      shadeBanner.textContent = `☂️ ${state.shadeAdvice.text}`;
    }

    // 5. 3D空間浮遊ピン
    if (floatingPin) {
      if (state.isVisibleInScreen && state.isCameraActive) {
        floatingPin.style.display = 'flex';
        floatingPin.style.transform = `translate(${state.screenXPercent * 3.8}px, ${state.screenYPercent * 2.2}px)`;
        const pinTitle = floatingPin.querySelector('.pin-title');
        const pinDist = floatingPin.querySelector('.pin-dist');
        if (pinTitle) pinTitle.textContent = state.destination.name;
        if (pinDist) pinDist.textContent = `あと ${state.formattedFinalDistance}`;
      } else {
        floatingPin.style.display = 'none';
      }
    }

    if (distEl) distEl.textContent = `あと ${state.formattedFinalDistance}`;
    if (walkEl) walkEl.textContent = `徒歩 約${state.walkingMinutes}分`;
    if (guideEl) guideEl.textContent = state.directionText;
    if (compassHeadingEl) {
      compassHeadingEl.textContent = `HEADING ${Math.round(state.heading)}° | BEARING ${Math.round(state.targetBearing)}°`;
    }

    if (radarIndicator) {
      const rad = (state.relativeAngle - 90) * (Math.PI / 180);
      const radius = 64;
      const x = Math.cos(rad) * radius;
      const y = Math.sin(rad) * radius;
      radarIndicator.style.transform = `translate(${x}px, ${y}px)`;
    }
  },

  showToast(message) {
    const existing = document.querySelector('.cool-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'cool-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  window.CoolNaviApp.init();
});

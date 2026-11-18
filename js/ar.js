/**
 * ar.js - 未来型高性能ARナビゲーション (HUD / ジャイロ地平線 / クリスタルサウンド / ハプティクス)
 */

const SoundFX = {
  ctx: null,

  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
  },

  // 涼やかで透明感のあるクリスタル音 (起動・ロックオン時)
  playChime(freq = 880, type = 'sine', duration = 0.25) {
    try {
      this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, this.ctx.currentTime + duration);

      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {}
  },

  // 正面ロックオン音
  playLockOn() {
    this.playChime(1046.5, 'sine', 0.15); // C6 高音
  }
};

const ARManager = {
  videoElement: null,
  stream: null,
  isCameraActive: false,
  isOrientationActive: false,
  orientationPermissionGranted: false,

  currentDestination: null,
  currentLocation: null,
  currentRoute: null,
  navMode: 'road',

  deviceHeading: 0,
  devicePitch: 0,
  deviceRoll: 0,

  wasStraight: false, // 前フレームで正面だったか (ロックオン音のトリガー)
  onUpdateCallback: null,

  init(videoEl, onUpdate = null) {
    this.videoElement = videoEl;
    this.onUpdateCallback = onUpdate;
  },

  setNavigation(destination, currentLocation, route = null) {
    this.currentDestination = destination;
    this.currentLocation = currentLocation;
    this.currentRoute = route;
    this.updateARState();
  },

  updateLocation(location) {
    this.currentLocation = location;
    if (this.currentRoute && this.navMode === 'road') {
      RoutingManager.updateCurrentStep(location);
    }
    this.updateARState();
  },

  async startAR() {
    let cameraSuccess = false;
    let orientationSuccess = false;

    SoundFX.init();
    orientationSuccess = await this.startOrientationTracking();

    try {
      cameraSuccess = await this.startCamera();
      SoundFX.playChime(659.25, 'sine', 0.35); // 起動音
    } catch (e) {
      console.warn("カメラ起動スキップ/失敗:", e);
      cameraSuccess = false;
    }

    return { camera: cameraSuccess, orientation: orientationSuccess };
  },

  async startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("カメラAPI非対応です。");
    }

    this.stopCamera();

    const constraints = {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (this.videoElement) {
      this.videoElement.srcObject = this.stream;
      this.videoElement.setAttribute('playsinline', 'true');
      await this.videoElement.play();
    }
    this.isCameraActive = true;
    return true;
  },

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.srcObject = null;
    }
    this.isCameraActive = false;
  },

  async startOrientationTracking() {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission === 'granted') {
          this.orientationPermissionGranted = true;
        } else {
          return false;
        }
      } catch (err) {
        return false;
      }
    } else {
      this.orientationPermissionGranted = true;
    }

    this.handleOrientation = this.handleOrientation.bind(this);
    window.addEventListener('deviceorientation', this.handleOrientation, true);
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', this.handleOrientation, true);
    }

    this.isOrientationActive = true;
    return true;
  },

  handleOrientation(event) {
    let heading = null;

    if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
      heading = event.webkitCompassHeading;
    } else if (event.alpha !== null && event.alpha !== undefined) {
      heading = (360 - event.alpha) % 360;
    }

    if (heading !== null) {
      this.deviceHeading = heading;
      this.devicePitch = event.beta || 0;
      this.deviceRoll = event.gamma || 0;
      this.updateARState();
    }
  },

  stopOrientationTracking() {
    if (this.handleOrientation) {
      window.removeEventListener('deviceorientation', this.handleOrientation, true);
      window.removeEventListener('deviceorientationabsolute', this.handleOrientation, true);
    }
    this.isOrientationActive = false;
  },

  stopAR() {
    this.stopCamera();
    this.stopOrientationTracking();
  },

  toggleNavMode() {
    this.navMode = (this.navMode === 'road') ? 'direct' : 'road';
    this.updateARState();
    return this.navMode;
  },

  updateARState() {
    if (!this.currentDestination || !this.currentLocation) {
      return;
    }

    const finalDistance = calculateDistance(
      this.currentLocation.latitude,
      this.currentLocation.longitude,
      this.currentDestination.latitude,
      this.currentDestination.longitude
    );
    const finalBearing = calculateBearing(
      this.currentLocation.latitude,
      this.currentLocation.longitude,
      this.currentDestination.latitude,
      this.currentDestination.longitude
    );

    let targetLat = this.currentDestination.latitude;
    let targetLon = this.currentDestination.longitude;
    let targetDistance = finalDistance;
    let targetBearing = finalBearing;
    let currentStepInfo = null;
    let turnAction = "straight";
    let turnIcon = "↑";
    let stepInstruction = "避難シェルターへ向かって進んでください";

    if (this.navMode === 'road' && this.currentRoute && this.currentRoute.steps) {
      const stepState = RoutingManager.updateCurrentStep(this.currentLocation);
      if (stepState && stepState.currentStep) {
        currentStepInfo = stepState;
        const step = stepState.currentStep;
        targetLat = step.location[0];
        targetLon = step.location[1];
        targetDistance = stepState.distanceToNextStep;
        targetBearing = calculateBearing(
          this.currentLocation.latitude,
          this.currentLocation.longitude,
          targetLat,
          targetLon
        );
        stepInstruction = step.instruction;
        turnIcon = step.actionIcon;
        turnAction = step.modifier;
      }
    }

    let relativeAngle = (targetBearing - this.deviceHeading + 360) % 360;
    if (relativeAngle > 180) relativeAngle -= 360;

    let directionText = "この方向へ直進";
    let isStraight = false;

    if (Math.abs(relativeAngle) <= 15) {
      directionText = "【正面】直進してください";
      isStraight = true;
      // ロックオン時サウンド & バイブレーション
      if (!this.wasStraight) {
        SoundFX.playLockOn();
        if (navigator.vibrate) navigator.vibrate(20);
      }
    } else if (relativeAngle > 15 && relativeAngle <= 65) {
      directionText = "ななめ右方向 ↗";
    } else if (relativeAngle > 65 && relativeAngle <= 115) {
      directionText = "右を向いてください ➔";
    } else if (relativeAngle > 115 && relativeAngle <= 160) {
      directionText = "右うしろ方向 ↘";
    } else if (relativeAngle < -15 && relativeAngle >= -65) {
      directionText = "ななめ左方向 ↖";
    } else if (relativeAngle < -65 && relativeAngle >= -115) {
      directionText = "左を向いてください ⬅";
    } else if (relativeAngle < -115 && relativeAngle >= -160) {
      directionText = "左うしろ方向 ↙";
    } else {
      directionText = "後ろを向いてください ↷";
    }

    this.wasStraight = isStraight;

    // 3D空間浮遊ピンのスクリーン投影 (FOV 65度)
    const horizontalFov = 65;
    let screenXPercent = (relativeAngle / (horizontalFov / 2)) * 50;
    const isVisibleInScreen = Math.abs(relativeAngle) < (horizontalFov / 2);

    const targetPitch = 75; // スマホ垂直持ち
    const pitchDiff = (this.devicePitch - targetPitch);
    let screenYPercent = Math.max(-38, Math.min(38, pitchDiff * 0.7));

    // 日陰歩行アドバイス
    const shadeAdvice = getShadeAdvice(targetBearing, this.currentLocation.latitude, this.currentLocation.longitude);

    const state = {
      destination: this.currentDestination,
      navMode: this.navMode,
      targetDistance,
      formattedTargetDistance: formatDistance(targetDistance),
      finalDistance,
      formattedFinalDistance: formatDistance(finalDistance),
      walkingMinutes: calculateWalkingMinutes(finalDistance),
      targetBearing,
      finalBearing,
      heading: this.deviceHeading,
      pitch: this.devicePitch,
      roll: this.deviceRoll,
      relativeAngle,
      directionText,
      turnIcon,
      turnAction,
      stepInstruction,
      currentStepInfo,
      isStraight,
      screenXPercent,
      screenYPercent,
      isVisibleInScreen,
      shadeAdvice,
      isCameraActive: this.isCameraActive,
      isOrientationActive: this.isOrientationActive
    };

    if (this.onUpdateCallback) {
      this.onUpdateCallback(state);
    }

    return state;
  }
};

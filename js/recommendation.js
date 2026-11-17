/**
 * recommendation.js - 距離計算・クーリングシェルター総合評価・日陰案内ロジック
 */

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateWalkingMinutes(distanceMeters) {
  if (!distanceMeters || distanceMeters <= 0) return 1;
  return Math.max(1, Math.ceil(distanceMeters / 80));
}

function formatDistance(distanceMeters) {
  if (distanceMeters === null || distanceMeters === undefined || isNaN(distanceMeters)) {
    return "-- m";
  }
  if (distanceMeters < 1000) {
    return `${Math.round(distanceMeters)}m`;
  }
  return `${(distanceMeters / 1000).toFixed(1)}km`;
}

function calculateBearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos((lon2 - lon1) * Math.PI / 180);
  const bearingRad = Math.atan2(y, x);
  return (bearingRad * 180 / Math.PI + 360) % 360;
}

/**
 * 太陽の位置（方位角・高度）を現在時刻と緯度経度から簡易推定
 * 日陰歩行ナビゲーションに使用
 */
function getSunPosition(lat, lon, date = new Date()) {
  const hours = date.getHours() + date.getMinutes() / 60;
  // 太陽は正午(12時)に真南(180度)にあると近似
  const hourAngle = (hours - 12) * 15; // 1時間で15度
  const azimuth = (180 + hourAngle + 360) % 360; // 太陽の方位角(度)
  
  // 太陽高度(度): 正午をピークに簡易サイン波で近似
  const peakAltitude = 90 - lat + 23.45; // 夏至付近
  const altitude = Math.max(0, Math.sin((hours - 6) / 12 * Math.PI) * peakAltitude);

  return { azimuth, altitude };
}

/**
 * 進行方向(bearing)と太陽の位置から「日陰のアドバイス」を生成
 */
function getShadeAdvice(bearing, lat = 35.68, lon = 139.76) {
  const sun = getSunPosition(lat, lon);
  if (sun.altitude < 5) {
    return { side: "neutral", text: "直射日光は弱まっています。安全に進んでください。" };
  }

  // 進行方向に対する太陽の相対角度
  let relAngle = (sun.azimuth - bearing + 360) % 360;
  if (relAngle > 180) relAngle -= 360;

  if (Math.abs(relAngle) < 30) {
    return { side: "front", text: "正面から強い直射日光。日傘や建物の影を意識して歩きましょう。" };
  } else if (Math.abs(relAngle) > 150) {
    return { side: "back", text: "背後からの日差し。自分の影を前に見ながら進めます。" };
  } else if (relAngle > 0) {
    // 太陽は右側にある -> 道路の「左側」が建物の日陰になる
    return { side: "left", text: "道の【左側】が建物の日陰です。左寄りを歩くと涼しく移動できます。" };
  } else {
    // 太陽は左側にある -> 道路の「右側」が日陰
    return { side: "right", text: "道の【右側】が建物の日陰です。右寄りを歩くと涼しく移動できます。" };
  }
}

/**
 * クーリングシェルター総合おすすめスコアを計算
 */
function calculateRecommendationScore(place, currentLocation) {
  let score = 0;
  const tags = [];
  const reasons = [];

  // 1. 距離スコア (最大35点)
  let distance = 0;
  if (currentLocation && currentLocation.latitude && currentLocation.longitude) {
    distance = calculateDistance(
      currentLocation.latitude,
      currentLocation.longitude,
      place.latitude,
      place.longitude
    );

    if (distance <= 150) {
      score += 35;
      reasons.push("すぐ目の前");
    } else if (distance <= 350) {
      score += 30;
      reasons.push("歩いてすぐ");
    } else if (distance <= 700) {
      score += 24;
    } else if (distance <= 1200) {
      score += 15;
    } else if (distance <= 1800) {
      score += 8;
    } else {
      score += 2;
    }
  } else {
    score += 20;
  }

  // 2. 冷房設備 (最大25点)
  if (place.airConditioner) {
    score += 25;
    tags.push("強冷房完備");
  }

  // 3. クーリングシェルター公的指定 (最大15点)
  if (place.coolingShelter) {
    score += 15;
    tags.push("指定暑熱避難施設");
    reasons.push("公的避難シェルター");
  }

  // 4. 休憩座席 (最大10点)
  if (place.seat) {
    score += 10;
    tags.push("休憩座席あり");
  }

  // 5. 冷水機・給水スポット (最大5点)
  if (place.waterDispenser) {
    score += 5;
    tags.push("無料給水スポット");
  }

  // 6. 屋内施設 (最大5点)
  if (place.indoor) {
    score += 5;
    tags.push("完全屋内");
  }

  // 7. 混雑度 (最大5点)
  if (place.crowdLevel === 'low') {
    score += 5;
    tags.push("空いていて快適");
    reasons.push("ゆったり休憩可能");
  } else if (place.crowdLevel === 'medium') {
    score += 3;
    tags.push("適度な利用状況");
  }

  score = Math.min(100, Math.max(0, Math.round(score)));

  let rank = "通常";
  let badgeClass = "badge-normal";

  if (score >= 85) {
    rank = "最優先おすすめ避難先";
    badgeClass = "badge-super";
  } else if (score >= 70) {
    rank = "快適避難シェルター";
    badgeClass = "badge-high";
  } else if (score >= 50) {
    rank = "休憩可能スポット";
    badgeClass = "badge-mid";
  }

  return {
    score,
    rank,
    badgeClass,
    tags,
    distance,
    walkingMinutes: calculateWalkingMinutes(distance),
    formattedDistance: formatDistance(distance),
    primaryReason: reasons.length > 0 ? reasons.join('・') : "暑熱避難所"
  };
}

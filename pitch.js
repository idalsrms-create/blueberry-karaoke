// ───────────────────────────────────────────────────────────────
// 소리에서 음 높낮이(F0)를 뽑는다. McLeod Pitch Method(NSDF) 직접 구현.
//
// 왜 직접 짜는가: 의존성 0, 임계값을 직접 손볼 수 있다.
// 왜 NSDF인가: 순수 자기상관은 소리가 커질수록 값도 커져서 "이 값이면 믿는다"는
//   임계값을 정할 수 없다. NSDF는 -1~1로 정규화돼 있어 기준이 선다.
// 근거와 측정값은 DESIGN.md 4.1 참고.
//
// 나중에 더 정확한 것(pitchy, CREPE 등)으로 바꾸고 싶으면 detectPitch 하나만 갈아끼우면 된다.
// ───────────────────────────────────────────────────────────────

// 말소리 F0는 대략 남 75~180Hz, 여 160~300Hz. 여유를 둬 70~450Hz만 본다.
// 범위를 좁히면 계산량이 줄고, 배음을 F0로 잘못 집는 사고도 줄어든다.
export const MIN_F = 70;
export const MAX_F = 450;

// 16kHz로 받는다. 말소리 F0에는 차고 넘치고, 48kHz 그대로면 계산량이 약 9배가 된다
// (자기상관 비용이 창 길이의 제곱으로 는다).
export const SR = 16000;

// 1024 샘플 = 64ms. 최저 70Hz(주기 14ms)도 4주기 넘게 담긴다.
export const WIN = 1024;

// 이보다 조용하면 "무성"으로 보고 음높이를 내놓지 않는다.
export const RMS_GATE = 0.008;

const nsdf = new Float32Array((WIN >> 1) + 2);

export function detectPitch(buf, sampleRate) {
  const N = buf.length;

  let sum = 0;
  for (let i = 0; i < N; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / N);
  if (rms < RMS_GATE) return { f0: 0, clarity: 0, rms };

  const maxTau = Math.min(N >> 1, Math.floor(sampleRate / MIN_F));
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_F));

  // NSDF: n(tau) = 2 * sum(x[i]*x[i+tau]) / sum(x[i]^2 + x[i+tau]^2)
  for (let tau = 0; tau <= maxTau; tau++) {
    let ac = 0, m = 0;
    for (let i = 0, n = N - tau; i < n; i++) {
      const a = buf[i], b = buf[i + tau];
      ac += a * b;
      m += a * a + b * b;
    }
    nsdf[tau] = m > 0 ? (2 * ac) / m : 0;
  }

  // 0을 아래에서 위로 가로지르는 지점들 사이의 봉우리(key maxima)를 모은다.
  // tau=0 근처의 첫 봉우리(항상 1.0)는 건너뛴다.
  let tau = 1;
  while (tau < maxTau && nsdf[tau] > 0) tau++;
  while (tau < maxTau && nsdf[tau] <= 0) tau++;

  let best = -1, bestTau = -1, peakTau = -1, peakVal = -1, inPeak = false;
  const peaks = [];
  for (; tau < maxTau; tau++) {
    if (nsdf[tau] > 0) {
      if (!inPeak) { inPeak = true; peakVal = -1; }
      if (nsdf[tau] > peakVal) { peakVal = nsdf[tau]; peakTau = tau; }
    } else if (inPeak) {
      peaks.push([peakTau, peakVal]);
      if (peakVal > best) { best = peakVal; bestTau = peakTau; }
      inPeak = false;
    }
  }
  if (inPeak && peakTau > 0) {
    peaks.push([peakTau, peakVal]);
    if (peakVal > best) { best = peakVal; bestTau = peakTau; }
  }
  if (bestTau < 0) return { f0: 0, clarity: 0, rms };

  // 핵심: "가장 높은 봉우리"가 아니라 "충분히 높은 것 중 가장 이른 봉우리"를 고른다.
  // 가장 높은 걸 고르면 한 옥타브 아래(주기 2배 지점)를 집는 사고가 난다.
  const thresh = 0.88 * best;
  let chosen = bestTau;
  for (let k = 0; k < peaks.length; k++) {
    if (peaks[k][1] >= thresh) { chosen = peaks[k][0]; break; }
  }
  if (chosen < minTau) return { f0: 0, clarity: 0, rms };

  // 포물선 보간: 샘플 한 칸 단위로는 고음에서 오차가 크다. 꼭짓점을 소수점까지 찾는다.
  const y0 = chosen > 0 ? nsdf[chosen - 1] : 0;
  const y1 = nsdf[chosen];
  const y2 = nsdf[chosen + 1] || 0;
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom !== 0 ? (y2 - y0) / denom : 0;
  const tauI = chosen + Math.max(-1, Math.min(1, shift));

  const f0 = sampleRate / tauI;
  if (f0 < MIN_F || f0 > MAX_F) return { f0: 0, clarity: 0, rms };
  return { f0, clarity: y1, rms };
}

// Hz → 반음. 사람 귀는 음높이를 비율로 듣는다. Hz 차이로 재면 고음 쪽이 과대평가된다.
export const toMidi = (f) => 69 + 12 * Math.log2(f / 440);

// 중앙값. 평균이 아니라 중앙값인 이유: 옥타브 오검출이 한두 개 섞이면
// 평균은 통째로 끌려가지만 중앙값은 안 흔들린다. (DESIGN.md 5장)
export function median(arr) {
  if (!arr.length) return 0;
  const a = Float64Array.from(arr).sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

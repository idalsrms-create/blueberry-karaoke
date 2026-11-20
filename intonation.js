// ───────────────────────────────────────────────────────────────
// 문장 → "임시 기준 억양 막대"
//
// ⚠️⚠️ 아주 중요한 전제 ⚠️⚠️
// 여기서 만든 막대는 **정답이 아니다.** 한국어 억양의 "기본형"일 뿐이다.
// 진짜 기준은 진행자가 직접 읽은 녹음이다. (DESIGN.md 3장의 결정)
// 이 파일은 그 녹음이 생기기 전까지 화면에 뭔가 띄우기 위한, 그리고
// 나중에 녹음 위에 흐리게 겹쳐 "이상하면 눈에 띄게" 하기 위한 보조 바퀴다.
//
// 근거: Jun Sun-Ah의 K-ToBI. 서울말 억양은 음절마다 정해진 음높이가 아니라
// 어절 묶음(강세구, Accentual Phrase = AP) 단위의 흐름이다.
//   - AP 기본 성조형: T H L H
//   - T는 AP 첫 자음이 격음(ㅍㅌㅋㅊ)·경음(ㅃㄸㄲㅉㅆ)·ㅅ·ㅎ 이면 H, 아니면 L
//   - 문장 끝은 더 큰 단위(억양구 IP)의 경계 성조가 정한다: 평서 L%, 의문 H%
// 자세히: DESIGN.md 2장
// ───────────────────────────────────────────────────────────────

// 한글 초성 19개 (유니코드 순서 그대로)
const CHOSEONG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

// 이 소리로 시작하면 AP가 높은 음(H)으로 출발한다.
// 격음 ㅊㅋㅌㅍ + 경음 ㄲㄸㅃㅆㅉ + ㅅ + ㅎ
const H_INITIAL = new Set(['ㄲ','ㄸ','ㅃ','ㅅ','ㅆ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ']);

/** 한글 음절의 초성을 돌려준다. 한글이 아니면 null. */
export function choseong(ch) {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c > 11171) return null;
  return CHOSEONG[Math.floor(c / 588)];
}

/** AP의 첫 소리를 보고 시작 성조 T를 정한다. 글자만 보고 확실히 계산되는 몇 안 되는 부분. */
export function startTone(word) {
  const cho = choseong(word[0]);
  if (cho === null) return 'L';        // 한글이 아니면 평범하게 L로 본다
  return H_INITIAL.has(cho) ? 'H' : 'L';
}

// 성조 → 반음 높이. 서울말 AP의 오르내림 폭은 대략 4~6반음이다.
const TONE_ST = { H: 3, L: -3 };

/**
 * AP 하나(n음절)의 음절별 성조를 정한다.
 * n >= 4 이면 T H ... L H 로 앞 둘·뒤 둘에 붙고 가운데는 비운다(이어서 직선으로 잇는다).
 * n <= 3 이면 성조가 다 실리지 못하고 일부가 떨어져 나간다.
 *
 * ❓ 짧은 AP에서 어느 성조가 떨어져 나가는지는 문헌마다 조금씩 다르고
 *    화자에 따라서도 달라진다. 아래 2·3음절 처리는 **근사**다.
 *    정식 녹음을 쌓은 뒤 실제와 비교해 고쳐야 한다. (DESIGN.md 3장 3단계)
 */
function tonesForAP(n, T) {
  const t = new Array(n).fill(null);
  if (n >= 4) {
    t[0] = T; t[1] = 'H'; t[n - 2] = 'L'; t[n - 1] = 'H';
  } else if (n === 3) {
    t[0] = T; t[1] = 'L'; t[2] = 'H';
  } else if (n === 2) {
    t[0] = T; t[1] = 'H';
  } else {
    t[0] = T === 'H' ? 'H' : 'L';
  }
  return t;
}

// 음절 길이(초). 거칠지만 노래방 막대를 그리기엔 충분하다.
// ❓ 진짜 길이는 녹음에서 재야 한다. 지금은 균등 + 끝만 늘리는 근사.
const SYL = 0.26;        // 보통 음절
const AP_LAST = 1.3;     // 어절 끝 음절은 조금 길게
const IP_LAST = 1.9;     // 문장 끝 음절은 더 길게
const AP_GAP = 0.13;     // 어절 사이 숨

/**
 * 문장을 받아 노래방 막대 목록을 만든다.
 *
 * @param {string} sentence
 * @returns {{bars:Array, aps:Array, total:number, note:string}}
 *   bars: [{ syl, t0, dur, st, tone, ap, i }]
 */
export function buildReference(sentence) {
  // 띄어쓰기 = 어절. 그 하나하나를 AP로 본다.
  // ❓ 실제로는 짧은 어절 둘이 한 AP로 묶이기도 한다(예: "밥을 먹었다" → 한 덩어리).
  //    그 묶음 규칙은 형태소 분석이 있어야 제대로 되므로 지금은 어절 = AP로 둔다.
  //
  // 글자 위치(charIndex)도 같이 들고 간다. TTS의 onboundary가 charIndex로 어절 시작 시각을
  // 알려 주기 때문에, 그걸 받아 막대 길이를 실제 발화에 맞추려면 이 값이 필요하다. (tts.js)
  const matches = [...sentence.matchAll(/\S+/g)];
  const words = matches.map((m) => m[0]);
  const offsets = matches.map((m) => m.index);
  if (!words.length) return { bars: [], aps: [], total: 0, note: '' };

  // 문장 끝 억양: 물음표면 올리고(H%), 아니면 내린다(L%).
  const isQuestion = /[?？]\s*$/.test(sentence.trim());
  const boundary = isQuestion ? 'H' : 'L';

  const bars = [];
  const aps = [];
  let t = 0;
  let idx = 0;

  words.forEach((rawWord, w) => {
    // 문장부호는 막대로 그리지 않는다. 성조 판단에서도 뺀다.
    const word = rawWord.replace(/[.,!?！？…·"'()]/g, '');
    if (!word) return;

    const n = word.length;
    const T = startTone(word);
    const tones = tonesForAP(n, T);
    const isLastWord = w === words.length - 1;
    if (isLastWord) tones[n - 1] = boundary; // 문장 끝은 IP 경계 성조가 이긴다

    // 자연 하강(declination): 말이 뒤로 갈수록 전체 음높이가 조금씩 내려간다.
    // 잘 알려진 현상이라 넣는다. 끝없이 내려가지 않게 -4반음에서 멈춘다.
    const drift = Math.max(-4, -0.7 * w);

    // 성조가 붙은 음절만 높이를 알고, 빈 가운데는 앞뒤를 직선으로 잇는다.
    const st = new Array(n).fill(null);
    tones.forEach((tone, i) => { if (tone) st[i] = TONE_ST[tone] + drift; });
    for (let i = 0; i < n; i++) {
      if (st[i] !== null) continue;
      let a = i - 1; while (a >= 0 && st[a] === null) a--;
      let b = i + 1; while (b < n && st[b] === null) b++;
      if (a < 0 && b >= n) st[i] = drift;
      else if (a < 0) st[i] = st[b];
      else if (b >= n) st[i] = st[a];
      else st[i] = st[a] + ((st[b] - st[a]) * (i - a)) / (b - a);
    }

    const apStart = t;
    for (let i = 0; i < n; i++) {
      let dur = SYL;
      if (i === n - 1) dur *= isLastWord ? IP_LAST : AP_LAST;
      bars.push({
        syl: word[i],
        t0: t,
        dur,
        st: st[i],
        tone: tones[i],
        ap: aps.length,
        i: idx++,
      });
      t += dur;
    }
    aps.push({
      word, T, from: apStart, to: t,
      charIndex: offsets[w],
      pattern: tones.map((x) => x || '·').join(''),
    });
    t += AP_GAP;
  });

  return {
    bars,
    aps,
    total: Math.max(0, t - AP_GAP),
    note: aps.map((a) => `${a.word}(${a.T}${a.pattern.slice(1)})`).join(' '),
  };
}

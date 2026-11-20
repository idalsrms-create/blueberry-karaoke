// ───────────────────────────────────────────────────────────────
// 문장을 소리로 읽어 주기 (브라우저 내장 speechSynthesis)
//
// 억양은 눈으로 배우는 것보다 귀로 듣고 흉내 내는 쪽이 훨씬 빠르다.
// 기준을 먼저 들려주고 나서 읽게 하는 흐름이 맞다.
//
// ⚠️ 여기서 낸 소리는 **붙잡을 수 없다.** speechSynthesis는 오디오 스트림을 주지 않는다.
//    (utterance가 가진 것은 text·lang·voice·volume·rate·pitch 뿐 — 출력 노드가 없다)
//    그래서 "TTS 소리에서 피치를 뽑아 기준 곡선으로 쓴다"는 방법은 이 API로는 불가능하다.
//    자세한 조사 결과와 대안은 DESIGN.md 3.5장.
//
// 대신 얻을 수 있는 게 하나 있다 → onboundary. 어절이 언제 시작되는지 시간을 알려 준다.
// 높낮이는 못 얻어도 **박자는 공짜로 얻는다.** 그걸 막대 길이에 쓴다.
// ───────────────────────────────────────────────────────────────

// ⚠️ speechSynthesis가 아예 없는 브라우저가 있다.
//    카카오톡·인스타그램 같은 앱 안에서 열리는 브라우저가 대표적이다(2026-11 확인).
//    없는 걸 그냥 부르면 ReferenceError가 나고, 그게 async 함수 안이면
//    조용한 promise 거절이 되어 **그 기능만이 아니라 그 함수 전체가 죽는다.**
//    실제로 start()의 첫 줄이 stopSpeaking()이라 시작 버튼이 통째로 먹통이 됐다.
//    그래서 여기서 한 번만 확인하고, 없으면 조용히 아무 일도 안 하는 쪽을 택한다.
const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;

/** 이 브라우저가 소리로 읽어 줄 수 있는가. 화면에서 듣기 기능을 켤지 끌지 판단하는 데 쓴다. */
export const canSpeak = !!synth;

/** 음성 목록은 비동기로 채워진다. 채워질 때까지 기다린다. */
export function loadVoices(timeoutMs = 2500) {
  if (!synth) return Promise.resolve([]); // 음성이 없는 게 아니라, 읽어 주는 기능 자체가 없다
  return new Promise((resolve) => {
    const got = speechSynthesis.getVoices();
    if (got.length) return resolve(got);
    const t0 = Date.now();
    const iv = setInterval(() => {
      const v = speechSynthesis.getVoices();
      if (v.length || Date.now() - t0 > timeoutMs) { clearInterval(iv); resolve(v); }
    }, 100);
    speechSynthesis.addEventListener('voiceschanged', () => {
      const v = speechSynthesis.getVoices();
      if (v.length) { clearInterval(iv); resolve(v); }
    }, { once: true });
  });
}

// 음성 이름으로 성별을 추측한다.
// ❓ 표준이 없다. SpeechSynthesisVoice에는 성별 항목 자체가 없어서 이름으로 맞히는 수밖에 없다.
//    아래 목록에 없는 음성은 "알 수 없음"으로 두고 이름을 그대로 보여 준다. 멋대로 찍지 않는다.
const MALE_NAMES = /injoon|인준|인준이|minsu|민수|jihoon|지훈|male|남성|남자/i;
const FEMALE_NAMES = /heami|해미|sunhi|선히|yuna|유나|sora|소라|지민|female|여성|여자|한국의/i;

export function genderOf(voice) {
  if (MALE_NAMES.test(voice.name)) return 'male';
  if (FEMALE_NAMES.test(voice.name)) return 'female';
  return 'unknown';
}

/** 한국어 음성만 골라 성별로 나눈다. */
export function pickKorean(voices) {
  const ko = voices.filter((v) => /^ko/i.test(v.lang));
  return {
    all: ko,
    male: ko.filter((v) => genderOf(v) === 'male'),
    female: ko.filter((v) => genderOf(v) === 'female'),
    unknown: ko.filter((v) => genderOf(v) === 'unknown'),
  };
}

/**
 * 읽어 주고, 어절이 시작된 시각을 모아서 돌려준다.
 *
 * @returns {Promise<{boundaries:Array<{charIndex:number,elapsed:number}>, duration:number}>}
 *   elapsed/duration 단위는 밀리초. boundaries가 비어 있으면 이 브라우저가
 *   단어 경계를 안 알려 준다는 뜻이다(명세상 선택 사항이다).
 */
export function speak(text, opts = {}) {
  if (!synth) {
    return Promise.reject(new Error('이 브라우저는 소리로 읽어 주는 기능이 없습니다. 크롬이나 사파리로 직접 열어 주세요.'));
  }
  return new Promise((resolve, reject) => {
    speechSynthesis.cancel(); // 겹쳐 읽는 사고 방지
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    if (opts.voice) u.voice = opts.voice;
    u.pitch = opts.pitch ?? 1;
    u.rate = opts.rate ?? 1;
    u.volume = opts.volume ?? 1;

    const boundaries = [];
    const t0 = performance.now();
    u.onboundary = (e) => {
      if (e.name === 'word') boundaries.push({ charIndex: e.charIndex, elapsed: e.elapsedTime });
    };
    u.onend = () => resolve({ boundaries, duration: performance.now() - t0 });
    u.onerror = (e) => reject(new Error(e.error || 'speech error'));
    if (opts.onStart) u.onstart = opts.onStart;

    speechSynthesis.speak(u);
  });
}

// 읽어 주는 기능이 없는 브라우저에서는 멈출 것도 없다. 조용히 넘어간다.
// 이 함수는 start()의 첫 줄에서 불린다 — 여기서 터지면 연습 자체가 시작되지 않는다.
export const stopSpeaking = () => { if (synth) synth.cancel(); };

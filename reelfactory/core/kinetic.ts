import type { CaptionWord } from './caption-pages';

/**
 * КИНЕТИЧЕСКИЕ СУБТИТРЫ: ИЗ СЛОВ — ВО ФРАЗЫ.
 *
 * Фраза — блок из одной-трёх строк: одно ударное слово крупно, остальные мелко
 * над ним и под ним. Слова проявляются по одному ровно в кадр, когда звучат.
 *
 * Фразы задаёт план субтитров ролика (`captionPlan` в описании ролика). Плана
 * нет — фразы и ударные слова система подбирает сама.
 *
 * Разметка строки плана:
 *
 *   ^       в начале — фраза сверху кадра (на камерных блоках)
 *   /       перенос строки
 *   *слово* ударное слово, одно на фразу
 *   @push   медленный наезд камеры на всю фразу
 *   @punch  резкий толчок камеры на ударном слове
 *   @wide   скачок камеры обратно на общий план в начале фразы
 *
 * Слова плана идут в том же порядке, что в `captions.json`, и их столько же:
 * время каждому слову берётся из расшифровки по порядку. Написание можно
 * поправить, число слов — нет.
 */

export type ZoomMark = 'push' | 'punch' | 'wide';

export interface KineticWord {
  text: string;
  /** Кадр, на котором слово проявляется. */
  from: number;
}

export interface KineticLine {
  words: KineticWord[];
  big: boolean;
  /** Где мелкая строка стоит под ударным словом: 0 — левый край, 1 — правый. */
  align: number;
}

export interface KineticPhrase {
  from: number;
  to: number;
  /** Последние кадры фразы гаснут, а не обрываются: после неё пауза. */
  fade: boolean;
  top: boolean;
  lines: KineticLine[];
  zoom: ZoomMark[];
  /** Кадр ударного слова — на него приходится толчок камеры. */
  beat: number;
}

/** Служебные слова ударными не бывают. */
const SERVICE = new Set([
  'в', 'во', 'на', 'над', 'под', 'из', 'от', 'до', 'по', 'за', 'к', 'ко', 'с', 'со',
  'у', 'о', 'об', 'при', 'про', 'для', 'без', 'через', 'между', 'перед',
  'и', 'а', 'но', 'да', 'или', 'что', 'как', 'чем', 'же', 'ли', 'бы', 'не', 'ни',
  'то', 'уж', 'вот', 'уже', 'ещё', 'еще', 'так', 'там', 'тут', 'это', 'этот', 'эти',
  'он', 'она', 'оно', 'они', 'ты', 'вы', 'мы', 'я', 'мой', 'твой', 'свой', 'весь',
  'когда', 'если', 'потому', 'чтобы', 'тоже', 'только', 'очень', 'просто',
]);

/** Мелкие строки по горизонтали гуляют, а не стоят колонкой. */
const ALIGNS = [0.5, 0.85, 0.15, 0.6, 0.9, 0.3];

/** Мелкая строка длиннее этого делится на две. */
const SMALL_LINE_CHARS = 24;
/** Фраза без плана — не длиннее стольких слов. */
const AUTO_MAX_WORDS = 4;
/** Пауза, после которой начинается новая фраза. */
const AUTO_PAUSE_SEC = 0.3;
/** Хвост после последнего слова фразы, если дальше пауза. */
const TAIL_FRAMES = 12;

const letters = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '');
const isWord = (text: string) => letters(text).length > 0;
const bare = (text: string) => letters(text).toLowerCase();

interface Token {
  text: string;
  big: boolean;
  /** Номер строки внутри фразы, по разметке `/`. */
  row: number;
}

interface Draft {
  tokens: Token[];
  top: boolean;
  zoom: ZoomMark[];
}

function parsePlan(plan: string[]): Draft[] {
  return plan.map((source) => {
    let text = source.trim();
    const top = text.startsWith('^');
    if (top) text = text.slice(1);
    const zoom = [...text.matchAll(/@(push|punch|wide)\b/g)].map((m) => m[1] as ZoomMark);
    text = text.replace(/@(push|punch|wide)\b/g, '');
    const tokens: Token[] = [];
    text.split('/').forEach((row, r) => {
      for (const raw of row.trim().split(/\s+/).filter(Boolean)) {
        const big = /^\*.+\*$/.test(raw);
        tokens.push({ text: big ? raw.slice(1, -1) : raw, big, row: r });
      }
    });
    return { tokens, top, zoom };
  });
}

/** Фразы без плана: границы — по знакам и паузам, ударное — самое длинное значимое слово. */
function autoDrafts(words: CaptionWord[]): Draft[] {
  const drafts: Draft[] = [];
  let current: CaptionWord[] = [];

  const flush = () => {
    if (!current.length) return;
    const candidates = current.filter((w) => !SERVICE.has(bare(w.text)) && bare(w.text).length >= 4);
    const hero = candidates.reduce<CaptionWord | null>(
      (best, w) => (!best || bare(w.text).length >= bare(best.text).length ? w : best),
      null,
    );
    drafts.push({
      top: false,
      zoom: [],
      tokens: current.map((w) => ({ text: w.text.trim(), big: w === hero, row: 0 })),
    });
    current = [];
  };

  words.forEach((w, i) => {
    current.push(w);
    const next = words[i + 1];
    const text = w.text.trim();
    const ends = /[.?!…]$/.test(text);
    const pauses = /[,;:—]$/.test(text) && current.length >= 3;
    const gap = next ? next.start - w.end >= AUTO_PAUSE_SEC : true;
    const long =
      (current.length >= AUTO_MAX_WORDS && !SERVICE.has(bare(text))) || current.length >= AUTO_MAX_WORDS + 2;
    if (ends || pauses || gap || long) flush();
  });
  flush();
  return drafts;
}

/** Мелкие слова — в одну строку, а длинную строку — на две. */
function smallLines(words: KineticWord[], align: number): KineticLine[] {
  if (!words.length) return [];
  const length = words.map((w) => w.text).join(' ').length;
  if (length <= SMALL_LINE_CHARS || words.length < 2) return [{ words, big: false, align }];
  const half = Math.ceil(words.length / 2);
  return [
    { words: words.slice(0, half), big: false, align },
    { words: words.slice(half), big: false, align: 1 - align },
  ];
}

export function buildKineticPhrases(
  words: CaptionWord[],
  fps: number,
  plan?: string[],
): KineticPhrase[] {
  const spoken = words.filter((w) => isWord(w.text) && w.end >= w.start);
  if (!spoken.length) return [];

  const drafts = plan?.length ? parsePlan(plan) : autoDrafts(spoken);

  // Время словам плана — из расшифровки, по порядку.
  const planned = drafts.reduce((n, d) => n + d.tokens.filter((t) => isWord(t.text)).length, 0);
  if (planned !== spoken.length) {
    // Первое слово, где план разошёлся с расшифровкой, — чтобы было видно, что чинить.
    const flat = drafts.flatMap((d, i) => d.tokens.filter((t) => isWord(t.text)).map((t) => ({ t, i })));
    const at = flat.findIndex((x, k) => !spoken[k] || bare(x.t.text) !== bare(spoken[k].text));
    const where =
      at >= 0
        ? ` Расходится во фразе ${flat[at].i + 1}: в плане «${flat[at].t.text}», ` +
          `в расшифровке «${spoken[at]?.text ?? '—'}».`
        : '';
    throw new Error(
      `План субтитров: ${planned} слов, в расшифровке ${spoken.length}.${where} ` +
        `Слова плана идут по одному на каждое слово captions.json, в том же порядке.`,
    );
  }

  const frame = (sec: number) => Math.round(sec * fps);
  let cursor = 0;

  const phrases = drafts.map((draft, index) => {
    const timed = draft.tokens.map((token) => {
      // Голая пунктуация живёт вместе со следующим словом.
      const source = spoken[Math.min(cursor, spoken.length - 1)];
      if (isWord(token.text)) cursor += 1;
      return { ...token, from: frame(source.start), end: source.end };
    });

    const lines: KineticLine[] = [];
    const heroAt = timed.findIndex((t) => t.big);
    const above = ALIGNS[index % ALIGNS.length];
    const below = ALIGNS[(index + 2) % ALIGNS.length];

    if (heroAt < 0) {
      // Без ударного слова: строки по разметке или по длине.
      const rows = new Map<number, KineticWord[]>();
      for (const t of timed) rows.set(t.row, [...(rows.get(t.row) ?? []), { text: t.text, from: t.from }]);
      const list = [...rows.values()];
      if (list.length > 1) list.forEach((row) => lines.push({ words: row, big: false, align: 0.5 }));
      else lines.push(...smallLines(list[0], 0.5).map((l) => ({ ...l, align: 0.5 })));
    } else {
      const before = timed.slice(0, heroAt).map((t) => ({ text: t.text, from: t.from }));
      const after = timed.slice(heroAt + 1).map((t) => ({ text: t.text, from: t.from }));
      lines.push(...smallLines(before, above));
      lines.push({ words: [{ text: timed[heroAt].text, from: timed[heroAt].from }], big: true, align: 0.5 });
      lines.push(...smallLines(after, below));
    }

    const lastEnd = Math.max(...timed.map((t) => t.end));
    return {
      from: timed[0].from,
      to: frame(lastEnd) + TAIL_FRAMES,
      fade: false,
      top: draft.top,
      lines,
      zoom: draft.zoom,
      beat: heroAt >= 0 ? timed[heroAt].from : timed[0].from,
    };
  });

  // Фраза держится до следующей; если между ними пауза — гаснет сама.
  phrases.forEach((p, i) => {
    const next = phrases[i + 1];
    if (next && next.from <= p.to) p.to = next.from;
    else p.fade = true;
  });

  return phrases;
}

/** Медленный наезд за фразу и толчок на ударном слове. */
const PUSH = 0.06;
const PUNCH = 0.1;
const PUNCH_FRAMES = 8;
const MAX_ZOOM = 1.3;

type Segment = { from: number; to: number; a: number; b: number; kind: 'push' | 'punch' };

/** Отрезки зума по плану: состояние копится, `@wide` сбрасывает его на общий план. */
export function zoomSegments(phrases: KineticPhrase[]): Segment[] {
  const segments: Segment[] = [];
  let scale = 1;
  for (const p of phrases) {
    if (p.zoom.includes('wide')) {
      segments.push({ from: p.from, to: p.from, a: 1, b: 1, kind: 'push' });
      scale = 1;
    }
    if (p.zoom.includes('push')) {
      // С толчком в той же фразе наезд идёт только до ударного слова.
      const end = p.zoom.includes('punch') ? p.beat : p.to;
      const share = (end - p.from) / Math.max(1, p.to - p.from);
      const b = Math.min(MAX_ZOOM, scale + PUSH * share);
      segments.push({ from: p.from, to: Math.max(p.from + 1, end), a: scale, b, kind: 'push' });
      scale = b;
    }
    if (p.zoom.includes('punch')) {
      const b = Math.min(MAX_ZOOM, scale + PUNCH);
      segments.push({ from: p.beat, to: p.beat + PUNCH_FRAMES, a: scale, b, kind: 'punch' });
      scale = b;
    }
  }
  return segments.sort((x, y) => x.from - y.from);
}

export function zoomAt(frame: number, segments: Segment[], ease: { push: (t: number) => number; punch: (t: number) => number }): number {
  let scale = 1;
  for (const s of segments) {
    if (frame < s.from) break;
    const t = s.to > s.from ? Math.min(1, (frame - s.from) / (s.to - s.from)) : 1;
    scale = s.a + (s.b - s.a) * ease[s.kind](t);
  }
  return scale;
}

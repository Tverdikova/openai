import { CaptionsInternals, createTikTokStyleCaptions } from '@remotion/captions';
import type { Caption, TikTokPage } from '@remotion/captions';
import { captionBox, subtitles } from './format';
import { measure } from './text';
import type { TypeStep } from './style-contract';

/**
 * СУБТИТРЫ: ИЗ СЛОВ — В СТРАНИЦЫ.
 *
 * Слова с точным временем у нас уже есть: `work/words.clean.json`, посчитанный
 * по ЧИСТОЙ дорожке. Ничего заново не распознаётся и никуда не отправляется —
 * ровно тот же источник, из которого считаются длины сцен, поэтому субтитры не
 * могут разъехаться с анимацией.
 *
 * Резать слова на страницы — задача решённая, и решена она в официальном пакете
 * `@remotion/captions`. Здесь мы им пользуемся, а не пишем своё: страницы
 * собирает `createTikTokStyleCaptions`, ширину строки держит
 * `ensureMaxCharactersPerLine`.
 *
 * Наша часть работы — подобрать параметры БЕЗ участия человека. Он не должен
 * знать слова «страница» и «окно склейки»: система смотрит на темп речи и на то,
 * сколько символов реально влезает в кадр этим шрифтом, и решает сама.
 *
 * ДВА СПОСОБА РЕЗАТЬ, настройка `subtitles.chunk`:
 *
 *   page — фраза из нескольких слов, звучащее слово подсвечено (см. выше);
 *   word — по одному слову. Тогда пакет не нужен вовсе: страница равна слову,
 *          и разъехаться с голосом ей нечем. Правила склейки коротких слов — в
 *          `buildWordPages`.
 */

/** Слово из расшифровки: время в секундах чистой дорожки. */
export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

/** Готовая страница субтитров, времена — в кадрах. */
export interface CaptionPage {
  /** Первый кадр показа. */
  from: number;
  /** Последний кадр показа (не включительно). */
  to: number;
  words: { text: string; from: number; to: number }[];
}

/** Страница живёт не меньше этого — иначе мелькание. */
const MIN_PAGE_MS = 700;
/** И не дольше — иначе полоса стоит колом, пока голос идёт дальше. */
const MAX_PAGE_MS = 1700;
/** Разрыв между страницами короче этого закрывается: субтитры не мигают в паузах. */
const STITCH_MS = 400;
/** Хвост после последнего слова — чтобы фраза успевала дочитаться. */
const TAIL_MS = 220;

/**
 * Сколько символов влезает в строку субтитров ЭТИМ шрифтом.
 *
 * Считать по среднему символу нельзя: у одного шрифта «ш» вдвое шире «i», и на
 * русском капсе ошибка сразу выносит строку за край. Поэтому берётся настоящий
 * замер той же строкой, которой текст потом и рисуется.
 */
function charsPerLine(step: TypeStep, fontSize: number, maxWidth: number): number {
  const sample = 'средняя строка русского текста в кадре';
  const width = measure(sample, step, fontSize);
  const perChar = width / sample.length;
  return Math.max(12, Math.floor(maxWidth / perChar));
}

/**
 * Сколько миллисекунд держать страницу. Быстрая речь — короче страницы, иначе
 * слова набегают друг на друга; медленная — длиннее, иначе мелькание.
 */
function pageWindowMs(words: CaptionWord[]): number {
  const spans = words.slice(1).map((w, i) => (w.start - words[i].start) * 1000);
  const usable = spans.filter((ms) => ms > 0 && ms < 2000).sort((a, b) => a - b);
  const perWord = usable.length ? usable[Math.floor(usable.length / 2)] : 400;
  // три слова на странице — то, что глаз успевает схватить целиком
  return Math.min(MAX_PAGE_MS, Math.max(MIN_PAGE_MS, Math.round(perWord * 3)));
}

/** Слова расшифровки -> формат пакета. Ведущий пробел размечает границы слов. */
function toCaptions(words: CaptionWord[]): Caption[] {
  return words.map((w) => ({
    text: ` ${w.text.trim()}`,
    startMs: Math.round(w.start * 1000),
    endMs: Math.round(w.end * 1000),
    timestampMs: Math.round(((w.start + w.end) / 2) * 1000),
    confidence: null,
  }));
}

/**
 * ПОСЛОВНАЯ ПОЛОСА.
 *
 * Слово в кадре одно — но не любое слово имеет право стоять одно. Предлог,
 * союз, частица сами по себе ничего не значат: полоса от них рябит, а глаз не
 * успевает соединить «в» и «шапке» обратно в «в шапке». Поэтому короткое слово
 * всегда уезжает одним блоком с соседом — «в шапке», «весь проект», «в один
 * клик», «на Claude Code».
 *
 * Это не настройка. Правило живёт здесь, в ядре: человек просит «пусть слова
 * идут по одному», а не «склеивай предлоги короче семи символов».
 */

/** Короче этого блок не показывается в одиночку — доклеивается следующее слово. */
const MIN_CHUNK_CHARS = 7;

/** Тире, кавычки и скобки в кадре одни не стоят никогда. */
const NEVER_ALONE = /^[-–—«»"'()\[\]:;,.!?…]+$/;

const chunkLength = (chunk: CaptionWord[]) =>
  chunk.reduce((sum, w) => sum + w.text.trim().length, 0) + Math.max(0, chunk.length - 1);

function glueWords(words: CaptionWord[]): CaptionWord[][] {
  const chunks: CaptionWord[][] = [];
  let current: CaptionWord[] = [];

  for (const word of words) {
    current.push(word);
    const tail = word.text.trim();
    // Блок закрывается, только когда он читается сам по себе: набрал длину и не
    // заканчивается знаком, который без слова ничего не значит.
    if (chunkLength(current) >= MIN_CHUNK_CHARS && !NEVER_ALONE.test(tail)) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);

  // Последний блок мог остаться огрызком — тогда он уезжает к предыдущему.
  const last = chunks.at(-1);
  if (chunks.length > 1 && last && chunkLength(last) < MIN_CHUNK_CHARS) {
    chunks.pop();
    chunks[chunks.length - 1].push(...last);
  }
  return chunks;
}

function buildWordPages(words: CaptionWord[], fps: number): CaptionPage[] {
  const chunks = glueWords(words);
  const ms = (seconds: number) => Math.round(seconds * fps);

  return chunks.map((chunk, i) => {
    const next = chunks[i + 1];
    const start = ms(chunk[0].start);
    const lastEnd = Math.max(...chunk.map((w) => w.end));
    // Блок держится до следующего слова: в пословном режиме гасить полосу на
    // каждой паузе — то же мигание, от которого уходят страницы.
    const end = next ? ms(next[0].start) : ms(lastEnd) + Math.round((TAIL_MS / 1000) * fps);

    return {
      from: start,
      to: Math.max(start + 1, end),
      words: chunk.map((w) => ({
        text: w.text.trim(),
        from: ms(w.start),
        to: ms(w.end),
      })),
    };
  });
}

/**
 * Собрать страницы субтитров.
 *
 * `step` — уровень типографики, которым субтитры будут нарисованы: он нужен
 * прямо здесь, потому что от ширины букв зависит, где резать строку.
 */
export function buildCaptionPages(
  words: CaptionWord[],
  step: TypeStep,
  fps: number,
  options: { maxChars?: number; windowMs?: number; chunk?: 'page' | 'word' } = {},
): CaptionPage[] {
  const clean = words.filter((w) => w.text.trim() && w.end > w.start);
  if (!clean.length) return [];

  if ((options.chunk ?? subtitles.chunk) === 'word') return buildWordPages(clean, fps);

  const maxChars =
    options.maxChars ??
    charsPerLine(step, captionBox.fontSize, captionBox.width) * captionBox.maxLines;
  const windowMs = options.windowMs ?? pageWindowMs(clean);

  // Сначала куски, влезающие в кадр по ширине, — потом внутри куска страницы по
  // темпу речи. В таком порядке страница не может оказаться шире полосы.
  const { segments } = CaptionsInternals.ensureMaxCharactersPerLine({
    captions: toCaptions(clean),
    maxCharsPerLine: maxChars,
  });

  const raw: TikTokPage[] = [];
  for (const segment of segments) {
    if (!segment.length) continue;
    const { pages } = createTikTokStyleCaptions({
      captions: segment,
      combineTokensWithinMilliseconds: windowMs,
    });
    raw.push(...pages);
  }
  if (!raw.length) return [];

  /**
   * От пакета берутся ГРАНИЦЫ страниц, а слова внутри — свои, из расшифровки.
   *
   * Причина не косметическая: собирая страницу, пакет иногда склеивает несколько
   * слов в один токен со временем первого из них. Подсветка тогда загоралась бы
   * сразу на трёх словах и гасла посреди фразы — то есть врала бы про то, что
   * именно звучит. Своё сопоставление по времени такого не допускает.
   */
  const ms = (value: number) => Math.round((value / 1000) * fps);
  const startsMs = raw.map((page) => page.startMs);

  const pages: CaptionPage[] = [];

  for (let i = 0; i < startsMs.length; i++) {
    const from = i === 0 ? -Infinity : startsMs[i];
    const until = startsMs[i + 1] ?? Infinity;
    const own = clean.filter((w) => w.start * 1000 >= from && w.start * 1000 < until);
    if (!own.length) continue;

    const lastEnd = Math.max(...own.map((w) => w.end)) * 1000;
    const nextStart = startsMs[i + 1] ?? null;

    // Пауза между страницами короче полусекунды не гасится: моргающая полоса
    // раздражает сильнее, чем лишняя доля секунды показа.
    const end =
      nextStart !== null && nextStart - lastEnd < STITCH_MS ? nextStart : lastEnd + TAIL_MS;

    const start = ms(startsMs[i]);
    pages.push({
      from: start,
      to: Math.max(start + 1, ms(nextStart !== null ? Math.min(end, nextStart) : end)),
      words: own.map((w) => ({
        text: w.text.trim(),
        from: ms(w.start * 1000),
        to: ms(w.end * 1000),
      })),
    });
  }

  return pages;
}

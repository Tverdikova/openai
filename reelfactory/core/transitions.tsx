import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';

/**
 * СКЛЕЙКИ — движение на стыке сцен.
 *
 * Без них ролик читается сменой слайдов: кадр моргнул, и на его месте другой.
 * Глаз такой стык не переносит, а регистрирует как обрыв, и вместе с обрывом
 * теряется мысль, которая шла через два блока.
 *
 * ОДНО ПРОДОЛЖЕННОЕ ДВИЖЕНИЕ, А НЕ ДВА. Уходящий кадр уезжает, и приходящий
 * приезжает С ТОЙ ЖЕ СТОРОНЫ — как будто оба лежат на одной ленте, и лента
 * протянулась. Поэтому склейка описывается одним вектором `from`: откуда
 * приходит новый кадр. Куда уезжает старый, считается из него же, и разойтись
 * они не могут. Две независимые анимации по краям стыка дают два толчка вместо
 * одного переноса — это и есть самая частая ошибка.
 *
 * ТРИ СВОЙСТВА МЕХАНИЗМА, которые не обсуждаются:
 *
 *   1. Длина блока не меняется. Переход живёт ВНУТРИ отведённых блоку кадров:
 *      приход съедает первые кадры блока, уход — последние. Синхрон с голосом
 *      цел, потому что ни один блок не стал длиннее.
 *   2. Сцена о переходе не знает. Движение накладывается снаружи, обёрткой
 *      <Seam>. Иначе каждая сцена начала бы уметь склеиваться, и правка
 *      механизма означала бы правку всех сцен разом.
 *   3. `cut` есть всегда. Встык — не отсутствие склейки, а осознанный выбор:
 *      предмет продолжается из кадра в кадр, и стыка не должно быть видно.
 *
 * СПИСОК ОТКРЫТ. Свою склейку регистрируют через `registerTransition`, и дальше
 * она называется по имени наравне со встроенными.
 */

/**
 * Характер склейки — то, по чему подбирается звук шва. Именно характер, а не
 * имя: своя склейка «через-дым» должна зазвучать сама, без правки словаря.
 */
export type TransitionCharacter =
  /** кадр переносится, наплывает, растворяется */
  | 'move'
  /** кадр раскрывается из точки или из щели */
  | 'open'
  /** кадр схлопывается в точку или в щель */
  | 'close'
  /** встык: стыка не должно быть ни видно, ни слышно */
  | 'none';

export interface TransitionSpec {
  /** Человеческое описание — видно в отчётах и в подсказках об ошибке. */
  what: string;
  /** Чем звучит шов. См. `seamSound` в core/sfx.ts. */
  character: TransitionCharacter;
  /**
   * Длины входа и выхода в кадрах. РАЗНЫЕ между собой намеренно: равные
   * читаются как «щёлк», приход должен быть чуть длиннее ухода — тогда стык
   * ощущается приездом нового, а не отъездом старого.
   */
  enter: number;
  exit: number;
  /**
   * Откуда приходит новый кадр, в долях кадра: `[1, 0]` — из-за правого края,
   * `[0, 1]` — снизу. Старый уезжает ровно туда же, куда движется новый, то
   * есть в `-from`. Одно движение на двоих.
   */
  from?: [number, number];
  /** Масштаб пришедшего в самом начале и уходящего в самом конце. */
  zoom?: [number, number];
  /** Растворение: прозрачность едет вместе с движением. */
  fade?: boolean;
  /** Смаз в пикселях на краях движения. Дорогая штука, ставится по чуть-чуть. */
  blur?: number;
  /** Поворот в градусах на краях движения. */
  spin?: number;
  /** Раскрытие: круг из центра или горизонтальная щель. */
  clip?: 'iris' | 'slit';
  /** На входе кадр раскрывается, а на выходе — просто уходит (и наоборот). */
  clipSide?: 'in' | 'out';
}

// ── реестр ──────────────────────────────────────────────

const registry = new Map<string, TransitionSpec>();

/**
 * Завести свою склейку. Имя — латиницей, как у композиций: оно попадает в
 * описание ролика и в отчёты.
 */
export function registerTransition(name: string, spec: TransitionSpec): void {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`Имя склейки «${name}» не годится: только латиница, цифры и дефис.`);
  }
  registry.set(name, spec);
}

export function getTransition(name: string): TransitionSpec | undefined {
  return registry.get(name);
}

export function transitionNames(): string[] {
  return [...registry.keys()];
}

export function isTransition(name: string): boolean {
  return registry.has(name);
}

// ── встроенные склейки ──────────────────────────────────
//
// Разнообразие здесь — не украшение, а требование: две одинаковые подряд глаз
// выучивает с первого раза, и стык снова читается сменой слайда. Поэтому в
// наборе есть переносы по всем четырём сторонам, наплывы, растворения,
// раскрытия и повороты — чтобы очереди было из чего строиться.

registerTransition('cut', {
  what: 'встык: предмет продолжается из кадра в кадр',
  character: 'none',
  enter: 0,
  exit: 0,
});

registerTransition('push-left', {
  what: 'кадр переносится влево',
  character: 'move',
  enter: 11,
  exit: 7,
  from: [1, 0],
});

registerTransition('push-right', {
  what: 'кадр переносится вправо',
  character: 'move',
  enter: 11,
  exit: 7,
  from: [-1, 0],
});

registerTransition('push-up', {
  what: 'кадр уезжает вверх, новый подаётся снизу',
  character: 'move',
  enter: 12,
  exit: 8,
  from: [0, 1],
});

registerTransition('push-down', {
  what: 'кадр опускается: новый приходит сверху',
  character: 'move',
  enter: 12,
  exit: 8,
  from: [0, -1],
});

registerTransition('sheet', {
  what: 'новый лист наезжает снизу поверх старого',
  character: 'move',
  enter: 13,
  exit: 8,
  from: [0, 1],
  zoom: [1, 0.94],
  fade: true,
});

registerTransition('lift', {
  what: 'старый лист поднимают, под ним уже лежит новый',
  character: 'move',
  enter: 10,
  exit: 7,
  from: [0, -0.35],
  zoom: [1.04, 1],
  fade: true,
});

registerTransition('slide-in', {
  what: 'кадр въезжает сбоку коротким шагом',
  character: 'move',
  enter: 10,
  exit: 6,
  from: [0.4, 0],
  fade: true,
});

registerTransition('zoom-in', {
  what: 'наплыв: камера приближается к новому кадру',
  character: 'move',
  enter: 12,
  exit: 8,
  zoom: [1.25, 1.35],
  fade: true,
});

registerTransition('zoom-out', {
  what: 'отъезд: камера отходит, кадр становится дальше',
  character: 'move',
  enter: 12,
  exit: 8,
  zoom: [0.82, 0.72],
  fade: true,
});

registerTransition('through', {
  what: 'проход насквозь: старый пролетает мимо, новый выходит из глубины',
  character: 'move',
  enter: 14,
  exit: 9,
  zoom: [0.86, 1.5],
  fade: true,
  blur: 10,
});

registerTransition('dissolve', {
  what: 'растворение без движения',
  character: 'move',
  enter: 12,
  exit: 9,
  fade: true,
});

registerTransition('blur-through', {
  what: 'кадр расфокусируется и собирается заново',
  character: 'move',
  enter: 13,
  exit: 9,
  fade: true,
  blur: 16,
});

registerTransition('tilt', {
  what: 'кадр заваливается и уходит вбок',
  character: 'move',
  enter: 12,
  exit: 8,
  from: [0.5, 0.12],
  spin: 4,
  fade: true,
});

registerTransition('iris', {
  what: 'кадр раскрывается из точки',
  character: 'open',
  enter: 14,
  exit: 8,
  clip: 'iris',
  clipSide: 'in',
  zoom: [0.92, 0.96],
  fade: true,
});

registerTransition('expand', {
  what: 'кадр раскрывается из горизонтальной щели',
  character: 'open',
  enter: 13,
  exit: 8,
  clip: 'slit',
  clipSide: 'in',
  fade: true,
});

registerTransition('pinch', {
  what: 'старый кадр схлопывается в точку',
  character: 'close',
  enter: 11,
  exit: 9,
  clip: 'iris',
  clipSide: 'out',
  zoom: [1.06, 0.9],
  fade: true,
});

registerTransition('collapse', {
  what: 'старый кадр схлопывается в щель',
  character: 'close',
  enter: 11,
  exit: 9,
  clip: 'slit',
  clipSide: 'out',
  fade: true,
});

/**
 * Очередь склеек для «сам подбери».
 *
 * `cut` сюда не входит намеренно: встык — это утверждение о содержании
 * («предмет тот же»), и решить его может только тот, кто написал сцены.
 */
const AUTO_POOL = [
  'push-up',
  'zoom-in',
  'push-left',
  'iris',
  'sheet',
  'blur-through',
  'push-down',
  'through',
  'expand',
  'push-right',
  'tilt',
  'lift',
  'zoom-out',
  'collapse',
  'slide-in',
  'dissolve',
  'pinch',
];

/** Устойчивое число по строке: один и тот же ролик — одна и та же очередь. */
function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Очередь склеек, когда у ролика стоит `transition: 'auto'`.
 *
 * Шаг по списку берётся из имени ролика и никогда не равен нулю по длине
 * списка — поэтому две соседние склейки не могут совпасть, а разные ролики
 * получают разные очереди. Случайность тут запрещена по той же причине, что и
 * в анимации: при рендере кадры считаются вразнобой, и «случайный» выбор
 * разъехался бы между кадрами одного стыка.
 */
export function autoTransition(reelId: string, index: number): string {
  const size = AUTO_POOL.length;
  const seed = hash(reelId);
  const step = 1 + (seed % (size - 1));
  return AUTO_POOL[(seed + index * step) % size];
}

// ── как это выглядит на кадре ───────────────────────────

const easeIn = Easing.bezier(0.16, 1, 0.3, 1); // приезд: быстро стартует, мягко тормозит
const easeOut = Easing.bezier(0.55, 0, 0.85, 0.35); // отъезд: разгоняется и уходит

function styleAt(spec: TransitionSpec, phase: 'in' | 'out', progress: number): React.CSSProperties {
  // `t` — насколько кадр УЖЕ на месте: 0 — он ещё весь в движении, 1 — стоит.
  // Для ухода это зеркало: 1 в начале ухода, 0 в конце. Так обе фазы считаются
  // одной формулой, и приход с уходом не могут разъехаться.
  const t =
    phase === 'in'
      ? interpolate(progress, [0, 1], [0, 1], { easing: easeIn, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
      : interpolate(progress, [0, 1], [1, 0], { easing: easeOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  const away = 1 - t; // насколько кадр далеко от своего места
  const parts: string[] = [];

  if (spec.from) {
    // Приходящий стоит в `from` и едет к нулю; уходящий стоит в нуле и едет в
    // `-from`. Направление движения у обоих одно.
    const sign = phase === 'in' ? 1 : -1;
    const [dx, dy] = spec.from;
    if (dx) parts.push(`translateX(${(sign * dx * away * 100).toFixed(3)}%)`);
    if (dy) parts.push(`translateY(${(sign * dy * away * 100).toFixed(3)}%)`);
  }

  if (spec.zoom) {
    const edge = phase === 'in' ? spec.zoom[0] : spec.zoom[1];
    parts.push(`scale(${(1 + (edge - 1) * away).toFixed(4)})`);
  }

  if (spec.spin) {
    const sign = phase === 'in' ? 1 : -1;
    parts.push(`rotate(${(sign * spec.spin * away).toFixed(3)}deg)`);
  }

  const style: React.CSSProperties = {};
  if (parts.length) style.transform = parts.join(' ');
  if (spec.fade) style.opacity = t;
  if (spec.blur) style.filter = `blur(${(spec.blur * away).toFixed(2)}px)`;

  // Раскрытие работает только со своей стороны стыка: `clipSide: 'in'` —
  // раскрывается приходящий, `'out'` — схлопывается уходящий. С обеих сторон
  // сразу это читалось бы как две дырки подряд, а не как одно раскрытие.
  if (spec.clip && spec.clipSide === phase) {
    if (spec.clip === 'iris') {
      style.clipPath = `circle(${(t * 75).toFixed(2)}% at 50% 50%)`;
    } else {
      const half = (t * 50).toFixed(2);
      style.clipPath = `inset(${50 - Number(half)}% 0% ${50 - Number(half)}% 0%)`;
    }
  }

  return style;
}

/**
 * Обёртка блока: приход в начале, уход в конце.
 *
 * `enter` — склейка самого блока (чем он приходит), `exit` — склейка
 * СЛЕДУЮЩЕГО блока (чем он придёт на смену). Второе важно: уход обязан быть
 * половиной того же движения, которым въедет следующий кадр, а значит взят из
 * его описания, а не из своего.
 */
export const Seam: React.FC<{
  frames: number;
  enter?: TransitionSpec;
  exit?: TransitionSpec;
  children: React.ReactNode;
}> = ({ frames, enter, exit, children }) => {
  const frame = useCurrentFrame();

  // Короткий блок не должен превратиться в одно сплошное движение: на въезд и
  // на выезд отдаётся не больше половины его длины каждому.
  const half = Math.floor(frames / 2);
  const inFrames = Math.min(enter?.enter ?? 0, half);
  const outFrames = Math.min(exit?.exit ?? 0, half);

  let style: React.CSSProperties = {};
  if (enter && inFrames > 0 && frame < inFrames) {
    style = styleAt(enter, 'in', frame / inFrames);
  } else if (exit && outFrames > 0 && frame >= frames - outFrames) {
    style = styleAt(exit, 'out', (frame - (frames - outFrames)) / outFrames);
  }

  return <AbsoluteFill style={{ ...style, willChange: 'transform, opacity' }}>{children}</AbsoluteFill>;
};

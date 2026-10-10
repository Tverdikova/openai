import { VIDEO } from './format';
import { getTransition } from './transitions';
import project from '../config/project.json';
import bank from '../config/sfx.json';

/**
 * ЗВУК ДВИЖЕНИЯ — третий звуковой слой рядом с голосом и музыкой.
 *
 * Глаз видит движение, ухо его не подтверждает — и ролик читается макетом:
 * вроде всё шевелится, а не происходит ничего. Набор должен щёлкать, карточка
 * приезжать со стуком, переключатель переключаться, склейка шелестеть.
 *
 * ЗДЕСЬ СЧИТАЕТСЯ ВСЁ. Дорожка собирается до рендера, по описанию ролика
 * целиком, и только потом отдаётся на воспроизведение. Иначе нельзя: главная
 * работа этого файла — не проиграть звук, а НЕ проиграть лишний, а для этого
 * надо видеть соседей по всему ролику. Компонент видит только свой кадр и
 * решений не принимает.
 *
 * Банк читается импортом, а не из папки: композиция собирается в браузере,
 * файловой системы там нет.
 */

// ── роли ────────────────────────────────────────────────

/**
 * Роль — это СМЫСЛ звука, а не имя файла. Сцена просит «щелчок», а какой
 * именно щелчок сегодня в банке, её не касается: поэтому смена банка не
 * переписывает ни одной сцены.
 */
export type SfxRole =
  | 'typing' | 'type' | 'tick' | 'scroll' | 'select' | 'enter' | 'swipe'
  | 'open' | 'close' | 'snap' | 'drop' | 'toggle' | 'check' | 'click'
  | 'notify' | 'error' | 'whoosh' | 'intro' | 'rise' | 'success' | 'thud';

interface RoleSpec {
  /** Вес в миксе: насколько событие важное. Файлы уже выровнены между собой. */
  gain: number;
  /** Кто выживает при столкновении. Больше — старше. */
  priority: number;
  /** Сколько кадров держать до следующего звука той же роли. */
  minGap: number;
  /** Что это за событие — человеческими словами, для отчётов и подсказок. */
  what: string;
}

/**
 * СЛОВАРЬ РОЛЕЙ.
 *
 * Крупная форма (`whoosh`, `intro`, `rise`) держится умеренно, несмотря на
 * важность: длинные и широкие звуки лежат в миксе всё время, пока звучат, и на
 * равном весе затирают мелкое. Кульминация (`success`, `thud`) — единственные
 * веса больше единицы, и это осознанно: ровный банк даёт ровный ролик, а удар,
 * звучащий как щелчок, перестаёт быть ударом. Разброс между подкладкой и
 * кульминацией — около двенадцати децибел.
 */
const ROLES: Record<SfxRole, RoleSpec> = {
  typing:  { gain: 0.34, priority: 2,  minGap: 20, what: 'набор текста целиком' },
  type:    { gain: 0.30, priority: 1,  minGap: 2,  what: 'одно нажатие: тап, Enter, один символ' },
  tick:    { gain: 0.34, priority: 2,  minGap: 2,  what: 'шаг счётчика, галочка по списку' },
  scroll:  { gain: 0.36, priority: 3,  minGap: 20, what: 'непрерывная прокрутка' },
  select:  { gain: 0.40, priority: 3,  minGap: 4,  what: 'выбор, наведение, стало активным' },
  enter:   { gain: 0.46, priority: 3,  minGap: 3,  what: 'элемент появился в кадре' },
  swipe:   { gain: 0.46, priority: 3,  minGap: 5,  what: 'сдвиг на шаг' },
  open:    { gain: 0.50, priority: 6,  minGap: 12, what: 'окно раскрылось' },
  close:   { gain: 0.50, priority: 6,  minGap: 12, what: 'окно закрылось' },
  snap:    { gain: 0.55, priority: 4,  minGap: 5,  what: 'предмет встал на место' },
  drop:    { gain: 0.55, priority: 4,  minGap: 5,  what: 'предмет опустился сверху' },
  toggle:  { gain: 0.55, priority: 5,  minGap: 8,  what: 'переключатель' },
  check:   { gain: 0.55, priority: 5,  minGap: 8,  what: 'галочка поставлена' },
  click:   { gain: 0.60, priority: 5,  minGap: 6,  what: 'нажатие' },
  notify:  { gain: 0.68, priority: 7,  minGap: 30, what: 'уведомление прилетело' },
  error:   { gain: 0.72, priority: 8,  minGap: 30, what: 'ошибка' },
  whoosh:  { gain: 0.55, priority: 9,  minGap: 8,  what: 'склейка' },
  intro:   { gain: 0.72, priority: 9,  minGap: 90, what: 'затяжной вуш под целый блок, пик к стыку' },
  rise:    { gain: 0.62, priority: 6,  minGap: 45, what: 'нарастание, только перед thud или success' },
  success: { gain: 1.15, priority: 8,  minGap: 45, what: 'готово' },
  thud:    { gain: 1.30, priority: 10, minGap: 45, what: 'тяжёлая посадка, не чаще раза на ролик' },
};

export const sfxRoles = Object.keys(ROLES) as SfxRole[];

export function isSfxRole(name: string): name is SfxRole {
  return Object.prototype.hasOwnProperty.call(ROLES, name);
}

/** Что означает роль — одной строкой. Для подсказок и для `npm run sfx`. */
export function roleMeaning(role: SfxRole): string {
  return ROLES[role].what;
}

// ── банк ────────────────────────────────────────────────

interface Sound {
  file: string;
  role: string;
  what?: string;
  seconds: number;
  loudness?: number;
  /** Секунда, где звук громче всего. Без неё не работает `align: 'peak'`. */
  peakAt?: number;
  author?: string;
  license?: string;
  source?: string;
}

const sounds: Sound[] = (bank as { sounds: Sound[] }).sounds ?? [];

const byRole = new Map<SfxRole, Sound[]>();
for (const sound of sounds) {
  if (!isSfxRole(sound.role)) continue;
  const list = byRole.get(sound.role);
  if (list) list.push(sound);
  else byRole.set(sound.role, [sound]);
}

/**
 * Роли, для которых в банке нет ни одного звука. Пустая роль — это не пустяк:
 * сцена попросит её и получит тишину ровно там, где ставила событие.
 */
export function missingRoles(): SfxRole[] {
  return sfxRoles.filter((role) => !byRole.get(role)?.length);
}

// ── настройка ───────────────────────────────────────────

const config = (project as { sfx?: Record<string, unknown> }).sfx ?? {};

export const sfxSettings = {
  /**
   * Звучит ли слой вообще. По умолчанию ДА — в отличие от музыки. Разница
   * осмысленная: музыка спорит с голосом и остаётся вкусом, а звук движения
   * голосу не мешает и отвечает за то, живой ролик или мёртвый.
   */
  enabled: config.enabled !== false,
  /**
   * Общая громкость слоя.
   *
   * Число не на глаз, а из замера: голос идёт около −12 LUFS по мгновенному
   * окну, банк выровнен на −26 по тому же. При единице самый громкий звук
   * банка на четырнадцать децибел тише голоса — рабочее место слоя. Ниже 0.5
   * звуки перестают читаться под речью, выше 1.2 начинают с ней спорить, и
   * первым страдает не голос, а сам звук: его перестают замечать как событие и
   * начинают замечать как шум.
   */
  volume: typeof config.volume === 'number' ? (config.volume as number) : 1.0,
  /** Озвучивать ли швы между сценами. */
  seams: config.seams !== false,
} as const;

// ── описание попадания ──────────────────────────────────

export interface SfxCue {
  /** Кадр внутри блока, ноль — первый. */
  at: number;
  /** Что произошло. */
  role: SfxRole;
  /** Повторить N раз через `step` кадров. */
  times?: number;
  step?: number;
  /** Поправка громкости именно этого попадания. */
  gain?: number;
  /** Конкретный вариант роли. Обычно не указывается: пусть чередует система. */
  variant?: string;
  /**
   * `'peak'` двигает старт назад ровно на `peakAt` из банка — чтобы на
   * указанный кадр пришёлся САМЫЙ ГРОМКИЙ момент звука, а не его начало. У
   * разгона пик в конце, у затяжного вуша в середине, у колокола через треть
   * секунды: поставленные началом, они звучат мимо. Считать сдвиг руками
   * нельзя — длина вариантов роли разная, и арифметика под один файл разъедется
   * на следующем чередовании.
   */
  align?: 'start' | 'peak';
  /** Длина события на экране в кадрах — для `typing` и `scroll`. */
  lasts?: number;
}

/**
 * Блок глазами звука. Отдельный тип, чтобы `sfx.ts` и `reel.ts` не ссылались
 * друг на друга по кругу.
 */
export interface SfxBlock {
  id: string;
  frames: number;
  sfx?: SfxCue[] | false;
  transition?: string;
  seam?: SfxRole | false;
}

/** Готовое попадание: всё посчитано, компоненту осталось только проиграть. */
export interface PlannedCue {
  /** Кадр от начала ролика. */
  frame: number;
  file: string;
  volume: number;
  /** Сколько кадров звучит. */
  frames: number;
  /** С какого кадра внутри файла начинать. Ноль — с начала. */
  startFrom: number;
  /** Плавно увести хвост за столько кадров до конца. Ноль — не уводить. */
  fadeOut: number;
  role: SfxRole;
}

// ── звук шва ────────────────────────────────────────────

/**
 * Чем звучит склейка. Роль берётся по ХАРАКТЕРУ перехода, а не по его имени:
 * своя склейка «через-дым» зазвучит сама, без правки этого словаря.
 *
 * Встык молчит намеренно: там стыка не должно быть слышно ровно так же, как не
 * должно быть видно.
 */
export function seamSound(name: string | undefined): SfxRole | null {
  if (!name) return 'whoosh';
  const spec = getTransition(name);
  if (!spec) return 'whoosh'; // незнакомая склейка: шов всё равно есть
  if (spec.character === 'none') return null;
  if (spec.character === 'open') return 'open';
  if (spec.character === 'close') return 'close';
  return 'whoosh';
}

// ── прореживание ────────────────────────────────────────
//
// Главная опасность здесь не тишина, а каша. Двадцать щелчков в секунду
// сливаются в шум, из которого не читается ни один, — и ролик от этого звучит
// хуже, чем если бы молчал.

/** Ближе этого к шву звук снимается: шелест склейки всё равно его съест. */
const SEAM_SHADOW = 2;
/** Окно, в котором ухо перестаёт разбирать звуки по отдельности. */
const CROWD_WINDOW = 3;
const CROWD_MAX = 2;
/** Потолок плотности на секунду по всему ролику. */
const DENSITY_MAX = 10;

interface Raw {
  frame: number;
  role: SfxRole;
  gain: number;
  variant?: string;
  align: 'start' | 'peak';
  lasts?: number;
  seam: boolean;
  /** Порядок появления. Держит сортировку устойчивой между сборками. */
  order: number;
}

/** Развернуть описание ролика в общий список попаданий с кадрами от начала. */
function collect(blocks: SfxBlock[], fallback?: string): { raw: Raw[]; seams: number[]; total: number } {
  const raw: Raw[] = [];
  const seams: number[] = [];
  let at = 0;
  let order = 0;

  blocks.forEach((block, index) => {
    // Шов. Первый блок ниоткуда не приходит — на нулевом кадре звука нет.
    if (index > 0 && sfxSettings.seams && block.seam !== false) {
      const role = block.seam ?? seamSound(block.transition ?? fallback);
      if (role && byRole.get(role)?.length) {
        raw.push({ frame: at, role, gain: 1, align: 'start', seam: true, order: order++ });
        seams.push(at);
      }
    }

    if (block.sfx && Array.isArray(block.sfx)) {
      for (const cue of block.sfx) {
        const times = Math.max(1, Math.floor(cue.times ?? 1));
        const step = Math.max(1, Math.floor(cue.step ?? 3));
        for (let i = 0; i < times; i++) {
          raw.push({
            frame: at + Math.round(cue.at) + i * step,
            role: cue.role,
            gain: typeof cue.gain === 'number' ? cue.gain : 1,
            variant: cue.variant,
            align: cue.align === 'peak' ? 'peak' : 'start',
            lasts: cue.lasts,
            seam: false,
            order: order++,
          });
        }
      }
    }

    at += block.frames;
  });

  raw.sort((a, b) => a.frame - b.frame || a.order - b.order);
  return { raw, seams, total: at };
}

/** Проредить: сначала тень шва, потом зазор роли, потом толпа, потом плотность. */
function thin(raw: Raw[], seams: number[]): Raw[] {
  const kept: Raw[] = [];
  const lastByRole = new Map<SfxRole, number>();

  const refreshRoles = () => {
    lastByRole.clear();
    for (const cue of kept) lastByRole.set(cue.role, cue.frame);
  };

  for (const cue of raw) {
    // Сама склейка прореживанию по соседям не подлежит: она описывает стык, а
    // не событие, и снимать её означало бы прятать монтаж.
    if (cue.seam) {
      kept.push(cue);
      lastByRole.set(cue.role, cue.frame);
      continue;
    }

    // 1. Тень склейки: шелест шва съел бы щелчок, ради которого он ставился.
    if (seams.some((frame) => Math.abs(frame - cue.frame) < SEAM_SHADOW)) continue;

    // 2. Зазор роли.
    const previous = lastByRole.get(cue.role);
    if (previous !== undefined && cue.frame - previous < ROLES[cue.role].minGap) continue;

    // 3. Толпа: три звука в трёх кадрах ухо не разбирает на составляющие, оно
    // слышит «бум». Выживают двое старших.
    const window = kept.filter((k) => cue.frame - k.frame >= 0 && cue.frame - k.frame < CROWD_WINDOW);
    if (window.length >= CROWD_MAX) {
      const rivals = window.filter((k) => !k.seam);
      let weakest: Raw | undefined;
      for (const rival of rivals) {
        if (!weakest || ROLES[rival.role].priority < ROLES[weakest.role].priority) weakest = rival;
      }
      if (!weakest || ROLES[weakest.role].priority >= ROLES[cue.role].priority) continue;
      kept.splice(kept.indexOf(weakest), 1);
      refreshRoles();
    }

    kept.push(cue);
    lastByRole.set(cue.role, cue.frame);
  }

  // 4. Потолок плотности — по всему ролику, посекундно.
  const buckets = new Map<number, Raw[]>();
  for (const cue of kept) {
    const second = Math.floor(cue.frame / VIDEO.fps);
    const list = buckets.get(second);
    if (list) list.push(cue);
    else buckets.set(second, [cue]);
  }

  const dropped = new Set<Raw>();
  for (const list of buckets.values()) {
    if (list.length <= DENSITY_MAX) continue;
    const order = [...list].sort(
      (a, b) => Number(b.seam) - Number(a.seam) ||
        ROLES[b.role].priority - ROLES[a.role].priority ||
        a.order - b.order,
    );
    for (const cue of order.slice(DENSITY_MAX)) dropped.add(cue);
  }

  return kept.filter((cue) => !dropped.has(cue));
}

// ── выбор файла ─────────────────────────────────────────

/** Состояние очереди на один ролик. */
interface Turn {
  /** Куда доехала очередь по каждой роли. */
  cursor: Map<SfxRole, number>;
  /** Что прозвучало последним — чтобы не повторить его следом. */
  last: Map<SfxRole, string>;
}

/**
 * Какой именно вариант роли прозвучит.
 *
 * Очередь с чередованием: один файл не звучит дважды подряд. Повторённый один
 * в один звук ухо выучивает мгновенно и дальше читает как заедание, а не как
 * событие. Нужно подчеркнуть однотипность повторений — на это есть `variant`:
 * названный впрямую вариант берётся как есть.
 */
function pick(role: SfxRole, want: { variant?: string; lasts?: number }, turn: Turn): Sound | null {
  const list = byRole.get(role);
  if (!list?.length) return null;

  if (want.variant) {
    const named = list.find((s) => s.file === want.variant || s.file.endsWith(`/${want.variant}`));
    if (named) {
      turn.last.set(role, named.file);
      return named;
    }
  }

  // Длина события задана — берётся вариант, ближайший по длине. Рулон на четыре
  // секунды под односекундную печать звучит как чужой звук поверх кадра.
  if (typeof want.lasts === 'number') {
    const seconds = want.lasts / VIDEO.fps;
    let best = list[0];
    for (const sound of list) {
      if (Math.abs(sound.seconds - seconds) < Math.abs(best.seconds - seconds)) best = sound;
    }
    turn.last.set(role, best.file);
    return best;
  }

  // Очередь идёт по кругу, а не «первый, кто не повторяется»: иначе на трёх
  // вариантах вечно чередовались бы первые два, а третий не звучал никогда.
  let index = (turn.cursor.get(role) ?? 0) % list.length;
  if (list.length > 1 && list[index].file === turn.last.get(role)) index = (index + 1) % list.length;
  turn.cursor.set(role, index + 1);
  turn.last.set(role, list[index].file);
  return list[index];
}

// ── сборка дорожки ──────────────────────────────────────

/**
 * Посчитать звуковую дорожку ролика целиком.
 *
 * `transition` — общая склейка ролика: с неё берётся звук шва там, где у блока
 * своя не указана. `enabled: false` — у этого ролика звука нет вовсе.
 */
export function planSfx(
  blocks: SfxBlock[],
  { transition, enabled = true }: { transition?: string; enabled?: boolean } = {},
): PlannedCue[] {
  if (!enabled || !sfxSettings.enabled) return [];
  if (!sounds.length) return [];

  const { raw, seams, total } = collect(blocks, transition);
  const kept = thin(raw, seams);

  const turn: Turn = { cursor: new Map(), last: new Map() };
  const planned: PlannedCue[] = [];

  for (const cue of kept) {
    const sound = pick(cue.role, { variant: cue.variant, lasts: cue.lasts }, turn);
    if (!sound) continue;

    const soundFrames = Math.max(1, Math.round(sound.seconds * VIDEO.fps));

    // Выравнивание по пику: старт уезжает назад ровно на пик файла. За начало
    // блока звук уходит свободно — разгон живёт в предыдущей сцене, а
    // разрешается в этой. За начало РОЛИКА уйти некуда: там дорожка обрезается
    // сама, и вместо сдвига звук начинается с середины файла.
    let frame = cue.frame;
    let startFrom = 0;
    if (cue.align === 'peak' && typeof sound.peakAt === 'number') {
      frame -= Math.round(sound.peakAt * VIDEO.fps);
      if (frame < 0) {
        startFrom = -frame;
        frame = 0;
      }
    }
    if (frame >= total) continue;

    let frames = soundFrames - startFrom;
    let fadeOut = 0;

    // Длина события задана, а подходящего по длине варианта не нашлось — хвост
    // уводится плавно. Оборванный на полуударе набор слышен сразу.
    if (typeof cue.lasts === 'number' && cue.lasts > 0 && frames > cue.lasts) {
      frames = cue.lasts;
      fadeOut = Math.min(6, Math.max(2, Math.round(cue.lasts / 4)));
    }

    frames = Math.min(frames, total - frame);
    if (frames <= 0) continue;

    planned.push({
      frame,
      file: sound.file,
      volume: sfxSettings.volume * ROLES[cue.role].gain * cue.gain,
      frames,
      startFrom,
      fadeOut,
      role: cue.role,
    });
  }

  return planned;
}

/**
 * Что попросили и что из этого прозвучит. Нужно для мягкой проверки: сильный
 * разрыв между «попросили» и «прозвучит» означает, что попадания расставлены
 * не по движению, а наугад.
 */
export function sfxReport(
  blocks: SfxBlock[],
  { transition }: { transition?: string } = {},
): { asked: number; played: number; perSecond: number } {
  const { raw, seams, total } = collect(blocks, transition);
  const asked = raw.filter((cue) => !cue.seam).length;
  const kept = thin(raw, seams);
  const played = kept.filter((cue) => !cue.seam).length;
  const seconds = total / VIDEO.fps;
  return {
    asked,
    played,
    perSecond: seconds > 0 ? kept.length / seconds : 0,
  };
}

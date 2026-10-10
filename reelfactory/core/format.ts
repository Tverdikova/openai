import project from '../config/project.json';

/**
 * ФОРМАТ КАДРА И БЕЗОПАСНЫЕ ЗОНЫ — читаются из config/project.json.
 * Это часть ЯДРА: не зависит от стиля и одинакова для пиксель-арта и для
 * минималистичной графики. Стиль отвечает за то, КАК выглядит; формат — за то,
 * ГДЕ вообще разрешено находиться контенту.
 */

export const VIDEO = {
  width: project.format.width,
  height: project.format.height,
  fps: project.format.fps,
} as const;

export const PAGE_PAD = project.safe.pagePad;

/** Полезная ширина строки. Ни один текст не должен быть шире. */
export const SAFE_WIDTH = VIDEO.width - 2 * PAGE_PAD;

/**
 * СУБТИТРЫ. Три положения дел, и от них зависит нижняя граница кадра:
 *
 *   external — субтитры накладывает сторонний сервис. Мы не знаем, какого они
 *              размера, поэтому внизу оставляется запас вслепую;
 *   own      — субтитры рисуем сами. Тогда запас не нужен: место занято нашей
 *              собственной полосой, и её высота известна точно;
 *   none     — субтитров нет вовсе, низ свободен.
 *
 * Поэтому нижний отступ НЕ настраивается отдельной ручкой. В конфиге лежит
 * только мёртвая зона интерфейса соцсети, а место под субтитры система считает
 * сама — иначе две настройки неизбежно разъедутся, и текст полезет на кнопки.
 */
const subtitlesConfig = project.subtitles as {
  mode?: string;
  look?: string;
  chunk?: string;
  position?: number;
  size?: number;
  weight?: number;
  plate?: boolean;
  highlight?: boolean;
  accent?: string;
  /** Старое поле булевого вида. Понимается, чтобы конфиги прошлых версий жили. */
  external?: boolean;
};

const subtitleMode = ((): 'own' | 'external' | 'none' => {
  const mode = subtitlesConfig.mode;
  if (mode === 'own' || mode === 'external' || mode === 'none') return mode;
  return subtitlesConfig.external === false ? 'none' : 'external';
})();

export const subtitles = {
  mode: subtitleMode,
  /**
   * `kinetic` — по фразам, ударное слово крупно, слова проявляются по одному
   * (по умолчанию); `white` — привычные белые; `brand` — цветом и шрифтом
   * стиль-пака.
   */
  look:
    subtitlesConfig.look === 'brand'
      ? ('brand' as const)
      : subtitlesConfig.look === 'white'
        ? ('white' as const)
        : ('kinetic' as const),
  /**
   * Доля высоты кадра от низа до нижнего края полосы субтитров.
   *
   * Значение по умолчанию поднято: у самого низа кадра субтитры попадают под
   * интерфейс соцсети — подпись автора, кнопки, описание, — и первая строка
   * читается плохо. Полоса стоит выше этой зоны.
   */
  position: subtitlesConfig.position ?? 0.18,
  /**
   * СКОЛЬКО СЛОВ ДЕРЖАТЬ НА ЭКРАНЕ РАЗОМ.
   *
   *   page — фраза из нескольких слов, звучащее слово подсвечено. Привычный
   *          «тиктошный» вид;
   *   word — по одному слову. Полоса короткая, слово сменяется ровно в тот кадр,
   *          когда оно звучит, и разъехаться с голосом ей нечем.
   */
  chunk: subtitlesConfig.chunk === 'word' ? ('word' as const) : ('page' as const),
  /** Множитель кегля субтитров. */
  size: subtitlesConfig.size ?? 1,
  /**
   * Насыщенность шрифта субтитров. Пусто — жирное начертание по умолчанию:
   * белые субтитры «как у всех» держатся именно на жире. Стилю с тонкой антиквой
   * жир не идёт, поэтому величина вынесена в настройку, а не зашита в слой.
   */
  weight: subtitlesConfig.weight ?? null,
  /**
   * Тёмная подложка под белыми субтитрами. Она нужна, когда текст ложится на
   * пёструю картинку; на светлом стиле и тонком шрифте подложка выглядит
   * чужеродной плашкой, и её выключают.
   */
  plate: subtitlesConfig.plate !== false,
  /**
   * Подсвечивать ли слово, которое звучит прямо сейчас.
   *
   * В пословном режиме подсветка выключается сама, что бы ни стояло в конфиге:
   * выделять в строке из одного слова нечего — подсветилась бы вся строка, и
   * приём потерял бы смысл.
   */
  highlight: subtitlesConfig.chunk === 'word' ? false : subtitlesConfig.highlight !== false,
  /**
   * Цвет подсветки белых субтитров. Пусто — берётся акцент стиль-пака.
   * Отдельная ручка нужна затем, что белые субтитры и так живут вне палитры:
   * бывает, что подсветка должна попасть в цвет самого видео, а не стиля.
   */
  accent: typeof subtitlesConfig.accent === 'string' && subtitlesConfig.accent
    ? subtitlesConfig.accent
    : null,
} as const;

/**
 * ГЕОМЕТРИЯ ПОЛОСЫ СУБТИТРОВ — в ядре, а не в стиле: это вопрос «где», а не
 * «как выглядит». Кегль считается от ширины кадра, чтобы при другом формате
 * субтитры остались того же размера относительно экрана. Шрифт и цвет берутся
 * из стиль-пака уже при отрисовке.
 */
const CAPTION_LINE_HEIGHT = 1.18;
/**
 * Пословной полосе вторая строка не нужна: в кадре стоит одно слово, редко два
 * склеенных. Считать её высоту по двум строкам — значит зря отнимать у графики
 * больше сотни пикселей рабочей зоны.
 */
const CAPTION_MAX_LINES = subtitles.chunk === 'word' ? 1 : 2;
const CAPTION_PAD_Y = 16;

export const captionBox = {
  fontSize: Math.round(VIDEO.width * 0.05 * subtitles.size),
  lineHeight: CAPTION_LINE_HEIGHT,
  maxLines: CAPTION_MAX_LINES,
  padY: CAPTION_PAD_Y,
  /** Отступ нижнего края полосы от низа кадра. */
  get bottom() {
    return Math.round(VIDEO.height * subtitles.position);
  },
  /** Полная высота полосы: две строки плюс поля подложки. Кинетическим — две мелкие строки и ударное слово. */
  get height() {
    if (subtitles.look === 'kinetic') return Math.round(VIDEO.width * (0.057 * 2 + 0.2 * 0.8) * subtitles.size);
    return Math.round(this.fontSize * this.lineHeight * this.maxLines + this.padY * 2);
  },
  /** Верхняя кромка полосы, считая от низа кадра. Ниже неё контенту нельзя. */
  get top() {
    return this.bottom + this.height;
  },
  /** Полезная ширина строки субтитров — чуть уже кадра, поля шире общих. */
  get width() {
    return VIDEO.width - 2 * Math.round(PAGE_PAD * 1.5);
  },
} as const;

/** Зум видео с камеры по плану субтитров. Выключается `camera.zoom: false`. */
export const cameraZoom = (project as { camera?: { zoom?: boolean } }).camera?.zoom !== false;

/** Запас под чужие субтитры: их размер нам неизвестен, берём с походом. */
const EXTERNAL_SUBTITLE_RESERVE = Math.round(VIDEO.height * 0.073);

/** Зазор между контентом сцены и верхней кромкой своих субтитров. */
const CAPTION_GAP = 24;

const bottomReserved = (() => {
  if (subtitleMode === 'own') return captionBox.top + CAPTION_GAP;
  if (subtitleMode === 'external') return project.safe.bottom + EXTERNAL_SUBTITLE_RESERVE;
  return 0;
})();

/**
 * Мёртвые зоны. Сверху — системный интерфейс соцсети, снизу — подпись, аватар,
 * кнопки и субтитры. Значения из конфига едины для всех площадок: один ролик
 * уходит и в Reels, и в Shorts, и в TikTok, поэтому зона берётся безопасная для
 * всех сразу. Нижняя может только вырасти — если своя или чужая полоса субтитров
 * требует больше места, чем мёртвая зона.
 */
export const safe = {
  top: project.safe.top,
  bottom: Math.max(project.safe.bottom, bottomReserved),

  /** Рабочая высота между мёртвыми зонами. */
  get contentHeight() {
    return VIDEO.height - this.top - this.bottom;
  },

  /**
   * Линия уровня глаз — верхняя треть рабочей зоны, куда падает первый взгляд.
   * Главный смысл сцены (заголовок, число, герой-объект) ставится около неё.
   */
  get eyeLine() {
    return this.top + this.contentHeight * 0.33;
  },
} as const;

/**
 * ЗОНА ЛИЦА — единственное место кадра, куда поверх камеры нельзя ничего класть.
 *
 * Человек, снимающий себя вертикально с руки или со штатива, попадает головой и
 * плечами в среднюю часть кадра. Границы взяты с запасом: выше 34% высоты обычно
 * пустой потолок или фон, ниже 78% — грудь и низ кадра. Врезка живёт снаружи
 * этой полосы, поэтому закрыть лицо она не может ни при каких размерах.
 *
 * Числа сознательно в ядре и не настраиваются: это не вкус, а анатомия кадра.
 */
export const faceZone = {
  top: Math.round(VIDEO.height * 0.34),
  bottom: Math.round(VIDEO.height * 0.78),
} as const;

/**
 * ПОЛОСЫ ДЛЯ ВРЕЗКИ поверх камеры: над лицом и под ним. Верхняя начинается сразу
 * под мёртвой зоной интерфейса, нижняя заканчивается там, где начинаются
 * субтитры. Что не влезло в полосу — не врезка, а сцена: её место в отдельном
 * графическом блоке.
 */
export const insetBand = {
  top: { from: safe.top, to: faceZone.top },
  bottom: { from: faceZone.bottom, to: VIDEO.height - safe.bottom },
  height(place: 'top' | 'bottom') {
    const band = place === 'top' ? this.top : this.bottom;
    return Math.max(0, band.to - band.from);
  },
} as const;

/** Отступы-обёртка сцены. Держат контент внутри рабочей зоны. */
export const sceneInset = {
  paddingTop: safe.top,
  paddingBottom: safe.bottom,
  paddingLeft: PAGE_PAD,
  paddingRight: PAGE_PAD,
} as const;

/**
 * Субтитры вообще есть — свои или чужие. Значит текст в кадре речь не
 * пересказывает: он остаётся якорем смысла, а не второй строкой субтитров.
 */
export const hasSubtitles = subtitleMode !== 'none';

/** Субтитры накладывает сторонний сервис. */
export const externalSubtitles = subtitleMode === 'external';

/** Секунды -> кадры. Единственный правильный способ пересчёта, fps из конфига. */
export const toFrames = (seconds: number) => Math.round(seconds * VIDEO.fps);

/** Кадры -> секунды. */
export const toSeconds = (frames: number) => frames / VIDEO.fps;

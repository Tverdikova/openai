import type { StyleTokens } from '../core/style-contract';

/**
 * НЕЙТРАЛЬНЫЙ СТИЛЬ ПО УМОЛЧАНИЮ.
 *
 * Он специально скучный: тёмный фон, один спокойный акцент, один шрифт. Это не
 * образец для подражания, а рабочая заглушка, чтобы система собирала ролики с
 * первой минуты. Свой стиль подключается просьбой «поменяй стиль» — она перекладывает
 * сюда ваш дизайн-код.
 *
 * Обязательный минимум полей описан в core/style-contract.ts. Всё, что имеет
 * смысл только в этом визуальном языке, живёт в `extra` — ядро туда не смотрит.
 */
export const tokens: StyleTokens = {
  name: 'Нейтральный (по умолчанию)',

  color: {
    text: '#F4F5F7',
    textMuted: 'rgba(244,245,247,0.55)',
    textFaint: 'rgba(244,245,247,0.22)',
    bg: '#101114',
    bgTop: '#1a1b1f',
    accent: '#5B8DEF',
    accentSoft: 'rgba(91,141,239,0.22)',
    surface: 'rgba(255,255,255,0.04)',
    surfaceBorder: 'rgba(255,255,255,0.08)',
  },

  type: {
    hero: { size: 88, weight: 800, lh: 1.06, ls: '-0.02em', family: 'Inter, sans-serif', uppercase: true },
    heroTight: { size: 76, weight: 800, lh: 1.06, ls: '-0.02em', family: 'Inter, sans-serif', uppercase: true },
    title: { size: 56, weight: 800, lh: 1.12, ls: '-0.01em', family: 'Inter, sans-serif' },
    stat: { size: 132, weight: 800, lh: 1.0, ls: '-0.03em', family: 'Inter, sans-serif' },
    label: { size: 24, weight: 700, lh: 1.2, ls: '0.08em', family: 'Inter, sans-serif', uppercase: true },
    body: { size: 30, weight: 400, lh: 1.5, ls: '0', family: 'Inter, sans-serif' },
  },

  radius: { card: 24, pill: 100, bar: 12 },

  space: { gap: 18 },

  extra: {
    /** Мягкое свечение вокруг активного элемента. */
    glow: '0 0 40px rgba(91,141,239,0.28)',
    /** Фоновая сетка: шаг клетки и цвет линии. */
    grid: { cell: 92, line: 'rgba(255,255,255,0.025)' },
    /** Плотность живой «пыли» в фоновом слое. */
    dust: 14,
  },
};

/**
 * ПРО КЕГЛИ. Числа в `type` выверены под русский капс на ширине кадра 1080 с
 * полями по 60 — полезная полоса 960px. Самое длинное неразрывное слово при
 * hero=88 влезает с запасом; при 108 уже обрезалось.
 *
 * Менять их на глаз не нужно: строки всё равно измеряются по-настоящему в
 * core/text.tsx, и слишком длинная фраза сама разложится на строки. Кегль здесь
 * задаёт потолок, а не гарантию.
 */

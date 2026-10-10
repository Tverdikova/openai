import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { VIDEO, captionBox, subtitles } from './format';
import { buildCaptionPages, type CaptionPage, type CaptionWord } from './caption-pages';
import { color, radius, tokens, type } from './style';
import { ease } from './timing';

/**
 * СЛОЙ СУБТИТРОВ. Рисуется поверх графики сцен и живёт по общему для всего
 * ролика номеру кадра — поэтому подсветка слова совпадает с голосом с точностью
 * до кадра, а не «примерно».
 *
 * Два вида, и разница между ними принципиальная:
 *
 *   white — привычные белые субтитры. Белый цвет здесь ОСОЗНАННОЕ отступление
 *           от палитры стиль-пака, единственное во всей системе: это вариант
 *           «как у всех», его выбирают именно затем, чтобы не выделяться.
 *           Из стиля берётся только шрифт;
 *   brand — цвет, шрифт и подсветка целиком из стиль-пака.
 *
 * Ничего, кроме шрифта и палитры, отсюда наружу не торчит: где именно проходит
 * полоса субтитров, решает `captionBox` в ядре, и та же величина учтена в
 * нижней границе безопасной зоны.
 */

/** Вход страницы: короткий подъём с прозрачностью. */
const PAGE_IN = 5;
/** Отклик на подсветку слова. */
const WORD_POP = 4;

/**
 * Насколько подсвеченное слово подрастает — и почему так мало.
 *
 * Увеличение раздвигает букву вширь, но соседей не двигает: разметка считается
 * по исходному размеру. Длинное слово при заметном увеличении наползает на
 * соседнее, и вместо «раз в квартал открывайте» получается «кварталоткрывайте».
 * Поэтому прибавка маленькая, а промежуток между словами взят с запасом на неё.
 */
const WORD_SCALE = 1.04;
/** Промежуток между словами, в долях кегля. Больше половины прибавки от роста. */
const WORD_GAP = 0.34;

const captionStep = {
  ...type.title,
  size: captionBox.fontSize,
  uppercase: false,
};

const looks = {
  white: {
    text: '#FFFFFF',
    /** Тёмная подложка: белый по светлой картинке иначе не читается. */
    plate: subtitles.plate ? 'rgba(0,0,0,0.55)' : 'transparent',
    /** Без подложки читаемость держит мягкая тень — она же и есть подложка по контуру. */
    shadow: subtitles.plate
      ? '0 2px 12px rgba(0,0,0,0.45)'
      : '0 2px 10px rgba(0,0,0,0.55), 0 0 26px rgba(0,0,0,0.35)',
    highlight: subtitles.accent ?? color.accent,
    glow: undefined as string | undefined,
  },
  brand: {
    text: color.text,
    /**
     * Фирменный вид. Без подложки читаемость держит контурная тень цветом фона —
     * так и было задумано. Но на светлом стиле, да ещё поверх пёстрого видео,
     * тени не хватает: там включается подложка цветом фона стиля, и субтитры
     * ложатся на свою же плашку, а не на чужую картинку.
     */
    plate: subtitles.plate ? (color.bgTop ?? color.bg) : 'transparent',
    shadow: `0 0 14px ${color.bg}, 0 2px 6px ${color.bg}`,
    highlight: color.accent,
    glow: typeof tokens.extra?.glow === 'string' ? (tokens.extra.glow as string) : undefined,
  },
} as const;

const Word: React.FC<{
  text: string;
  active: boolean;
  frame: number;
  look: (typeof looks)['white'] | (typeof looks)['brand'];
}> = ({ text, active, frame, look }) => {
  const pop = active
    ? interpolate(frame, [0, WORD_POP], [0, 1], {
        easing: ease.pop,
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 0;

  return (
    <span
      style={{
        display: 'inline-block',
        color: active ? look.highlight : look.text,
        transform: `translateY(${-3 * pop}px) scale(${1 + (WORD_SCALE - 1) * pop})`,
        textShadow: active && look.glow ? look.glow : look.shadow,
      }}
    >
      {text}
    </span>
  );
};

const Page: React.FC<{ page: CaptionPage; frame: number }> = ({ page, frame }) => {
  const local = frame - page.from;
  const look = looks[subtitles.look === 'brand' ? 'brand' : 'white'];

  const appear = interpolate(local, [0, PAGE_IN], [0, 1], {
    easing: ease.enter,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: `${Math.round(captionBox.fontSize * 0.12)}px ${Math.round(captionBox.fontSize * WORD_GAP)}px`,
        maxWidth: captionBox.width,
        padding: `${captionBox.padY}px ${Math.round(captionBox.fontSize * 0.5)}px`,
        borderRadius: radius.card ?? 24,
        background: look.plate,
        fontFamily: captionStep.family,
        fontWeight: subtitles.weight ?? Math.max(captionStep.weight, 700),
        fontSize: captionStep.size,
        lineHeight: captionBox.lineHeight,
        letterSpacing: captionStep.ls,
        textAlign: 'center',
        wordBreak: 'keep-all',
        hyphens: 'none',
        opacity: appear,
        transform: `translateY(${(1 - appear) * 14}px)`,
      }}
    >
      {page.words.map((word, i) => (
        <Word
          key={`${word.from}-${i}`}
          text={word.text}
          active={subtitles.highlight && frame >= word.from && frame < word.to}
          frame={frame - word.from}
          look={look}
        />
      ))}
    </div>
  );
};

/**
 * Слой субтитров ролика. Слова приходят из `work/words.clean.json` проекта —
 * их кладёт в проект сборка каркаса, отдельного распознавания не бывает.
 */
export const Captions: React.FC<{ words: CaptionWord[] }> = ({ words }) => {
  const frame = useCurrentFrame();

  const pages = React.useMemo(
    () => buildCaptionPages(words, captionStep, VIDEO.fps),
    [words],
  );

  const page = pages.find((p) => frame >= p.from && frame < p.to);
  if (!page) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: captionBox.bottom,
        minHeight: captionBox.height,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-end',
        pointerEvents: 'none',
      }}
    >
      <Page page={page} frame={frame} />
    </div>
  );
};

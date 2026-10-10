import React, { useEffect, useMemo, useState } from 'react';
import { AbsoluteFill, Easing, continueRender, delayRender, interpolate, useCurrentFrame } from 'remotion';
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { VIDEO, captionBox, safe, subtitles } from './format';
import { zoomAt, zoomSegments, type KineticPhrase, type KineticWord } from './kinetic';

/**
 * СЛОЙ КИНЕТИЧЕСКИХ СУБТИТРОВ — вид `kinetic`, базовый.
 *
 * Ударное слово всегда подгоняется под одну ширину, поэтому короткое выходит
 * огромным, длинное — мельче. Мелкие строки одного кегля стоят вплотную к нему
 * и гуляют по горизонтали. Слова проявляются по одному, фраза уходит встык со
 * следующей.
 *
 * Как и белые субтитры, вид живёт вне палитры стиль-пака: белый текст и свои
 * шрифты — чтобы ролик выглядел готовым ещё до подключения своего стиля.
 */

const montserrat = loadMontserrat('normal', { weights: ['900'], subsets: ['cyrillic', 'latin'] });
const inter = loadInter('normal', { weights: ['500'], subsets: ['cyrillic', 'latin'] });

const BIG_FAMILY = montserrat.fontFamily;
const SMALL_FAMILY = inter.fontFamily;

/** Ширина, под которую подгоняется ударное слово. */
const BIG_WIDTH = Math.round(VIDEO.width * 0.74);
/** Потолок кегля ударного слова: короткое слово не должно съесть полкадра. */
const BIG_MAX = Math.round(VIDEO.width * 0.2 * subtitles.size);
const SMALL = Math.round(VIDEO.width * 0.057 * subtitles.size);
const FADE_IN = 4;
const FADE_OUT = 6;
/** Отступ верхних фраз от мёртвой зоны сверху. */
const TOP_GAP = 24;
const SHADOW = '0 3px 14px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.25)';

const ctx = () => {
  const canvas = document.createElement('canvas');
  return canvas.getContext('2d')!;
};
let measureCtx: CanvasRenderingContext2D | null = null;
const measure = (text: string, font: string) => {
  measureCtx ??= ctx();
  measureCtx.font = font;
  return measureCtx.measureText(text).width || 1;
};
const bigSize = (text: string) =>
  Math.min(BIG_MAX, Math.floor((100 * BIG_WIDTH) / measure(text, `900 100px ${BIG_FAMILY}`)));

/** Хвосты букв уходят под строку: мелкой строке под таким словом нужен зазор. */
const DESCENDERS = /[урфдцщyqgpj]/i;

/**
 * Ширина блока — по ударному слову. Короткое слово упирается в потолок кегля и
 * выходит уже полосы: мелкие строки гуляют тогда в его ширине, а не в полосе.
 */
const phraseWidth = (phrase: KineticPhrase) => {
  const big = phrase.lines.find((l) => l.big);
  if (!big) return BIG_WIDTH;
  const text = big.words.map((w) => w.text).join(' ');
  const bigW = (measure(text, `900 100px ${BIG_FAMILY}`) * bigSize(text)) / 100;
  const smallW = Math.max(
    0,
    ...phrase.lines.filter((l) => !l.big).map((l) => measure(l.words.map((w) => w.text).join(' '), `500 ${SMALL}px ${SMALL_FAMILY}`)),
  );
  return Math.min(BIG_WIDTH, Math.max(bigW, smallW));
};

const useFonts = () => {
  const [ready, setReady] = useState(false);
  const [handle] = useState(() => delayRender('Шрифты кинетических субтитров'));
  useEffect(() => {
    Promise.all([montserrat.waitUntilDone(), inter.waitUntilDone()])
      .then(() => document.fonts.ready)
      .catch(() => undefined)
      .then(() => {
        setReady(true);
        continueRender(handle);
      });
  }, [handle]);
  return ready;
};

const Word: React.FC<{ word: KineticWord; frame: number }> = ({ word, frame }) => (
  <span
    style={{
      opacity: interpolate(frame, [word.from, word.from + FADE_IN], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      }),
    }}
  >
    {word.text}
  </span>
);

const Phrase: React.FC<{ phrase: KineticPhrase; top: boolean; frame: number }> = ({ phrase, top, frame }) => {
  const opacity = phrase.fade
    ? interpolate(frame, [phrase.to - FADE_OUT, phrase.to], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;
  const width = phraseWidth(phrase);

  return (
    <div
      style={{
        position: 'absolute',
        left: (VIDEO.width - width) / 2,
        width,
        ...(top ? { top: safe.top + TOP_GAP } : { bottom: captionBox.bottom }),
        display: 'flex',
        flexDirection: 'column',
        color: '#FFFFFF',
        textShadow: SHADOW,
        opacity,
      }}
    >
      {phrase.lines.map((line, i) => {
        if (line.big) {
          const text = line.words.map((w) => w.text).join(' ');
          const size = bigSize(text);
          const below = i < phrase.lines.length - 1 && DESCENDERS.test(text) ? 0.1 : -0.02;
          return (
            <div
              key={i}
              style={{
                fontFamily: BIG_FAMILY,
                fontWeight: 900,
                fontSize: size,
                lineHeight: 0.8,
                whiteSpace: 'nowrap',
                textAlign: 'center',
                margin: `${Math.round(-0.04 * size)}px 0 ${Math.round(below * size)}px`,
              }}
            >
              {line.words.map((w, k) => (
                <Word key={k} word={w} frame={frame} />
              ))}
            </div>
          );
        }
        return (
          <div
            key={i}
            style={{
              fontFamily: SMALL_FAMILY,
              fontWeight: 500,
              fontSize: SMALL,
              lineHeight: 1,
              letterSpacing: '-0.02em',
              whiteSpace: 'nowrap',
              display: 'flex',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <div
              style={{
                marginLeft: `${line.align * 100}%`,
                transform: `translateX(${-line.align * 100}%)`,
                display: 'flex',
                gap: '0.24em',
              }}
            >
              {line.words.map((w, k) => (
                <Word key={k} word={w} frame={frame} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/**
 * `cameraRanges` — отрезки, где в кадре человек. Верхние фразы встают наверх
 * только там: на графике верх кадра занят сценой, и фраза идёт вниз.
 */
export const KineticCaptions: React.FC<{
  phrases: KineticPhrase[];
  cameraRanges: Array<[number, number]>;
}> = ({ phrases, cameraRanges }) => {
  const frame = useCurrentFrame();
  const ready = useFonts();
  if (!ready) return null;

  const phrase = phrases.find((p) => frame >= p.from && frame < p.to);
  if (!phrase) return null;
  const onCamera = cameraRanges.some(([a, b]) => phrase.from >= a && phrase.from < b);

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <Phrase phrase={phrase} top={phrase.top && onCamera} frame={frame} />
    </AbsoluteFill>
  );
};

const ZOOM_EASE = {
  push: Easing.inOut(Easing.sin),
  punch: Easing.out(Easing.cubic),
};

/** Видео с камеры с зумом по плану субтитров. */
export const CameraZoom: React.FC<{ phrases: KineticPhrase[]; children: React.ReactNode }> = ({
  phrases,
  children,
}) => {
  const frame = useCurrentFrame();
  const segments = useMemo(() => zoomSegments(phrases), [phrases]);
  const scale = zoomAt(frame, segments, ZOOM_EASE);
  return (
    <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: '50% 40%' }}>
      {children}
    </AbsoluteFill>
  );
};

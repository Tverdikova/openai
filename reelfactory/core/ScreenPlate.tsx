import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame, interpolate } from 'remotion';
import { SAFE_WIDTH } from './format';
import project from '../config/project.json';
import { style } from './style';
import { breathe, drift } from './motion';
import { enter } from './anim';
import { dur, ease } from './timing';
import { FitText } from './text';

/**
 * СКРИН В КАДРЕ. Снимок чужого экрана нельзя поставить как есть: он чужой по
 * стилю и неподвижен, а неподвижная картинка под звучащий голос — брак.
 *
 * Этот компонент решает обе беды разом:
 *   · оправа берётся из стиль-пака, поэтому снимок выглядит частью вашего мира;
 *   · картинка живёт всё время — медленный наезд и едва заметный дрейф;
 *   · есть наезд на нужный фрагмент: цифра «12 825» в общем плане на вертикали
 *     нечитаема, и ради неё снимок берётся крупно;
 *   · есть проход камеры по снимку — так читают длинную страницу, сверху вниз;
 *   · сверху ложится акцентное слово — то, ради чего снимок вообще показан.
 *
 * Скрин — доказательство, а не иллюстрация: он появляется там, где сцена
 * утверждает факт, в котором зритель может усомниться.
 *
 * ОПРАВА ДЕРЖИТ ПРОПОРЦИИ СНИМКА, а не квадрат: широкая страница в квадратной
 * оправе теряет края, и вместе с ними приметы, по которым её узнают.
 *
 * НАЕЗД НУЖЕН НЕ ВСЕГДА. Доказательство в мелкой цифре — наезд обязателен, иначе
 * цифра нечитаема. Доказательство в самой странице («это правда их сайт») — наезд
 * вреден: он съедает ровно то, по чему страницу узнают. Поэтому без `focus` и без
 * `pan` снимок показывается целиком.
 */
export interface ScreenPlateProps {
  /** Путь внутри public: например `2026-08-09-tema/shots/pricing.png`. */
  src: string;

  /**
   * Куда смотреть, в долях от 0 до 1 относительно снимка.
   * Не задано — показывается верхняя часть картинки.
   */
  focus?: { x: number; y: number; scale?: number };

  /** Акцентное слово или число поверх снимка. */
  accent?: string;

  /** Ширина оправы в пикселях кадра. */
  width?: number;

  /**
   * Высота оправы. По умолчанию считается из пропорций снимка — см. `aspect`.
   */
  height?: number;

  /**
   * Пропорции снимка, ширина к высоте. По умолчанию — пропорции окна съёмки из
   * `config/project.json` (`shots.viewport`): именно в нём система снимает
   * страницы, и оправа обязана им соответствовать. Для чужого файла с других
   * пропорций число указывается руками.
   */
  aspect?: number;

  /**
   * ПРОХОД КАМЕРЫ ПО СНИМКУ. Пока снимок висит в кадре, взгляд едет от одной
   * точки к другой — так читают длинную страницу, сверху вниз.
   *
   * Раньше выбор был плохой: показать страницу целиком и не прочитать её или
   * взять крупно и потерять всё остальное. Проход снимает выбор: сначала видно,
   * что это за страница, потом камера подъезжает и идёт по ней.
   */
  pan?: {
    from: { x: number; y: number; scale?: number };
    to: { x: number; y: number; scale?: number };
    /** За сколько кадров пройти путь. По умолчанию — длина типичной врезки. */
    frames?: number;
    /** Задержка старта: сначала общий план, потом движение. */
    delay?: number;
  };

  /** Насколько сильно наезжает камера за время сцены. */
  zoom?: number;
}

/** Пропорции окна съёмки: в нём система снимает страницы. */
const SHOT_ASPECT = project.shots.viewport.width / project.shots.viewport.height;

/** Сколько кадров идёт проход, если не сказано иначе. */
const PAN_FRAMES = 120;

export const ScreenPlate: React.FC<ScreenPlateProps> = ({
  src,
  focus,
  accent,
  width = SAFE_WIDTH,
  height,
  aspect = SHOT_ASPECT,
  pan,
  zoom = 0.08,
}) => {
  const frame = useCurrentFrame();
  const { tokens } = style;

  const plateHeight = height ?? Math.round(width / aspect);
  const appear = enter(frame);

  /**
   * Ход прохода: 0 — камера в начальной точке, 1 — в конечной. Считается от
   * номера кадра, как и всё остальное движение в системе.
   */
  const travel = pan
    ? interpolate(
        frame,
        [pan.delay ?? 0, (pan.delay ?? 0) + (pan.frames ?? PAN_FRAMES)],
        [0, 1],
        { easing: ease.fill, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
      )
    : 0;

  const eye = pan
    ? {
        x: pan.from.x + (pan.to.x - pan.from.x) * travel,
        y: pan.from.y + (pan.to.y - pan.from.y) * travel,
        scale: (pan.from.scale ?? 1.6) + ((pan.to.scale ?? 1.6) - (pan.from.scale ?? 1.6)) * travel,
      }
    : focus
      ? { x: focus.x, y: focus.y, scale: focus.scale ?? 1.6 }
      : null;

  // Медленный наезд на всю длину сцены — то самое живое послесвечение.
  const creep = interpolate(frame, [0, 300], [1, 1 + zoom], {
    easing: ease.fill,
    extrapolateRight: 'clamp',
  });
  // Ни точки взгляда, ни прохода — доказательство в самой странице: она
  // показывается целиком, и трогать масштаб нечем.
  const scale = (eye?.scale ?? 1) * creep;

  // Едва заметное плавание, чтобы кадр дышал даже при остановленном наезде.
  const float = drift(frame, `plate-${src}`, 6);
  const glowPulse = breathe(frame, { min: 0.5, max: 1 });

  const originX = eye ? eye.x * 100 : 50;
  const originY = eye ? eye.y * 100 : 50;

  const glow = (tokens.extra?.glow as string) ?? 'none';
  const radius = tokens.radius.card ?? 24;

  return (
    <div style={{ ...appear }}>
      <div
        style={{
          position: 'relative',
          width,
          height: plateHeight,
          borderRadius: radius,
          overflow: 'hidden',
          border: `1px solid ${tokens.color.surfaceBorder ?? tokens.color.textMuted}`,
          boxShadow: glow,
          opacity: 0.55 + 0.45 * glowPulse,
        }}
      >
        <AbsoluteFill>
          <Img
            src={staticFile(src)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: `${originX}% ${originY}%`,
              transform: `scale(${scale}) translate(${float.x}px, ${float.y}px)`,
              transformOrigin: `${originX}% ${originY}%`,
            }}
          />
        </AbsoluteFill>

        {/* Блик по стеклу — снимок становится частью нашего мира, а не вставкой */}
        <AbsoluteFill
          style={{
            background: `linear-gradient(160deg, ${tokens.color.accent}22 0%, transparent 45%)`,
            pointerEvents: 'none',
          }}
        />
      </div>

      {accent && (
        <div
          style={{
            marginTop: -Math.round(plateHeight * 0.16),
            marginLeft: 24,
            position: 'relative',
            display: 'inline-block',
            padding: '10px 22px',
            borderRadius: tokens.radius.pill ?? 100,
            background: tokens.color.bg,
            border: `1px solid ${tokens.color.accent}`,
            opacity: interpolate(frame, [dur.enter, dur.enter + dur.accent], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <FitText step={tokens.type.label} color={tokens.color.accent} maxWidth={width - 80}>
            {accent}
          </FitText>
        </div>
      )}
    </div>
  );
};

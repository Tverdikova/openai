import React from 'react';
import { AbsoluteFill, random, useCurrentFrame } from 'remotion';
import { VIDEO, safe } from '../core/format';
import { breathe, drift } from '../core/motion';
import { tokens } from './tokens';

/**
 * ВСЕГДА-ЖИВОЙ СЛОЙ. Лежит под каждой сценой и обеспечивает движение даже там,
 * где сцена его не дала. Статика при звучащем голосе — брак, и этот слой не даёт
 * ему случиться на уровне системы.
 *
 * Чем именно живёт кадр — решает стиль. Здесь это медленная светящаяся пыль;
 * в рисованном стиле уместнее дрожание контура, в пиксельном — рябь плитки.
 *
 * Частицы держатся в рабочей зоне и остаются тусклыми: это фон, а не событие.
 */
export const Ambient: React.FC = () => {
  const frame = useCurrentFrame();
  const count = (tokens.extra?.dust as number) ?? 14;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {Array.from({ length: count }).map((_, i) => {
        const seed = `dust-${i}`;
        const x = random(seed + 'x') * VIDEO.width;
        const y = safe.top + random(seed + 'y') * (safe.contentHeight - 120);
        const d = drift(frame, seed, 26 + random(seed + 'a') * 34);
        const size = 3 + random(seed + 's') * 6;
        const twinkle = breathe(frame, {
          period: 120 + random(seed + 'p') * 160,
          min: 0.05,
          max: 0.22,
          phase: random(seed + 'ph'),
        });

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x + d.x,
              top: y + d.y,
              width: size,
              height: size,
              borderRadius: '50%',
              background: tokens.color.accent,
              opacity: twinkle,
              boxShadow: `0 0 ${size * 2.5}px ${tokens.color.accentSoft}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { VIDEO, safe, sceneInset } from './format';

/**
 * ОБЁРТКА СЦЕНЫ. Держит весь контент внутри рабочей зоны кадра: сверху мёртвая
 * полоса под интерфейс соцсети, снизу — под подпись, кнопки и субтитры.
 *
 * Любая сцена оборачивает содержимое в <Scene>, а не расставляет отступы руками.
 * Тогда попасть под кнопку «поделиться» просто нечем.
 */
export const Scene: React.FC<{
  children: React.ReactNode;
  /** Показать границы мёртвых зон и линию глаз — для проверки вёрстки. */
  debug?: boolean;
}> = ({ children, debug = false }) => (
  <AbsoluteFill>
    <AbsoluteFill style={{ ...sceneInset, display: 'flex', flexDirection: 'column' }}>
      {children}
    </AbsoluteFill>
    {debug && <SafeZoneOverlay />}
  </AbsoluteFill>
);

/**
 * Отладочная разметка. В финальный рендер не идёт.
 * Важно: если меришь вёрстку по скриншоту — красные линии оверлея из замера
 * исключать, иначе примешь собственную разметку за выход за границы.
 */
export const SafeZoneOverlay: React.FC = () => {
  const line = (top: number, label: string, dashed = true) => (
    <div
      style={{
        position: 'absolute',
        top,
        left: 0,
        width: '100%',
        borderTop: `2px ${dashed ? 'dashed' : 'solid'} rgba(255,80,80,0.8)`,
      }}
    >
      <span
        style={{
          position: 'absolute',
          right: 12,
          top: 4,
          fontFamily: 'monospace',
          fontSize: 22,
          color: 'rgba(255,120,120,0.95)',
        }}
      >
        {label}
      </span>
    </div>
  );

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: safe.top,
          background: 'rgba(255,0,0,0.12)',
        }}
      />
      {line(safe.top, `safe top ${safe.top}px`, false)}
      {line(safe.eyeLine, `eye line ${Math.round(safe.eyeLine)}px`)}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          width: '100%',
          height: safe.bottom,
          background: 'rgba(255,0,0,0.12)',
        }}
      />
      {line(VIDEO.height - safe.bottom, `safe bottom ${VIDEO.height - safe.bottom}px`, false)}
    </AbsoluteFill>
  );
};

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { style } from './style';

/**
 * СЦЕНА-ПОДЛОЖКА. Всё, что рендерится, оборачивается сюда.
 *
 * Даёт три вещи разом: загруженные шрифты стиля, неподвижный фон и всегда-живой
 * слой поверх него. Последнее — не украшение, а страховка: даже если сцена
 * замерла, кадр не мёртвый.
 */
export const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { FontLoader } = style;
  return (
    <FontLoader>
      <AbsoluteFill>
        <Backdrop />
        {children}
      </AbsoluteFill>
    </FontLoader>
  );
};

/**
 * НЕПРОЗРАЧНАЯ ПОДЛОЖКА СТИЛЯ: фон плюс живой слой. Вынесена отдельно, потому
 * что нужна в двух местах — под всем роликом и ещё раз поверх видео с камеры,
 * в тех блоках, где человек уходит с экрана и остаётся графика. Инфографика
 * рисуется на своём фоне, а не поверх лица: см. `core/reel.ts`.
 */
export const Backdrop: React.FC = () => {
  const { Background, Ambient } = style;
  return (
    <AbsoluteFill>
      <Background />
      <Ambient />
    </AbsoluteFill>
  );
};

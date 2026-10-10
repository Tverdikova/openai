import React, { useEffect, useState } from 'react';
import { continueRender, delayRender } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';

/**
 * Шрифты стиля. Нейтральный пак обходится одним семейством.
 *
 * Подписки кириллицы обязательна: без неё русский текст молча съезжает на
 * запасной шрифт, и вся выверка кеглей перестаёт что-либо значить.
 */
const inter = loadFont('normal', {
  weights: ['400', '700', '800'],
  subsets: ['cyrillic', 'latin'],
});

/**
 * Задерживает рендер кадров, пока шрифты не готовы.
 * delayRender вызывается внутри состояния компонента, а не на верхнем уровне
 * модуля — иначе первый кадр уходит в рендер с неготовым шрифтом.
 */
export const FontLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [handle] = useState(() => delayRender('Загрузка шрифтов стиля'));

  useEffect(() => {
    inter
      .waitUntilDone()
      .then(() => continueRender(handle))
      .catch(() => continueRender(handle));
  }, [handle]);

  return <>{children}</>;
};

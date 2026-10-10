import React from 'react';
import { useCurrentFrame } from 'remotion';
import { PAGE_PAD, VIDEO, faceZone, insetBand } from './format';
import { enter } from './anim';
import { breathe, drift } from './motion';

/**
 * ВРЕЗКА ПОВЕРХ ГОВОРЯЩЕГО ЧЕЛОВЕКА.
 *
 * Единственное разрешённое исключение из правила «человек или графика, но не
 * вместе». Правило запрещает не всякую графику поверх видео, а КОНКУРЕНЦИЮ ЗА
 * ВНИМАНИЕ: полноценная сцена поверх лица заставляет зрителя выбирать, куда
 * смотреть, и он не читает ни лицо, ни инфографику.
 *
 * Врезка устроена иначе. Это маленькое доказательство — скрин, число, короткая
 * подпись, — которое лежит В СТОРОНЕ ОТ ЛИЦА и работает вместе с речью, а не
 * вместо неё. Человек говорит «вот их цена» — рядом появляется цена.
 *
 * ЛИЦО ЗАКРЫТЬ НЕЛЬЗЯ — и это не пожелание, а устройство компонента. Врезка
 * умеет стоять только в двух полосах: над зоной лица и под ней (`core/format.ts`,
 * `insetBand`). Не влезло в полосу — значит это не врезка, а сцена, и ей место в
 * отдельном графическом блоке. Тогда компонент останавливает сборку с прямым
 * объяснением, а не молча наезжает на лицо.
 *
 * Полноценную сцену поверх лица система по-прежнему не соберёт: `defineReel` не
 * даст указать блоку и `camera`, и `scene` разом.
 */
export interface CameraInsetProps {
  children: React.ReactNode;
  /** Над лицом или под ним. По умолчанию сверху — там обычно пустой фон. */
  place?: 'top' | 'bottom';
  /** С какой стороны прижать. `center` — по середине кадра. */
  align?: 'left' | 'right' | 'center';
  /** Высота врезки в пикселях кадра. Больше полосы — сборка остановится. */
  height?: number;
  /** Ширина врезки. По умолчанию — половина кадра. */
  width?: number;
  /** Задержка появления в кадрах: врезка часто приходит на нужном слове. */
  delay?: number;
}

export const CameraInset: React.FC<CameraInsetProps> = ({
  children,
  place = 'top',
  align = 'right',
  height,
  width = Math.round(VIDEO.width * 0.46),
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const band = place === 'top' ? insetBand.top : insetBand.bottom;
  const available = insetBand.height(place);
  const box = height ?? Math.round(available * 0.82);

  if (available <= 0) {
    throw new Error(
      `Врезка «${place}»: полосы для неё не осталось. Сверху её съедает мёртвая зона, ` +
        `снизу — субтитры. Поставьте врезку с другой стороны или сделайте отдельный графический блок.`,
    );
  }

  if (box > available) {
    throw new Error(
      `Врезка «${place}» просит ${box}px, а до зоны лица есть только ${available}px. ` +
        `Врезка не имеет права закрывать лицо. Уменьшите высоту или вынесите это в отдельный ` +
        `графический блок — там места весь кадр.`,
    );
  }

  const appear = enter(frame, delay);
  // Врезка живёт: медленное плавание и дыхание. Неподвижная картинка поверх
  // движущегося видео читается как приклеенный стикер.
  const float = drift(frame, `inset-${place}-${align}`, 5);
  const life = breathe(frame, { period: 90, min: 0.9, max: 1 });

  const horizontal =
    align === 'center'
      ? { left: Math.round((VIDEO.width - width) / 2) }
      : align === 'left'
        ? { left: PAGE_PAD }
        : { right: PAGE_PAD };

  // Внутри полосы врезка стоит по центру: так она одинаково далека и от мёртвой
  // зоны, и от лица.
  const top = band.from + Math.round((available - box) / 2);

  return (
    <div
      style={{
        position: 'absolute',
        top: top + float.y,
        ...horizontal,
        width,
        height: box,
        opacity: (appear.opacity as number) * life,
        transform: `${appear.transform} translateX(${float.x}px)`,
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  );
};

/**
 * Отладочная разметка зоны лица. Пригодна ровно для одного: посмотреть глазами,
 * что врезка стоит там, где думаешь. В рендер не идёт.
 */
export const FaceZoneOverlay: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      top: faceZone.top,
      left: 0,
      width: '100%',
      height: faceZone.bottom - faceZone.top,
      border: '2px dashed rgba(255,80,80,0.8)',
      pointerEvents: 'none',
    }}
  />
);

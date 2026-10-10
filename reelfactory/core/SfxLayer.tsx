import React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';
import type { PlannedCue } from './sfx';

/**
 * ВОСПРОИЗВЕДЕНИЕ звука движения. Тонкий слой: что прозвучит, посчитано в
 * `core/sfx.ts` по ролику целиком.
 *
 * Решений здесь нет намеренно. Компонент видит только свой кадр, а прореживание
 * требует видеть соседей по всему ролику — каша заводится ровно на стыках, где
 * блок о блоке ничего не знает.
 *
 * Каждое попадание — своя короткая дорожка. Одной общей обойтись нельзя:
 * попадания накладываются хвостами, и вторая половина щелчка обязана звучать
 * поверх начала следующего, а не обрывать его.
 */
export const SfxLayer: React.FC<{ cues: PlannedCue[] }> = ({ cues }) => (
  <>
    {cues.map((cue, index) => (
      <Sequence
        // Кадр и файл вместе дают устойчивый ключ; индекс добавлен на случай
        // двух одинаковых звуков в одном кадре — такое бывает после сдвига по
        // пику, и React не должен считать их одним элементом.
        key={`${cue.frame}-${cue.file}-${index}`}
        from={cue.frame}
        durationInFrames={cue.frames}
        /* Обязательно: без этого пустая последовательность становится блоком в
           потоке вёрстки и ловит на себя переходы соседей. */
        layout="none"
      >
        <Audio
          src={staticFile(cue.file)}
          {...(cue.startFrom > 0 ? { startFrom: cue.startFrom } : {})}
          volume={
            cue.fadeOut > 0
              ? (frame) => cue.volume * Math.min(1, Math.max(0, (cue.frames - frame) / cue.fadeOut))
              : cue.volume
          }
        />
      </Sequence>
    ))}
  </>
);

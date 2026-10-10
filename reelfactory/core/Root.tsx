import React from 'react';
import { ReelComposition } from './ReelComposition';
import { reels } from '../projects/registry';

/**
 * РЕЕСТР КОМПОЗИЦИЙ. Список роликов не пишется здесь руками — он берётся из
 * projects/registry.ts, куда проект попадает в момент приёма материала.
 * Добавился ролик — он сразу виден в студии и доступен рендеру.
 */
export const Root: React.FC = () => (
  <>
    {reels.map((reel) => (
      <ReelComposition key={reel.id} reel={reel} />
    ))}
  </>
);

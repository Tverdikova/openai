import React from 'react';
import { Composition } from 'remotion';
import { VIDEO } from './format';
import { reelComponent } from './compose';
import type { Reel } from './reel';

/**
 * КОМПОЗИЦИЯ ОДНОГО РОЛИКА. Её свойства описаны в одном месте: студия собирает
 * из неё список всех роликов, а рендер — точку входа ровно с одним. Так рендер
 * не тянет в сборку код чужих роликов.
 */
export const ReelComposition: React.FC<{ reel: Reel }> = ({ reel }) => (
  <Composition
    id={reel.id}
    component={reelComponent(reel)}
    durationInFrames={reel.totalFrames}
    fps={VIDEO.fps}
    width={VIDEO.width}
    height={VIDEO.height}
  />
);

import React from 'react';
import { AbsoluteFill } from 'remotion';
import { tokens } from './tokens';

/**
 * Неподвижная подложка кадра. Здесь стиль заявляет свой мир: у одного это тёмное
 * стекло с сеткой, у другого — бумага, у третьего — пиксельная плитка.
 */
export const Background: React.FC = () => {
  const grid = tokens.extra?.grid as { cell: number; line: string };

  return (
    <AbsoluteFill
      style={{ background: `linear-gradient(160deg, ${tokens.color.bgTop} 0%, ${tokens.color.bg} 100%)` }}
    >
      <AbsoluteFill
        style={{
          backgroundImage:
            `linear-gradient(${grid.line} 1px, transparent 1px),` +
            `linear-gradient(90deg, ${grid.line} 1px, transparent 1px)`,
          backgroundSize: `${grid.cell}px ${grid.cell}px`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 30%, ${tokens.color.accentSoft} 0%, transparent 55%)`,
          opacity: 0.5,
        }}
      />
    </AbsoluteFill>
  );
};

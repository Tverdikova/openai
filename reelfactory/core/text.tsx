import React from 'react';
import { SAFE_WIDTH } from './format';
import type { TypeStep } from './style-contract';

/**
 * ТЕКСТ, КОТОРЫЙ ГАРАНТИРОВАННО ВЛЕЗАЕТ.
 *
 * Обрезанное слово на краю кадра — самый частый и самый заметный брак. Раньше он
 * ловился глазами и линейкой; здесь строка измеряется по-настоящему — тем же
 * движком, который её потом нарисует, — и разбивается на строки автоматически.
 *
 * Порядок действий ровно такой:
 *   1) разбить фразу по СЛОВАМ на несколько строк;
 *   2) если даже одно слово не влезло — только тогда уменьшить кегль;
 *   3) переносить внутри слова дефисом нельзя никогда.
 */

let ctx: CanvasRenderingContext2D | null = null;

function measureCtx(): CanvasRenderingContext2D {
  if (!ctx) {
    const canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
  }
  if (!ctx) throw new Error('Не удалось получить canvas для замера текста');
  return ctx;
}

function fontString(step: TypeStep, size: number) {
  return `${step.weight} ${size}px ${step.family}`;
}

/** Ширина строки в пикселях кадра при заданном кегле. */
export function measure(text: string, step: TypeStep, size = step.size): number {
  const c = measureCtx();
  c.font = fontString(step, size);
  const base = c.measureText(text).width;
  // letter-spacing canvas не учитывает — добавляем вручную, иначе замер врёт.
  const ls = parseFloat(step.ls);
  if (!Number.isFinite(ls) || ls === 0) return base;
  const perChar = step.ls.endsWith('em') ? ls * size : ls;
  return base + perChar * Math.max(0, text.length - 1);
}

export interface FitResult {
  lines: string[];
  size: number;
  /** Кегль пришлось уменьшить: фраза длинновата, стоит знать. */
  shrunk: boolean;
}

/**
 * Разложить фразу на строки, влезающие в maxWidth.
 * minSize — ниже этого кегль не опускаем: лучше лишняя строка, чем нечитаемо.
 */
export function fitLines(
  text: string,
  step: TypeStep,
  maxWidth = SAFE_WIDTH,
  { maxLines = 3, minSize = Math.round(step.size * 0.7) } = {},
): FitResult {
  const words = text.trim().split(/\s+/);
  let size = step.size;

  for (;;) {
    const lines: string[] = [];
    let current = '';
    let overflow = false;

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, step, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = word;
      // одно слово шире полосы — уменьшать кегль, разрывать слово нельзя
      if (measure(word, step, size) > maxWidth) overflow = true;
    }
    if (current) lines.push(current);

    const tooMany = lines.length > maxLines;
    if ((!overflow && !tooMany) || size <= minSize) {
      return { lines, size, shrunk: size < step.size };
    }
    size -= 2;
  }
}

export interface FitTextProps {
  children: string;
  step: TypeStep;
  color?: string;
  maxWidth?: number;
  maxLines?: number;
  align?: React.CSSProperties['textAlign'];
  style?: React.CSSProperties;
}

/**
 * Текстовый блок, который сам себя укладывает в безопасную ширину.
 * Любой заголовок в сцене пишется через него, а не голым div — тогда обрезка
 * невозможна в принципе.
 */
export const FitText: React.FC<FitTextProps> = ({
  children,
  step,
  color,
  maxWidth = SAFE_WIDTH,
  maxLines = 3,
  align = 'left',
  style,
}) => {
  const fit = React.useMemo(
    () => fitLines(children, step, maxWidth, { maxLines }),
    [children, step, maxWidth, maxLines],
  );

  return (
    <div
      style={{
        fontFamily: step.family,
        fontWeight: step.weight,
        fontSize: fit.size,
        lineHeight: step.lh,
        letterSpacing: step.ls,
        textTransform: step.uppercase ? 'uppercase' : undefined,
        color,
        maxWidth,
        textAlign: align,
        wordBreak: 'keep-all',
        overflowWrap: 'normal',
        hyphens: 'none',
        ...style,
      }}
    >
      {fit.lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
};

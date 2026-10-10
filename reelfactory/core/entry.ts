import { registerRoot } from 'remotion';
import { Root } from './Root';

/**
 * Точка входа студии: в ней все ролики из projects/registry.ts.
 *
 * Рендер сюда не ходит — он собирает свою точку входа с одним роликом
 * (scripts/render.mjs), чтобы в сборку не попадал код остальных.
 */
registerRoot(Root);

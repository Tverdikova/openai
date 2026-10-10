import pack from '../style';
import type { StylePack } from './style-contract';

/**
 * ТОЧКА ПОДКЛЮЧЕНИЯ СТИЛЯ. Всё ядро берёт стиль только отсюда.
 *
 * Если стиль-пак лежит снаружи проекта — например в общей папке дизайн-кода,
 * откуда его берут ещё и карусели, — то `style/index.ts` становится тонким
 * реэкспортом этой папки, и здесь ничего менять не нужно.
 */

function assertPack(p: unknown): asserts p is StylePack {
  const missing: string[] = [];
  const o = p as Partial<StylePack> | null;
  if (!o || typeof o !== 'object') throw new Error('Стиль-пак не найден: style/index.ts ничего не экспортирует');
  if (!o.tokens) missing.push('tokens');
  if (!o.Background) missing.push('Background');
  if (!o.Ambient) missing.push('Ambient');
  if (!o.FontLoader) missing.push('FontLoader');
  if (missing.length) {
    throw new Error(
      `Стиль-пак неполный, не хватает: ${missing.join(', ')}. ` +
        `Что обязан экспортировать стиль — описано в core/style-contract.ts.`,
    );
  }
}

assertPack(pack);

export const style: StylePack = pack;
export const tokens = pack.tokens;
export const { color, type, radius, space } = pack.tokens;

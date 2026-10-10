import type { StylePack } from '../core/style-contract';
import { tokens } from './tokens';
import { Background } from './Background';
import { Ambient } from './Ambient';
import { FontLoader } from './fonts';

/**
 * ВИТРИНА СТИЛЬ-ПАКА. Ядро подключается только сюда.
 *
 * Если ваш дизайн-код живёт в отдельной папке — например общей с каруселями, —
 * этот файл превращается в тонкий реэкспорт:
 *
 *     export { default } from '../../design-code/video';
 *
 * тогда правка дизайн-кода сразу отражается на роликах, и копий не заводится.
 */
const pack: StylePack = {
  tokens,
  Background,
  Ambient,
  FontLoader,
};

export default pack;
export { tokens, Background, Ambient, FontLoader };

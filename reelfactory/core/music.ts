import { interpolate } from 'remotion';
import project from '../config/project.json';
import bank from '../config/music.json';

/**
 * ФОНОВАЯ МУЗЫКА. Второй звуковой слой ролика, под голосом.
 *
 * Правило здесь одно и оно жёсткое: музыка не должна мешать разбирать слова.
 * Поэтому вход и выход всегда плавные, слой можно выключить и целиком, и на
 * отдельном ролике, а сама музыка по умолчанию выключена — молчание лучше, чем
 * музыка, спорящая с голосом.
 *
 * Громкость считается ОТ ГОЛОСА, а не сама по себе. Это работает потому, что обе
 * дорожки заранее приведены к известному уровню: голос — при чистке, треки — при
 * добавлении в банк. Порядок обратный (сначала музыка, потом общая громкость)
 * ломает баланс: усиление поднимает голос вместе с музыкой.
 *
 * Треки лежат в `public/music/`, их список — в `config/music.json`. Список ведёт
 * `scripts/music.mjs`: файловую систему при рендере читать нельзя, композиция
 * собирается в браузере.
 */

interface Track {
  file: string;
  title: string;
  mood?: string;
  seconds?: number;
  author?: string;
  license?: string;
  source?: string;
}

export const tracks: Track[] = bank.tracks;

const musicConfig = (project as { music?: Record<string, unknown> }).music ?? {};

export const music = {
  /**
   * Класть ли музыку под ролики вообще. По умолчанию НЕТ: музыка — вкус, а не
   * необходимость, и появиться в ролике она должна потому, что её попросили, а
   * не потому, что система решила за человека.
   */
  enabled: musicConfig.enabled === true,
  /**
   * `auto` — система сама берёт трек из банка, разный для разных роликов;
   * имя файла — всегда этот трек.
   */
  track: typeof musicConfig.track === 'string' ? (musicConfig.track as string) : 'auto',
  /**
   * Громкость музыки.
   *
   * Число имеет смысл только потому, что обе дорожки приведены к известному
   * уровню заранее: голос — к стандартному ещё при чистке, треки банка — при
   * добавлении. Поэтому 0.15 всегда означает одно и то же — музыка примерно на
   * 18 децибел тише речи, то есть слышна, но не спорит.
   */
  volume: typeof musicConfig.volume === 'number' ? (musicConfig.volume as number) : 0.15,
  /** Плавный вход, в секундах: музыка не должна начинаться щелчком. */
  fadeIn: typeof musicConfig.fadeIn === 'number' ? (musicConfig.fadeIn as number) : 1.5,
  /** Плавный уход в конце, в секундах. Обрыв на полуноте слышен как брак. */
  fadeOut: typeof musicConfig.fadeOut === 'number' ? (musicConfig.fadeOut as number) : 2.5,
} as const;

/**
 * Устойчивое число по строке. Нужно, чтобы «сам выбери трек» давал одному и
 * тому же ролику один и тот же трек при каждом рендере, но разным роликам —
 * разные. Случайность тут запрещена ровно по той же причине, что и в анимации.
 */
function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Какой трек играет под этим роликом. `null` — музыки не будет.
 *
 * `choice` — то, что указано у самого ролика: имя файла перебивает настройку,
 * `false` выключает музыку только для него.
 */
export function pickTrack(reelId: string, choice?: string | false): string | null {
  if (choice === false) return null;
  if (typeof choice === 'string' && choice) return choice;
  if (!music.enabled) return null;
  if (music.track !== 'auto') return music.track;
  if (!tracks.length) return null;
  return tracks[hash(reelId) % tracks.length].file;
}

/**
 * Громкость музыки на конкретном кадре: плавный вход в начале, плавный уход в
 * конце, ровная полка между ними.
 */
export function musicVolume(frame: number, totalFrames: number, fps: number): number {
  const inFrames = Math.round(music.fadeIn * fps);
  const outFrames = Math.round(music.fadeOut * fps);

  // Короткий ролик: развести вход и выход не получится — делим пополам, иначе
  // затухания наложатся друг на друга и музыка провалится в середине.
  const half = Math.floor(totalFrames / 2);
  const rise = Math.min(inFrames, half);
  const fall = Math.min(outFrames, half);

  const up = rise > 0 ? interpolate(frame, [0, rise], [0, 1], { extrapolateRight: 'clamp' }) : 1;
  const down =
    fall > 0
      ? interpolate(frame, [totalFrames - fall, totalFrames], [1, 0], { extrapolateLeft: 'clamp' })
      : 1;

  return music.volume * Math.max(0, Math.min(up, down));
}

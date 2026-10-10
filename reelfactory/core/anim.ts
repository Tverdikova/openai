import { interpolate } from 'remotion';
import { dur, ease, entry } from './timing';

/**
 * ВХОД ЭЛЕМЕНТА — как объект ПОЯВЛЯЕТСЯ.
 * Пара к motion.ts, где описано, как объект ЖИВЁТ дальше.
 * Всё детерминировано от номера кадра: одинаковый кадр -> одинаковая картинка.
 */

/** Появление: прозрачность 0->1 + подъём снизу. delay — для лесенки (stagger). */
export function enter(frame: number, delay = 0) {
  const f = frame - delay;
  const opacity = interpolate(f, [0, dur.enter], [0, 1], {
    easing: ease.enter,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const translateY = interpolate(f, [0, dur.enter], [entry.translateY, 0], {
    easing: ease.enter,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return { opacity, transform: `translateY(${translateY}px)` };
}

/** Набор числа от from до to за duration кадров, начиная с delay. */
export function counter(
  frame: number,
  to: number,
  from = 0,
  delay = 0,
  duration: number = dur.fill,
) {
  return interpolate(frame - delay, [0, duration], [from, to], {
    easing: ease.fill,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/** Рост полосы/прогресса 0->1. */
export function grow(frame: number, delay = 0, duration: number = dur.fill) {
  return interpolate(frame - delay, [0, duration], [0, 1], {
    easing: ease.fill,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

/**
 * Ступенчатая версия любого значения 0..1 — для стилей, где плавность неуместна
 * (пиксель-арт, стоп-моушен, рисованная анимация «на двойках»).
 * steps=8 -> движение идёт восемью ступенями вместо непрерывного.
 */
export function stepped(value: number, steps: number) {
  return Math.round(value * steps) / steps;
}

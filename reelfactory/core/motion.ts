import { random } from 'remotion';
import { pulse } from './timing';

/**
 * ЖИЗНЬ — как объект продолжает двигаться ПОСЛЕ того, как основное действие
 * отыграло. Это системная защита от мёртвого кадра: главное правило производства
 * — экран движется всю длину блока озвучки, статика при звучащем голосе = брак.
 *
 * Все примитивы детерминированы от номера кадра. Никакого реального времени и
 * никакого случайного числа без семени — иначе кадры при рендере разойдутся.
 */

const TAU = Math.PI * 2;

/** Синусоида −1..1. period — период в кадрах, phase — сдвиг фазы 0..1. */
export function wave(frame: number, period: number, phase = 0) {
  return Math.sin((frame / period + phase) * TAU);
}

/** Синусоида 0..1 — для прозрачности и интенсивности. */
export function osc01(frame: number, period: number, phase = 0) {
  return 0.5 + 0.5 * wave(frame, period, phase);
}

/** Дыхание: множитель min..max. Для свечения, масштаба, яркости активного элемента. */
export function breathe(
  frame: number,
  {
    period = pulse.period,
    min = pulse.min,
    max = pulse.max,
    phase = 0,
  }: { period?: number; min?: number; max?: number; phase?: number } = {},
) {
  return min + (max - min) * osc01(frame, period, phase);
}

/**
 * Дрейф — плавное «плавание» по двум несинхронным осям.
 * seed задаёт амплитуды и фазы, поэтому каждая частица движется по-своему,
 * но одинаково на каждом прогоне рендера.
 */
export function drift(frame: number, seed: string, amp = 14) {
  const fx = 0.6 + random(seed + 'fx') * 0.8;
  const fy = 0.6 + random(seed + 'fy') * 0.8;
  const ax = amp * (0.5 + random(seed + 'ax') * 0.5);
  const ay = amp * (0.5 + random(seed + 'ay') * 0.5);
  return {
    x: ax * wave(frame, 150 / fx, random(seed + 'px')),
    y: ay * wave(frame, 130 / fy, random(seed + 'py')),
  };
}

/** Круговое или эллиптическое движение. Спутники, вращение, орбита сигнала. */
export function orbit(frame: number, { rx = 40, ry = 40, period = 180, phase = 0 } = {}) {
  const a = (frame / period + phase) * TAU;
  return { x: rx * Math.cos(a), y: ry * Math.sin(a) };
}

/** Бегущий по ребру сигнал: позиция 0..1, зациклено. phase разносит рёбра. */
export function travel(frame: number, period: number, phase = 0) {
  return (((frame / period + phase) % 1) + 1) % 1;
}

/**
 * Периодический скан: значение идёт from->to за (period − hold) кадров, затем
 * hold кадров паузы за экраном. Сканирующая линия, живущая всю сцену.
 */
export function sweep(frame: number, { period = 90, hold = 30, from = 0, to = 1 } = {}) {
  const t = frame % period;
  const active = Math.min(1, t / (period - hold));
  return { pos: from + (to - from) * active, visible: t < period - hold };
}

/**
 * Точка на кривой подъёма, p ∈ 0..1, в прямоугольнике w×h (0,0 — левый ВЕРХ).
 * «Хоккейная клюшка»: медленный старт, крутой разгон к концу — образ «взлетает».
 */
export function ascentPoint(p: number, w: number, h: number) {
  const c = Math.max(0, Math.min(1, p));
  const height = Math.pow(c, 2.4);
  return { x: c * w, y: (1 - height) * h };
}

/**
 * Мерцание с провалами — не синус, а редкие вспышки. Для искр, помех, индикаторов.
 * density 0..1: доля времени, когда элемент виден.
 */
export function flicker(frame: number, seed: string, period = 24, density = 0.5) {
  const slot = Math.floor(frame / period);
  return random(seed + slot) < density;
}

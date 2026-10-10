/**
 * Всё, что нужно сцене, экспортируется отсюда — сцена делает один импорт из
 * `core`, а не собирает его по файлам.
 *
 * Композиции здесь НЕ регистрируются: иначе каждая сцена тянула бы за собой
 * реестр, а с ним код всех роликов. Точка входа студии — `core/entry.ts`.
 */

export { Scene } from './Scene';
export { Stage, Backdrop } from './Stage';
export { FitText, fitLines, measure } from './text';
export { ScreenPlate } from './ScreenPlate';
export type { ScreenPlateProps } from './ScreenPlate';
export { CameraInset, FaceZoneOverlay } from './CameraInset';
export type { CameraInsetProps } from './CameraInset';
export { music, tracks, pickTrack, musicVolume } from './music';
export { defineReel } from './reel';
export { planSfx, sfxReport, sfxRoles, isSfxRole, seamSound, missingRoles, sfxSettings, roleMeaning } from './sfx';
export type { SfxRole, SfxCue, SfxBlock, PlannedCue } from './sfx';
export { registerTransition, getTransition, transitionNames, isTransition, autoTransition, Seam } from './transitions';
export type { TransitionSpec, TransitionCharacter } from './transitions';
export type { Reel, ReelBlock, ReelSource } from './reel';
export { Captions } from './Captions';
export { buildCaptionPages } from './caption-pages';
export type { CaptionWord, CaptionPage } from './caption-pages';
export { style, tokens, color, type, radius, space } from './style';
export * from './format';
export * as anim from './anim';
export * as motion from './motion';
export { dur, ease, entry, pulse, transition } from './timing';
export type { StylePack, StyleTokens, TypeStep, TypeScale } from './style-contract';

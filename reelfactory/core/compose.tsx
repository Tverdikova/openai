import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Series, staticFile, useCurrentFrame } from 'remotion';
import { Stage, Backdrop } from './Stage';
import { Captions } from './Captions';
import { CameraZoom, KineticCaptions } from './KineticCaptions';
import { buildKineticPhrases } from './kinetic';
import { cameraZoom, subtitles, VIDEO } from './format';
import { musicVolume, pickTrack } from './music';
import { getTransition, Seam } from './transitions';
import { planSfx } from './sfx';
import { SfxLayer } from './SfxLayer';
import type { Reel, ReelBlock } from './reel';
import project from '../config/project.json';

/**
 * СБОРКА РОЛИКА из описания: подложка, слой камеры или аватара, звук, и цепочка
 * сцен — каждая ровно на длину своего блока озвучки.
 *
 * Порядок слоёв снизу вверх: фон стиля -> живой слой -> видео с камеры ->
 * подложка графических блоков -> сцены -> субтитры -> аватар.
 *
 * Звуковых слоёв три: голос, музыка и звук движения. Последний считается до
 * рендера по описанию ролика целиком — см. `core/sfx.ts`.
 *
 * КАМЕРА И ГРАФИКА ЧЕРЕДУЮТСЯ, А НЕ НАКЛАДЫВАЮТСЯ. Видео играет непрерывно —
 * иначе порвётся звук, который из него же и берётся, — но видно его только в
 * блоках с пометкой `camera`. В остальных поверх него ложится непрозрачная
 * подложка стиля, и графика рисуется уже на ней. Субтитры при этом идут поверх
 * всего ролика одинаково: они не знают и не должны знать, кто сейчас в кадре.
 */

const AvatarLayer: React.FC<{ src: string }> = ({ src }) => {
  const { placement, size } = project.avatar;
  if (placement === 'full') {
    return (
      <AbsoluteFill>
        <OffthreadVideo src={staticFile(src)} muted />
      </AbsoluteFill>
    );
  }
  const isCircle = placement === 'circle';
  const w = project.format.width * size;
  return (
    <div
      style={{
        position: 'absolute',
        right: project.safe.pagePad,
        bottom: project.safe.bottom + project.safe.pagePad,
        width: w,
        height: isCircle ? w : undefined,
        borderRadius: isCircle ? '50%' : 24,
        overflow: 'hidden',
      }}
    >
      <OffthreadVideo src={staticFile(src)} muted />
    </div>
  );
};

/**
 * Отрезки ролика, где человек уходит с экрана и остаётся графика. Считаются
 * один раз по списку блоков: сложение кадров подряд, без округлений.
 */
function graphicRanges(blocks: ReelBlock[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let at = 0;
  for (const block of blocks) {
    if (!block.camera) ranges.push([at, at + block.frames]);
    at += block.frames;
  }
  return ranges;
}

/** Отрезки, где в кадре человек: там верхние фразы субтитров встают наверх. */
function cameraRanges(blocks: ReelBlock[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let at = 0;
  for (const block of blocks) {
    if (block.camera) ranges.push([at, at + block.frames]);
    at += block.frames;
  }
  return ranges;
}

/**
 * Подложка, закрывающая видео на графических блоках. Живёт ВНЕ цепочки сцен —
 * поэтому живой слой стиля считает движение от общего кадра ролика и не
 * дёргается на каждой границе блока.
 */
const GraphicBackdrop: React.FC<{ ranges: Array<[number, number]> }> = ({ ranges }) => {
  const frame = useCurrentFrame();
  const visible = ranges.some(([from, to]) => frame >= from && frame < to);
  return visible ? <Backdrop /> : null;
};

/**
 * Фоновая музыка. Отдельный слой, а не часть дорожки голоса: громкость и
 * затухания считаются здесь, поэтому голос остаётся нетронутым, а музыку можно
 * убрать или сменить, ничего не пересводя.
 *
 * `loop` стоит на случай, когда ролик длиннее трека: тишина в конце читается
 * как обрыв. Трек длиннее ролика — обычный случай, лишнее просто не звучит.
 */
const MusicLayer: React.FC<{ track: string; totalFrames: number }> = ({ track, totalFrames }) => (
  <Audio
    src={staticFile(track)}
    loop
    /* Кадр для громкости считается от начала ролика, а не от начала повтора —
       иначе на зацикленном треке музыка затухала бы в конце каждого круга. */
    loopVolumeCurveBehavior="extend"
    volume={(frame) => musicVolume(frame, totalFrames, VIDEO.fps)}
  />
);

const ReelBody: React.FC<{ reel: Reel }> = ({ reel }) => {
  const { source, blocks } = reel;
  const track = pickTrack(reel.id, source.music);
  const cues = planSfx(blocks, { transition: reel.transition, enabled: reel.sfx !== false });
  // Фразы кинетических субтитров: по ним же живёт зум камеры.
  const phrases = React.useMemo(
    () => (reel.captions?.length ? buildKineticPhrases(reel.captions, VIDEO.fps, reel.captionPlan) : []),
    [reel],
  );
  const kinetic = subtitles.mode === 'own' && subtitles.look === 'kinetic';

  return (
    <Stage>
      {source.video && (
        <>
          <CameraZoom phrases={cameraZoom ? phrases : []}>
            {/* objectFit: кадр вертикальный, а прислать могут что угодно —
                горизонталь обрезается по центру, а не растягивается в блин. */}
            <OffthreadVideo src={staticFile(source.video)} style={{ objectFit: 'cover' }} />
          </CameraZoom>
          <GraphicBackdrop ranges={graphicRanges(blocks)} />
        </>
      )}
      {source.audio && <Audio src={staticFile(source.audio)} />}
      {track && <MusicLayer track={track} totalFrames={reel.totalFrames} />}
      <SfxLayer cues={cues} />

      <Series>
        {blocks.map((block, index) => {
          // Приход — своя склейка блока. Уход — склейка СЛЕДУЮЩЕГО: это одно
          // движение на двоих, и уходящий кадр обязан ехать туда же, откуда
          // приедет новый. Взять уход из своей склейки значило бы развести
          // половины стыка в разные стороны.
          const enter = index > 0 && block.transition ? getTransition(block.transition) : undefined;
          const after = blocks[index + 1]?.transition;
          const exit = after ? getTransition(after) : undefined;

          return (
            <Series.Sequence key={block.id} durationInFrames={block.frames}>
              {/* Либо сцена на своём фоне, либо пусто — тогда виден человек. */}
              <Seam frames={block.frames} enter={enter} exit={exit}>
                {block.scene ? <block.scene /> : <AbsoluteFill />}
              </Seam>
              {/* Врезка камерного блока идёт поверх видео, но вне зоны лица (см.
                  CameraInset) и ВНЕ склейки: её место в кадре задано числами из
                  настройки, а переход на несколько кадров сдвинул бы её за
                  безопасную границу. Безопасная зона важнее украшения стыка. */}
              {block.inset ? <block.inset /> : null}
            </Series.Sequence>
          );
        })}
      </Series>

      {kinetic && phrases.length ? (
        <KineticCaptions phrases={phrases} cameraRanges={cameraRanges(blocks)} />
      ) : subtitles.mode === 'own' && reel.captions?.length ? (
        <Captions words={reel.captions} />
      ) : null}

      {source.avatar && <AvatarLayer src={source.avatar} />}
    </Stage>
  );
};

/**
 * Готовый компонент композиции для конкретного ролика.
 *
 * Описание ролика НЕ передаётся через свойства композиции: свойства уходят в
 * рендер как обычные данные, а внутри описания лежат сами сцены — их так не
 * передать. Поэтому компонент собирается один раз на ролик и запоминается.
 */
const cache = new Map<string, React.FC>();

export function reelComponent(reel: Reel): React.FC {
  const ready = cache.get(reel.id);
  if (ready) return ready;

  const Component: React.FC = () => <ReelBody reel={reel} />;
  Component.displayName = `Reel(${reel.id})`;
  cache.set(reel.id, Component);
  return Component;
}

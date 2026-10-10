#!/usr/bin/env node
/**
 * РАЗМЕТКА БЛОКОВ. Речь режется на смысловые куски: один блок — одна мысль —
 * одна сцена.
 *
 *     node scripts/blocks.mjs --project 2026-08-09-analitika
 *
 * Скрипт делает черновую разметку по паузам и длине — дальше её правят по
 * смыслу. Границы по паузам почти всегда совпадают с границами мыслей, но
 * последнее слово за смыслом, а не за тишиной.
 *
 * Главное, что здесь гарантируется: сумма длительностей блоков ровно равна
 * длине чистой дорожки. Кадры считаются по границам, а не складываются из
 * округлений, поэтому расхождение не накапливается.
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  args, done, fmt, note, p, readConfig, readJSON, say, step, stop, writeJSON,
} from './lib/util.mjs';

const options = args();
if (!options.project) stop('Не указан проект: --project <идентификатор>');

const config = readConfig();
const fps = config.format.fps;
const dir = p('projects', String(options.project));
const meta = readJSON(path.join(dir, 'meta.json'));
const workDir = path.join(dir, 'work');

const wordsFile = path.join(workDir, 'words.clean.json');
if (!existsSync(wordsFile)) stop(`Сначала чистка дорожки: node scripts/cleanup.mjs --project ${meta.id}`);

const words = readJSON(wordsFile);
if (!words.length) stop('В расшифровке нет слов.');
if (!meta.clean) stop('Не найдена чистая дорожка — прогоните чистку заново.');

const duration = meta.clean.durationSeconds;

// Настройки разметки. Короткие блоки — это хорошо: смена кадра держит внимание.
const MIN = Number(options.min ?? 1.2);   // короче — кадр не успевает прочитаться
const MAX = Number(options.max ?? 6.0);   // длиннее — внимание провисает
const PAUSE = Number(options.pause ?? 0.25);

say(`\n  Разметка блоков: ${meta.title}\n`);
step('Режу речь по смысловым паузам');

/**
 * Речь делится по паузам. Но у синтезированной озвучки пауз почти нет — она
 * идёт сплошным потоком. Поэтому на случай, когда блок дорос до предела, а
 * паузы так и не случилось, запоминается лучшее место для разрыва: самый
 * заметный промежуток между словами с тех пор, как блок стал достаточно
 * длинным. Разрыв там звучит естественнее, чем ровно по секундомеру.
 */
const groups = [];
let current = [words[0]];
let best = null; // { index, gap } — куда резать, если упрёмся в предел

for (let i = 1; i < words.length; i++) {
  const gap = words[i].start - words[i - 1].end;
  const length = words[i - 1].end - current[0].start;

  if (length >= MIN && gap >= PAUSE) {
    groups.push(current);
    current = [words[i]];
    best = null;
    continue;
  }

  if (length >= MIN && (!best || gap > best.gap)) best = { index: current.length, gap };

  current.push(words[i]);

  if (words[i].end - current[0].start >= MAX) {
    const cut = best?.index ?? current.length;
    groups.push(current.slice(0, cut));
    current = current.slice(cut);
    best = null;
  }
}
if (current.length) groups.push(current);

// Слишком короткий хвост приклеиваем к предыдущему блоку — отдельная сцена
// на полсекунды выглядит как случайная вспышка.
if (groups.length > 1) {
  const tail = groups.at(-1);
  if (tail.at(-1).end - tail[0].start < MIN * 0.6) {
    groups.at(-2).push(...tail);
    groups.pop();
  }
}

// ── границы и кадры ─────────────────────────────────────
step('Считаю длительности');

const boundaries = [0];
for (let i = 1; i < groups.length; i++) {
  // граница ставится посередине паузы между блоками — на слух это точнее всего
  const previousEnd = groups[i - 1].at(-1).end;
  const nextStart = groups[i][0].start;
  boundaries.push((previousEnd + nextStart) / 2);
}
boundaries.push(duration);

/**
 * КАМЕРА ИЛИ ГРАФИКА. Прислали видео — по умолчанию человек на экране во всех
 * блоках: это честный рабочий ролик уже на этом шаге, и рисовать для него
 * ничего не надо. Дальше отдельные блоки помечаются под графику — там, где
 * говорящая голова ничего не добавляет, а картинка добавляет.
 *
 * Прислали звук — показывать нечего, все блоки графические.
 */
const shotOnCamera = meta.clean?.kind === 'video';

const blocks = groups.map((group, i) => {
  const start = boundaries[i];
  const end = boundaries[i + 1];
  const frames = Math.round(end * fps) - Math.round(start * fps);
  return {
    id: `b${String(i + 1).padStart(2, '0')}`,
    index: i + 1,
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
    seconds: Number((end - start).toFixed(3)),
    frames,
    text: group.map((w) => w.text).join(' '),
    camera: shotOnCamera, // true — в кадре говорящий человек, сцена не нужна
    scene: null,      // имя файла сцены — появится при сборке
    metaphor: null,   // чем кадр иллюстрирует смысл
  };
});

const totalFrames = blocks.reduce((sum, b) => sum + b.frames, 0);
const expected = Math.round(duration * fps);
if (totalFrames !== expected) {
  stop(`Внутренняя ошибка разметки: ${totalFrames} кадров против ${expected}. Сообщите об этом.`);
}

const short = blocks.filter((b) => b.frames < fps).length;
done(`блоков: ${blocks.length}, всего ${totalFrames} кадров (${fmt(duration)})`);
if (short) note(`очень коротких блоков: ${short} — проверьте, не разорвана ли мысль`);

writeJSON(path.join(workDir, 'blocks.json'), { project: meta.id, fps, duration, totalFrames, blocks });

// Читаемая версия — чтобы человек мог глазами проверить разбивку
const readable = blocks
  .map(
    (b) =>
      `${b.index}. [${b.start.toFixed(2)}–${b.end.toFixed(2)}] ${b.frames} кадров — ` +
      `${b.camera ? 'камера' : 'графика'}\n   ${b.text}`,
  )
  .join('\n\n');

const legend = shotOnCamera
  ? 'Пометка в конце строки — что на экране. **камера** — виден говорящий человек, ' +
    'рисовать ничего не нужно. **графика** — человек уходит с экрана, и на его месте ' +
    'анимированная сцена на фоне стиля.\n\nСейчас на камере все блоки. Переведите под ' +
    'графику те, где лицо ничего не добавляет: цифры, перечисления, сравнения, схемы. ' +
    'Меняется поле `camera` в `blocks.json`, потом каркас пересобирается.\n\n' +
    'Если видео снималось только ради звука — снимите пометку со всех блоков.'
  : 'Звук без видео: показывать нечего, все блоки графические.';

writeFileSync(
  path.join(workDir, 'blocks.md'),
  `# Блоки: ${meta.title}\n\nВсего ${blocks.length} блоков, ${totalFrames} кадров, ${fmt(duration)}.\n\n` +
    `${legend}\n\n${readable}\n`,
  'utf8',
);
done('work/blocks.json и work/blocks.md');

meta.stage = 'scenes';
writeJSON(path.join(dir, 'meta.json'), meta);

if (shotOnCamera) {
  say(`\n  Видео с камеры: пока человек в кадре все ${blocks.length} блоков.`);
  say('  Отметьте в blocks.json, какие отдать графике — только для них будут сцены.');
}

say('\n  Дальше — разбивку проверить по смыслу, затем сцены под графические блоки.');
say(`  Каркас проекта:  node scripts/scaffold.mjs --project ${meta.id}\n`);

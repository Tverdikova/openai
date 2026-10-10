#!/usr/bin/env node
/**
 * РЕНДЕР. Собирает готовый файл и сразу прогоняет проверки.
 *
 *     node scripts/render.mjs --project 2026-08-09-analitika
 *
 * Идёт на процессоре этой машины: на слабой дольше, это нормально. Ничего никуда
 * не отправляется.
 */
import { copyFileSync, cpSync, existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  args, done, ensureDir, note, p, readConfig, readJSON, reelOutputs, runLoud, say, step, stop,
} from './lib/util.mjs';
import { normalizeLoudness } from './lib/loudness.mjs';

const options = args();
if (!options.project) stop('Не указан проект: --project <идентификатор>');

const config = readConfig();
const dir = p('projects', String(options.project));
const meta = readJSON(path.join(dir, 'meta.json'));
const workDir = path.join(dir, 'work');

if (!existsSync(path.join(dir, 'reel.tsx'))) {
  stop(`У проекта нет описания ролика. Сначала: node scripts/scaffold.mjs --project ${meta.id}`);
}

const outputs = reelOutputs(meta, config);
const temporary = path.join(workDir, 'render.mp4');
ensureDir(workDir);

say(`\n  Рендер: ${meta.title}\n`);

/**
 * ТОЧКА ВХОДА С ОДНИМ РОЛИКОМ. Общая точка входа студии тянет в сборку код всех
 * роликов из реестра, и с каждым новым роликом рендер тяжелел бы. Здесь в сборку
 * попадает только этот. Файл перезаписывается при каждом рендере.
 */
const entry = path.join(workDir, 'render-entry.tsx');
writeFileSync(
  entry,
  [
    '// Точка входа рендера одного ролика. Пишется scripts/render.mjs заново перед каждым рендером.',
    "import React from 'react';",
    "import { registerRoot } from 'remotion';",
    "import { ReelComposition } from '../../../core/ReelComposition';",
    "import reel from '../reel';",
    '',
    'registerRoot(() => <ReelComposition reel={reel} />);',
    '',
  ].join('\n'),
  'utf8',
);

/**
 * МАТЕРИАЛЫ ПРОЕКТА — В PUBLIC ТОЛЬКО НА ВРЕМЯ РЕНДЕРА. Сборщик перед каждым
 * рендером копирует `public` целиком, и если держать там дорожки и снимки всех
 * роликов, каждый рендер возил бы их все. Поэтому они живут в папке проекта, а
 * сюда переезжают переименованием — это мгновенно и места не занимает.
 */
const materials = path.join(workDir, 'public');
const staged = p('public', meta.id);
let staging = null; // 'moved' — переехала папка; 'copied' — лежит копия

if (existsSync(staged) && existsSync(materials)) {
  stop(
    `Материалы ролика лежат в двух местах: public/${meta.id} и projects/${meta.id}/work/public.\n` +
      'Похоже, прошлый рендер оборвался. Оставьте одну из папок и запустите рендер снова.',
  );
}
if (existsSync(staged)) {
  // Остаток прерванного рендера: рендерим с ним, после возвращаем на место.
  staging = 'moved';
} else if (existsSync(materials)) {
  try {
    renameSync(materials, staged);
    staging = 'moved';
  } catch {
    // На Windows занятый файл не даёт переименовать папку — тогда копия.
    cpSync(materials, staged, { recursive: true });
    staging = 'copied';
  }
}

function unstage() {
  if (staging === 'moved') {
    try {
      renameSync(staged, materials);
    } catch {
      cpSync(staged, materials, { recursive: true });
      rmSync(staged, { recursive: true, force: true });
    }
  } else if (staging === 'copied') {
    rmSync(staged, { recursive: true, force: true });
  }
  staging = null;
}

step('Собираю видео — это займёт время');

let failure = null;
try {
  runLoud('npx', ['remotion', 'render', entry, meta.id, temporary]);
} catch (error) {
  failure = error;
} finally {
  unstage();
}

if (failure) {
  rmSync(temporary, { force: true });
  stop(
    `Рендер не прошёл.\n\n${failure.message}\n\n` +
      'Чаще всего причина в самой сцене: опечатка в коде или обращение к тому,\n' +
      'чего нет в стиль-паке. Текст ошибки выше указывает на файл.',
  );
}

done('видео собрано');

/**
 * Громкость приводится к принятому уровню ДО того, как ролик уйдёт в общую
 * папку: человек забирает оттуда готовое и больше ничего с ним не делает.
 */
const loudness = config.render?.loudness ?? {};
if (loudness.normalize !== false) {
  step('Выравниваю громкость');
  const target = typeof loudness.targetLufs === 'number' ? loudness.targetLufs : -13;
  const peak = typeof loudness.truePeak === 'number' ? loudness.truePeak : -1;
  const result = normalizeLoudness(temporary, { targetLufs: target, truePeak: peak });

  if (result.ok) {
    const from = result.before.toFixed(1);
    const to = result.after !== undefined ? result.after.toFixed(1) : String(target);
    done(`было ${from} LUFS, стало ${to} — как у роликов в ленте`);
  } else {
    note(`громкость оставлена как есть: ${result.reason}`);
  }
}

/**
 * Готовый ролик живёт в одном месте — в общей папке рядом с системой. Внутрь
 * системы человек не ходит, а за роликами ходит постоянно. Вторая копия в папке
 * проекта только занимала бы место: проверки и правки смотрят туда же.
 */
step('Кладу готовый ролик в общую папку');
try {
  ensureDir(path.dirname(outputs.ready));
  try {
    renameSync(temporary, outputs.ready);
  } catch {
    // Общая папка на другом диске — переименование туда не работает.
    copyFileSync(temporary, outputs.ready);
    rmSync(temporary, { force: true });
  }
  done(outputs.ready);
} catch (error) {
  stop(
    `Не получилось положить ролик в общую папку: ${error.message}\n` +
      `Ролик собран и лежит здесь: ${temporary}`,
  );
}

step('Проверяю результат');
runLoud('node', [p('scripts', 'check.mjs'), '--project', meta.id]);

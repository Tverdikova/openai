#!/usr/bin/env node
/**
 * ПРОВЕРКА ГОТОВОГО РОЛИКА. То, что раньше ловилось глазами, ловится здесь.
 *
 *     node scripts/check.mjs --project 2026-08-09-analitika
 *
 * Жёстко (это брак, который увидит зритель):
 *   · длина КАРТИНКИ совпадает с длиной дорожки;
 *   · файл на месте и не пустой.
 *
 * Предупреждением (решает человек, а не скрипт):
 *   · замершая картинка при звучащем голосе — с указанием блока;
 *   · подозрительно короткие блоки.
 *
 * Проверять метафору никакой скрипт не умеет, и притворяться тут нечем: это
 * работа человека.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  args, ffmpegProbeStderr, findReel, fmt, p, readConfig, readJSON, say, stop, videoStreamDuration,
} from './lib/util.mjs';

const options = args();
if (!options.project) stop('Не указан проект: --project <идентификатор>');

const config = readConfig();
const dir = p('projects', String(options.project));
const meta = readJSON(path.join(dir, 'meta.json'));
const blocksFile = path.join(dir, 'work', 'blocks.json');
const blocks = existsSync(blocksFile) ? readJSON(blocksFile).blocks : [];

// Готовый ролик лежит в одном месте — в общей папке OUT REELS.
const output = findReel(meta, config);

const problems = [];
const warnings = [];
const good = [];

// ── файл ────────────────────────────────────────────────
if (!output) stop('Готового файла нет — сначала рендер.');
const size = statSync(output).size;
if (size < 100_000) problems.push(`Файл подозрительно мал: ${(size / 1024).toFixed(0)} КБ. Похоже, рендер оборвался.`);
else good.push(`Файл на месте: ${(size / 1024 / 1024).toFixed(1)} МБ`);

// ── синхрон ─────────────────────────────────────────────
/**
 * Сравнивается длина картинки, а не файла. Длина файла — это длина самой долгой
 * дорожки в нём, и кодировщик звука дописывает в конец служебный хвост тишины до
 * полутора десятых секунды. Ролик при этом стоит ровно там, где надо, а проверка
 * по длине файла объявляла бы его разъехавшимся и заворачивала выдачу.
 */
const videoDuration = videoStreamDuration(output);
const audioDuration = meta.clean?.durationSeconds ?? null;

if (audioDuration !== null) {
  const drift = Math.abs(videoDuration - audioDuration);
  if (drift > 0.12) {
    problems.push(
      `Видео ${fmt(videoDuration)}, дорожка ${fmt(audioDuration)} — расхождение ${fmt(drift)}. ` +
        'Картинка разъедется с голосом: пересчитайте блоки по чистой дорожке.',
    );
  } else {
    good.push(`Синхрон в порядке: ${fmt(videoDuration)}`);
  }
}

// ── мёртвый кадр ────────────────────────────────────────
/**
 * ffmpeg сравнивает соседние кадры: не меняется картинка дольше порога — значит
 * под звучащий голос висит статика. Порог 0.7с: короткая задержка бывает
 * осмысленной, длинная — почти всегда недоделанная сцена.
 */
const FREEZE_SECONDS = 0.7;
const log = ffmpegProbeStderr(['-i', output, '-vf', `freezedetect=n=-58dB:d=${FREEZE_SECONDS}`, '-map', '0:v', '-f', 'null', '-']);

const freezes = [];
let start = null;
for (const line of log.split('\n')) {
  const begin = line.match(/freeze_start:\s*([\d.]+)/);
  const finish = line.match(/freeze_end:\s*([\d.]+)/);
  if (begin) start = parseFloat(begin[1]);
  if (finish && start !== null) {
    freezes.push({ from: start, to: parseFloat(finish[1]) });
    start = null;
  }
}
if (start !== null) freezes.push({ from: start, to: videoDuration });

/**
 * Оговорка про свои субтитры: подсветка слова меняет картинку каждый кадр, и
 * замершая под ней сцена автоматике уже не видна. Честнее сказать об этом, чем
 * выдать «мёртвых кадров нет» и успокоить зря.
 */
const ownSubtitles = (config.subtitles?.mode ?? 'external') === 'own';

if (freezes.length) {
  for (const freeze of freezes) {
    const block = blocks.find((b) => freeze.from >= b.start - 0.05 && freeze.from < b.end);
    const where = block ? `блок ${block.index} («${block.text.slice(0, 46)}…»)` : `${freeze.from.toFixed(1)}с`;
    warnings.push(`Картинка замирает на ${fmt(freeze.to - freeze.from)}: ${where}. Добавьте послесвечение или растяните действие.`);
  }
} else if (ownSubtitles) {
  warnings.push(
    'Мёртвых кадров автоматика не нашла, но субтитры рисуются свои: их движение ' +
      'перекрывает застывшую сцену, и проверка тут слепая. Пролистайте ролик глазами.',
  );
} else {
  good.push('Мёртвых кадров не найдено');
}

// ── короткие блоки ──────────────────────────────────────
const short = blocks.filter((b) => b.frames < meta.fps * 0.8);
if (short.length) {
  warnings.push(`Очень коротких блоков: ${short.length} (${short.map((b) => b.index).join(', ')}). Проверьте, не разорвана ли мысль.`);
}

// ── отчёт ───────────────────────────────────────────────
say(`\n  Проверка: ${meta.title}\n`);
for (const line of good) say(`  ✓ ${line}`);
for (const line of warnings) say(`  · ${line}`);
for (const line of problems) say(`  ! ${line}`);

if (problems.length) {
  say('\n  Это брак — так выпускать нельзя.\n');
  process.exit(1);
}
say(warnings.length ? '\n  Замечания выше стоит посмотреть глазами.\n' : '\n  Всё чисто.\n');

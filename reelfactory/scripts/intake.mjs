#!/usr/bin/env node
/**
 * ПРИЁМ МАТЕРИАЛА. Человек присылает файл или тему — папку заводит система.
 *
 *     node scripts/intake.mjs --name "аналитика конкурентов" ~/Desktop/озвучка.mp3
 *     node scripts/intake.mjs --name "госзакупки" --topic "ИИ в тендерах"
 *
 * Что делает: создаёт папку проекта с латинским именем, раскладывает исходники,
 * определяет что пришло — звук, видео или только тема, — и записывает карточку
 * проекта. Человека не просят ничего создавать и переименовывать.
 */
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  args, done, ensureDir, fmt, hasVideoStream, mediaDuration, note, p, readConfig,
  say, slugify, step, stop, today, writeJSON,
} from './lib/util.mjs';

const options = args();
const files = options._;

if (!options.name) stop('Не указано имя ролика. Пример: node scripts/intake.mjs --name "аналитика" файл.mp3');

const config = readConfig();
const id = `${today()}-${slugify(options.name)}`;
const dir = p('projects', id);

if (existsSync(dir)) stop(`Проект «${id}» уже есть. Возьмите другое имя или продолжайте работу в нём.`);

say(`\n  Новый проект: ${id}\n`);

step('Создаю папку проекта');
ensureDir(path.join(dir, 'source'));  // как прислали, не трогаем
ensureDir(path.join(dir, 'work'));    // рабочие файлы конвейера
done(`projects/${id}`);

// ── что именно прислали ─────────────────────────────────
const MEDIA = /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|mkv|webm|avi)$/i;
const TEXT = /\.(txt|md|srt)$/i;

let source = { kind: 'topic', file: null };
let durationSeconds = null;

step('Разбираю присланное');

if (options.topic) {
  note(`тема: ${options.topic}`);
}

for (const file of files) {
  if (!existsSync(file)) stop(`Файл не найден: ${file}`);
  const base = path.basename(file);

  if (MEDIA.test(base)) {
    const isVideo = hasVideoStream(file);
    const target = path.join(dir, 'source', isVideo ? `original${path.extname(base)}` : `voice${path.extname(base)}`);
    copyFileSync(file, target);
    durationSeconds = mediaDuration(target);
    source = { kind: isVideo ? 'video' : 'audio', file: path.relative(p(), target).split(path.sep).join('/') };
    done(`${isVideo ? 'видео с камеры' : 'озвучка'}: ${base}, ${fmt(durationSeconds)}`);
  } else if (TEXT.test(base)) {
    const target = path.join(dir, 'source', `script${path.extname(base)}`);
    copyFileSync(file, target);
    if (source.kind === 'topic') source = { kind: 'script', file: path.relative(p(), target).split(path.sep).join('/') };
    done(`текст сценария: ${base}`);
  } else {
    note(`пропущен непонятный файл: ${base}`);
  }
}

if (source.kind === 'topic' && !options.topic) {
  note('пришла только просьба без материалов — считаем это темой');
}

// ── карточка проекта ────────────────────────────────────
writeJSON(path.join(dir, 'meta.json'), {
  id,
  title: options.name,
  createdAt: new Date().toISOString(),
  topic: options.topic ?? null,
  source,
  durationSeconds,
  fps: config.format.fps,
  stage: source.kind === 'audio' || source.kind === 'video' ? 'transcribe' : 'script',
});

step('Что дальше');
if (source.kind === 'audio' || source.kind === 'video') {
  say(`  Расшифровка речи:   node scripts/transcribe.mjs --project ${id}`);
  say(`  Чистка запинок:     node scripts/cleanup.mjs --project ${id}`);
  say(`  Разметка блоков:    node scripts/blocks.mjs --project ${id}`);
} else {
  say('  Материала для звука пока нет. Сначала сценарий и озвучка,');
  say('  затем те же три шага.');
}
say('');

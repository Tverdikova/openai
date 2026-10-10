#!/usr/bin/env node
/**
 * РАСШИФРОВКА РЕЧИ. Из дорожки получаются слова с точным временем — на них
 * потом опирается вся разметка блоков и синхрон анимации с голосом.
 *
 *     node scripts/transcribe.mjs --project 2026-08-09-analitika
 *
 * Распознавание идёт локально: ничего не уходит в интернет, ничего не стоит,
 * работает без сети.
 */
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  args, done, ensureDir, has, note, p, readConfig, readJSON, say, step, stop, run, writeJSON,
} from './lib/util.mjs';

const options = args();
if (!options.project) stop('Не указан проект: --project <идентификатор>');

const config = readConfig();
const dir = p('projects', String(options.project));
const meta = readJSON(path.join(dir, 'meta.json'));
const workDir = path.join(dir, 'work');
ensureDir(workDir);

const media = options.file ? String(options.file) : p(meta.source.file ?? '');
if (!meta.source.file || !existsSync(media)) stop('У проекта нет звуковой дорожки — расшифровывать нечего.');

const binary = has('whisper-cli') ? 'whisper-cli' : has('whisper') ? 'whisper' : null;
if (!binary) stop('whisper не установлен. Запустите: node scripts/install-deps.mjs');

const modelPath = path.isAbsolute(config.transcribe.model) ? config.transcribe.model : p(config.transcribe.model);
if (!existsSync(modelPath)) stop(`Модель распознавания не найдена: ${config.transcribe.model}\nЗапустите: node scripts/install-deps.mjs`);

say(`\n  Расшифровка: ${meta.title}\n`);

// whisper.cpp принимает только 16 кГц моно wav — приводим к нему.
step('Готовлю дорожку');
const wav = path.join(workDir, 'source-16k.wav');
run('ffmpeg', ['-y', '-i', media, '-ac', '1', '-ar', '16000', '-vn', wav]);
done('дорожка приведена к 16 кГц моно');

step('Распознаю речь — это самая долгая часть');
const prefix = path.join(workDir, 'transcript');
run(binary, ['-m', modelPath, '-f', wav, '-l', config.transcribe.language, '-ojf', '-of', prefix, '-np'], { quiet: true });
const raw = JSON.parse(readFileSync(`${prefix}.json`, 'utf8'));
// Служебная дорожка нужна только распознаванию — дальше она лишний вес на диске.
rmSync(wav, { force: true });
done('речь распознана');

// ── склейка токенов в слова ─────────────────────────────
/**
 * whisper выдаёт куски слов (токены). Слово начинается там, где у токена есть
 * ведущий пробел. Служебные токены в квадратных скобках отбрасываем.
 */
step('Собираю слова с временными метками');

const words = [];
let current = null;

const pushCurrent = () => {
  if (current && current.text.trim()) words.push({ ...current, text: current.text.trim() });
  current = null;
};

for (const segment of raw.transcription ?? []) {
  const tokens = segment.tokens ?? [];
  if (!tokens.length) {
    // запасной путь: если токенов нет, работаем целыми фразами
    words.push({
      text: (segment.text ?? '').trim(),
      start: (segment.offsets?.from ?? 0) / 1000,
      end: (segment.offsets?.to ?? 0) / 1000,
    });
    continue;
  }
  for (const token of tokens) {
    const text = token.text ?? '';
    if (!text || /^\[.*\]$/.test(text.trim())) continue;
    const start = (token.offsets?.from ?? 0) / 1000;
    const end = (token.offsets?.to ?? 0) / 1000;
    if (text.startsWith(' ') || !current) {
      pushCurrent();
      current = { text: text.trim(), start, end };
    } else {
      current.text += text;
      current.end = end;
    }
  }
  pushCurrent();
}
pushCurrent();

if (!words.length) stop('Речь не распознана. Проверьте, что в файле действительно есть голос.');

writeJSON(path.join(workDir, 'words.json'), words);
done(`слов: ${words.length}, речь с ${words[0].start.toFixed(2)}с по ${words.at(-1).end.toFixed(2)}с`);

meta.stage = 'cleanup';
writeJSON(path.join(dir, 'meta.json'), meta);

say(`\n  Дальше — чистка запинок:  node scripts/cleanup.mjs --project ${meta.id}\n`);

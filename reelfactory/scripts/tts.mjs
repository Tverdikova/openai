#!/usr/bin/env node
/**
 * ОЗВУЧКА ТЕКСТА через ElevenLabs.
 *
 *     node scripts/tts.mjs --voices                       список голосов
 *     node scripts/tts.mjs --project ID --text-file файл  озвучить сценарий
 *     node scripts/tts.mjs --project ID --text "фраза"    озвучить строку
 *     node scripts/tts.mjs --demo --text "проверка"       образец голоса
 *
 * Важная выгода: сервис возвращает не только звук, но и точное время каждой
 * буквы. Значит распознавание речи здесь не нужно совсем — тайминги приходят
 * сразу и они точнее, чем любое распознавание.
 *
 * Ключ живёт в .env. Нет ключа — шаг просто недоступен, всё остальное работает
 * с готовыми файлами озвучки как обычно.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  args, done, ensureDir, fmt, note, p, readConfig, readEnv, readJSON, say, step, stop, writeJSON,
} from './lib/util.mjs';

const options = args();
const env = readEnv();
const config = readConfig();

const key = env.ELEVENLABS_API_KEY;
if (!key) {
  stop(
    'Озвучка не подключена: в файле .env нет строки ELEVENLABS_API_KEY.\n' +
      'Ключ берётся в личном кабинете ElevenLabs. Добавили — работает сразу,\n' +
      'ничего перенастраивать не нужно.',
  );
}

const API = 'https://api.elevenlabs.io';

async function elevenlabs(url, init = {}) {
  const response = await fetch(`${API}${url}`, {
    ...init,
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) stop('ElevenLabs не принял ключ. Проверьте ELEVENLABS_API_KEY в .env.');
    if (response.status === 429) stop('ElevenLabs: слишком много запросов или закончились символы на тарифе.');
    stop(`ElevenLabs ответил ошибкой ${response.status}:\n${body.slice(0, 400)}`);
  }
  return response;
}

// ── список голосов ──────────────────────────────────────
if (options.voices) {
  const data = await (await elevenlabs('/v2/voices?page_size=100')).json();
  say('\n  Доступные голоса\n');
  for (const voice of data.voices ?? []) {
    const labels = Object.values(voice.labels ?? {}).join(', ');
    say(`  ${voice.voice_id}  ${voice.name}${labels ? `  — ${labels}` : ''}`);
  }
  say('\n  Нужный идентификатор пропишется в настройке.\n');
  process.exit(0);
}

// ── что озвучиваем ──────────────────────────────────────
let text = null;
if (options['text-file']) {
  const file = String(options['text-file']);
  if (!existsSync(file)) stop(`Файл со сценарием не найден: ${file}`);
  text = readFileSync(file, 'utf8');
} else if (typeof options.text === 'string') {
  text = options.text;
}
if (!text || !text.trim()) stop('Нечего озвучивать: укажите --text или --text-file.');

// Из сценария в озвучку идёт только речь: заголовки, пометки и комментарии
// автора вслух не читаются.
text = text
  .split('\n')
  .filter((line) => !/^\s*(#|>|\/\/|—\s*пометка)/.test(line))
  .join('\n')
  .replace(/\s+\n/g, '\n')
  .trim();

const voiceId = options.voice ? String(options.voice) : config.voice.elevenlabs.voiceId;
if (!voiceId) stop('Не выбран голос. Посмотрите список: node scripts/tts.mjs --voices');

const settings = config.voice.elevenlabs;

say('\n  Озвучка через ElevenLabs\n');
step(`Синтезирую речь — ${text.length} знаков`);

const response = await elevenlabs(`/v1/text-to-speech/${voiceId}/with-timestamps`, {
  method: 'POST',
  body: JSON.stringify({
    text,
    model_id: settings.modelId,
    voice_settings: {
      stability: settings.stability,
      similarity_boost: settings.similarityBoost,
      speed: settings.speed,
    },
  }),
});

const result = await response.json();
if (!result.audio_base64) stop('ElevenLabs вернул ответ без звука. Попробуйте ещё раз.');

const audio = Buffer.from(result.audio_base64, 'base64');

// ── образец голоса ──────────────────────────────────────
if (options.demo) {
  const file = p('public', 'voice-demo.mp3');
  ensureDir(path.dirname(file));
  writeFileSync(file, audio);
  done(`образец сохранён: public/voice-demo.mp3 — послушайте, тот ли это голос`);
  process.exit(0);
}

if (!options.project) stop('Не указан проект: --project <идентификатор>');

const dir = p('projects', String(options.project));
const meta = readJSON(path.join(dir, 'meta.json'));
const workDir = path.join(dir, 'work');
ensureDir(workDir);

const audioFile = path.join(dir, 'source', 'voice.mp3');
ensureDir(path.dirname(audioFile));
writeFileSync(audioFile, audio);
done(`озвучка записана: source/voice.mp3`);

// ── слова из посимвольной разметки ──────────────────────
step('Собираю слова с временными метками');

/**
 * Сервис отдаёт время каждой буквы. Слова собираются по пробелам: так метки
 * точнее любого распознавания — это не догадка по звуку, а разметка самого
 * синтезатора.
 */
const alignment = result.alignment ?? result.normalized_alignment;
const words = [];

if (alignment?.characters?.length) {
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;

  let current = null;
  chars.forEach((char, i) => {
    if (/\s/.test(char)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    if (!current) current = { text: char, start: starts[i], end: ends[i] };
    else {
      current.text += char;
      current.end = ends[i];
    }
  });
  if (current) words.push(current);
}

if (!words.length) {
  note('разметка не пришла — тайминги посчитаются распознаванием');
} else {
  writeJSON(path.join(workDir, 'words.json'), words);
  done(`слов: ${words.length}, длительность ${fmt(words.at(-1).end)}`);
}

// ── карточка проекта ────────────────────────────────────
meta.source = { kind: 'audio', file: path.relative(p(), audioFile).split(path.sep).join('/') };
meta.voice = { provider: 'elevenlabs', voiceId, modelId: settings.modelId };
meta.stage = words.length ? 'cleanup' : 'transcribe';
writeJSON(path.join(dir, 'meta.json'), meta);

say(
  words.length
    ? `\n  Распознавание не нужно — метки уже есть.\n  Дальше:  node scripts/cleanup.mjs --project ${meta.id}\n`
    : `\n  Дальше:  node scripts/transcribe.mjs --project ${meta.id}\n`,
);

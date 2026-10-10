#!/usr/bin/env node
/**
 * ПРОВЕРКА ОКРУЖЕНИЯ. Запускается установщиком и в любой момент вручную:
 *
 *     npm run doctor
 *
 * Отвечает на один вопрос: чего не хватает, чтобы собрать ролик. Каждая
 * недостающая вещь объясняется тем, что из-за неё сломается, и как это починить
 * на этой операционной системе.
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const results = [];
const ok = (name, detail) => results.push({ level: 'ok', name, detail });
const warn = (name, detail, fix) => results.push({ level: 'warn', name, detail, fix });
const fail = (name, detail, fix) => results.push({ level: 'fail', name, detail, fix });

function has(command) {
  try {
    execSync(isWindows ? `where ${command}` : `command -v ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readConfig() {
  const file = path.join(root, 'config', 'project.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail('Конфигурация', `config/project.json повреждён: ${error.message}`, 'Восстановите файл или запустите настройку заново.');
    return null;
  }
}

function readEnv() {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

// ── Node ────────────────────────────────────────────────
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) ok('Node.js', `версия ${process.versions.node}`);
else
  fail(
    'Node.js',
    `версия ${process.versions.node}, нужна 20 или новее`,
    'Скачайте свежую версию с nodejs.org и установите поверх.',
  );

// ── Зависимости ─────────────────────────────────────────
if (existsSync(path.join(root, 'node_modules', 'remotion'))) ok('Библиотеки', 'установлены');
else fail('Библиотеки', 'не установлены', 'Выполните: npm run install-deps');

// ── ffmpeg ──────────────────────────────────────────────
if (has('ffmpeg') && has('ffprobe')) {
  ok('ffmpeg', 'найден');
} else {
  fail(
    'ffmpeg',
    'не найден — без него нельзя вырезать паузы и собрать звук',
    isMac
      ? 'Установите Homebrew с brew.sh, затем: brew install ffmpeg'
      : isWindows
        ? 'Установите через winget: winget install Gyan.FFmpeg — и перезапустите терминал'
        : 'Установите пакет ffmpeg вашим пакетным менеджером.',
  );
}

// ── whisper ─────────────────────────────────────────────
const config = readConfig();
if (has('whisper-cli') || has('whisper')) {
  ok('Распознавание речи', 'whisper найден');
  const model = config?.transcribe?.model;
  if (model && !existsSync(path.isAbsolute(model) ? model : path.join(root, model))) {
    warn(
      'Модель распознавания',
      `файл модели не найден: ${model}`,
      'Запустите npm run install-deps — он скачает модель (1,6 ГБ, один раз) и положит куда нужно.',
    );
  }
} else {
  fail(
    'Распознавание речи',
    'whisper не найден — без него не посчитать тайминги по озвучке',
    isMac
      ? 'brew install whisper-cpp'
      : isWindows
        ? 'Скачайте сборку whisper.cpp и добавьте её папку в PATH.'
        : 'Соберите whisper.cpp и добавьте whisper-cli в PATH.',
  );
}

// ── Конфигурация и стиль ────────────────────────────────
if (!config) {
  fail('Конфигурация', 'config/project.json отсутствует', 'Напишите «настрой фабрику».');
} else if (!config.configured) {
  warn('Конфигурация', 'мастер настройки ещё не пройден', 'Напишите «настрой фабрику» — это займёт пару минут.');
} else {
  ok('Конфигурация', `формат ${config.format.width}×${config.format.height}, ${config.format.fps} кадров/с`);
}

if (existsSync(path.join(root, 'style', 'index.ts'))) ok('Стиль', 'стиль-пак на месте');
else fail('Стиль', 'папка style пуста', 'Напишите «поменяй стиль» и пришлите свой дизайн-код.');

// ── Скиллы ──────────────────────────────────────────────
// Живут в .agents/skills (Codex), в .claude/skills на их месте ссылки (Claude).
const skillsHome = path.join(root, '.agents', 'skills');
const skills = existsSync(skillsHome)
  ? readdirSync(skillsHome, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];
const unlinked = skills.filter((name) => !existsSync(path.join(root, '.claude', 'skills', name, 'SKILL.md')));
if (!skills.length) fail('Скиллы', 'папка .agents/skills пуста', 'Восстановите её из архива фабрики.');
else if (unlinked.length)
  fail('Скиллы', `Claude не видит: ${unlinked.join(', ')}`, 'Выполните: npm run install-deps — он восстановит ссылки.');
else ok('Скиллы', `на месте: ${skills.join(', ')}`);

// ── Ключи сервисов ──────────────────────────────────────
const env = readEnv();
if (env.ELEVENLABS_API_KEY) ok('ElevenLabs', 'ключ на месте — озвучка доступна');
else warn('ElevenLabs', 'ключа нет — работаем с готовыми файлами озвучки', 'Захотите генерировать голос — добавьте ключ в .env, всё остальное подхватится само.');

if (env.AVATAR_API_KEY) ok('ИИ-аватар', 'ключ на месте');
else warn('ИИ-аватар', 'не подключён', 'Не обязателен. Ключ добавляется в .env в любой момент.');

// ── Отчёт ───────────────────────────────────────────────
const mark = { ok: '  ок  ', warn: ' можно', fail: ' нужно' };
console.log('\nПроверка окружения\n');
for (const r of results) {
  console.log(`[${mark[r.level]}] ${r.name}: ${r.detail}`);
  if (r.fix && r.level !== 'ok') console.log(`          ${r.fix}`);
}

const failures = results.filter((r) => r.level === 'fail').length;
console.log(
  failures
    ? `\nНе хватает: ${failures}. Сделайте, что написано выше, и запустите проверку снова: npm run doctor\n`
    : '\nВсё на месте. Можно присылать материал для ролика.\n',
);
// Подпись продукта. Не реклама: чтобы владелец копии знал, к кому идти с
// вопросами лицензии и сложной настройки.
try {
  const author = JSON.parse(readFileSync(path.join(root, 'config', 'author.json'), 'utf8'));
  console.log(`  ${author.product} · ${author.author} · условия в LICENSE.md\n`);
} catch {}

process.exit(failures ? 1 : 0);

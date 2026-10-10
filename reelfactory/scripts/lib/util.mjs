/**
 * Общие мелочи для всех скриптов конвейера: пути, запуск команд, чтение
 * настроек, транслитерация имён, разговор с человеком.
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const isWindows = process.platform === 'win32';
export const isMac = process.platform === 'darwin';

export const p = (...parts) => path.join(ROOT, ...parts);

// ── разговор с человеком ────────────────────────────────
export const say = (text = '') => console.log(text);
export const step = (text) => console.log(`\n▸ ${text}`);
export const done = (text) => console.log(`  ✓ ${text}`);
export const note = (text) => console.log(`  · ${text}`);
export const problem = (text) => console.log(`  ! ${text}`);

/** Остановиться с понятным человеку объяснением, без стека вызовов. */
export function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

// ── команды ─────────────────────────────────────────────
export function has(command) {
  try {
    execSync(isWindows ? `where ${command}` : `command -v ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Запустить и вернуть вывод. Ошибка бросается с внятным текстом. */
export function run(command, args, { quiet = true } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Не удалось запустить ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    const tail = (result.stderr || '').split('\n').slice(-6).join('\n');
    throw new Error(`Команда ${command} завершилась с ошибкой:\n${tail}`);
  }
  return result.stdout ?? '';
}

/** Запустить и отдать вывод человеку прямо в терминал. Для долгих операций. */
export const runLoud = (command, args) => run(command, args, { quiet: false });

/** ffmpeg пишет разбор в stderr и возвращает ненулевой код — тут это нормально. */
export function ffmpegProbeStderr(args) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return result.stderr ?? '';
}

/** Длительность медиафайла в секундах. */
export function mediaDuration(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  const seconds = parseFloat(out.trim());
  if (!Number.isFinite(seconds)) throw new Error(`Не удалось определить длительность файла: ${file}`);
  return seconds;
}

/**
 * Длительность именно КАРТИНКИ, а не файла.
 *
 * Длина файла — это длина самой долгой дорожки в нём, а кодировщик звука
 * дописывает в конец служебный хвост тишины, до полутора десятых секунды. За
 * синхрон отвечает картинка: с ней сверяется голос, и её длину надо мерить.
 * Видеодорожки в файле нет — остаётся длина файла, врать тут нечем.
 */
export function videoStreamDuration(file) {
  try {
    const out = execFileSync(
      'ffprobe',
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=duration',
        '-of', 'default=nw=1:nk=1',
        file,
      ],
      { encoding: 'utf8' },
    );
    const seconds = parseFloat(out.trim());
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  } catch {
    // Контейнер не отдал длину потока — не беда, ниже берётся длина файла.
  }
  return mediaDuration(file);
}

/** Есть ли в файле видеодорожка. */
export function hasVideoStream(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_type', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  return out.trim() === 'video';
}

// ── файлы и настройки ───────────────────────────────────
export const readJSON = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const writeJSON = (file, data) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
};
export const ensureDir = (dir) => mkdirSync(dir, { recursive: true });

export const configPath = () => p('config', 'project.json');
export const readConfig = () => readJSON(configPath());
export const writeConfig = (config) => writeJSON(configPath(), config);

// ── куда попадают готовые ролики ────────────────────────
/**
 * Готовые ролики складываются в общую папку РЯДОМ с системой — по умолчанию
 * `OUT REELS` там же, где лежит сама папка системы.
 *
 * Почему снаружи: внутрь системы человек не ходит, а за роликами ходит каждый
 * день. Искать их по папкам проектов — лишняя работа, и рано или поздно кто-то
 * начнёт наводить порядок внутри рабочих файлов.
 *
 * Путь считается от корня системы, а не от того, откуда запущена команда:
 * иначе результат зависел бы от текущей папки терминала.
 */
export function readyDir(config) {
  const dir = config?.render?.outputDir || '../OUT REELS';
  return path.resolve(ROOT, dir);
}

/**
 * Где лежит готовый файл ролика. Место одно — общая папка: вторая копия в папке
 * проекта только занимала бы место.
 */
export function reelOutputs(meta, config) {
  return { ready: path.join(readyDir(config), `${meta.id}.mp4`) };
}

/** Путь к готовому ролику — или null, если ролик ещё не собран. */
export function findReel(meta, config) {
  const { ready } = reelOutputs(meta, config);
  return existsSync(ready) ? ready : null;
}

export function readEnv() {
  const file = p('.env');
  if (!existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

// ── имена ───────────────────────────────────────────────
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Имя папки и композиции — всегда латиницей.
 * Кириллица и пробелы в путях ломают рендер на Windows, а подчёркивания
 * запрещены в именах композиций Remotion.
 */
export function slugify(text) {
  const slug = String(text)
    .toLowerCase()
    .split('')
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'reel';
}

export const today = () => new Date().toISOString().slice(0, 10);

/**
 * Разбор аргументов вида --ключ значение и --флаг.
 *
 * Ключи из списка `boolean` значения не забирают. Это нужно там, где за флагом
 * идёт СПИСОК файлов: `--import a.png b.png c.png`. Без такого списка первый
 * файл молча уезжал в значение флага, оставшиеся — в свободные аргументы, и
 * человек видел на один снимок меньше, чем передал, без единого слова о том,
 * куда он делся.
 */
export function args(argv = process.argv.slice(2), { boolean = [] } = {}) {
  const flags = new Set(boolean);
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (item.startsWith('--')) {
      const key = item.slice(2);
      const next = argv[i + 1];
      if (flags.has(key) || next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(item);
  }
  return out;
}

/** Папка проекта по его идентификатору. */
export function projectDir(id) {
  const dir = p('projects', id);
  if (!existsSync(dir)) stop(`Проект «${id}» не найден. Посмотрите, что лежит в папке projects.`);
  return dir;
}

export const secondsToFrames = (seconds, fps) => Math.round(seconds * fps);
export const fmt = (seconds) => `${seconds.toFixed(2)}с`;

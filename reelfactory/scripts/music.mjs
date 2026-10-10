#!/usr/bin/env node
/**
 * БАНК ФОНОВОЙ МУЗЫКИ. Показать, что есть, и положить туда своё.
 *
 *     node scripts/music.mjs --list
 *     node scripts/music.mjs --add "/путь/к/треку.mp3" --title "Название"
 *     node scripts/music.mjs --add "https://example.com/track.mp3"
 *     node scripts/music.mjs --remove chill-soft-pillow.mp3
 *
 * Файл кладётся в `public/music/`, приводится к общей громкости и вписывается в
 * `config/music.json` — без этой записи система трек не увидит: при рендере
 * читать папку нельзя, композиция собирается в браузере.
 *
 * Громкость выравнивается намеренно: иначе один трек звучал бы шёпотом, другой
 * перекрикивал голос, и настройку громкости пришлось бы крутить под каждый.
 */
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import {
  args, done, ensureDir, mediaDuration, note, p, readJSON, run, say, step, stop, writeJSON,
} from './lib/util.mjs';
import { normalizeLoudness } from './lib/loudness.mjs';

/** Общий уровень для всех треков банка. Обычный уровень сведённой музыки. */
const TRACK_LUFS = -16;

const bankFile = p('config', 'music.json');
const musicDir = p('public', 'music');
const bank = readJSON(bankFile);

const options = args(process.argv.slice(2), { boolean: ['list'] });

// ── показать банк ───────────────────────────────────────
if (options.list || (!options.add && !options.remove)) {
  say(`\n  Треки для фона — ${bank.tracks.length} шт.\n`);
  if (!bank.tracks.length) {
    note('банк пуст: добавьте свой трек через --add');
  }
  for (const track of bank.tracks) {
    const minutes = track.seconds ? `${Math.floor(track.seconds / 60)}:${String(track.seconds % 60).padStart(2, '0')}` : '—';
    const missing = existsSync(p('public', track.file)) ? '' : '  ! файла нет на месте';
    say(`  ${track.title}`);
    say(`    ${track.mood ?? 'без пометки'} · ${minutes} · ${track.license ?? 'лицензия не указана'}${missing}`);
    say(`    ${path.basename(track.file)}`);
    say('');
  }
  say('  Добавить свой: node scripts/music.mjs --add <файл или ссылка>\n');
  process.exit(0);
}

// ── убрать трек ─────────────────────────────────────────
if (options.remove) {
  const name = String(options.remove);
  const index = bank.tracks.findIndex((t) => path.basename(t.file) === name || t.file === name);
  if (index === -1) stop(`В банке нет трека «${name}». Список: node scripts/music.mjs --list`);

  const [removed] = bank.tracks.splice(index, 1);
  writeJSON(bankFile, bank);
  const file = p('public', removed.file);
  if (existsSync(file)) unlinkSync(file);
  done(`убрал: ${removed.title}`);
  process.exit(0);
}

// ── добавить трек ───────────────────────────────────────
const sourceRef = String(options.add);
const isLink = /^https?:\/\//i.test(sourceRef);

ensureDir(musicDir);

/**
 * Имя файла в банке. Кириллица и пробелы в служебных путях ломают рендер на
 * Windows, поэтому имя приводится к латинице — название при этом сохраняется
 * как есть, оно живёт в записи банка, а не в имени файла.
 */
function safeName(text) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  const latin = text.toLowerCase().split('').map((c) => (c in map ? map[c] : c)).join('');
  const clean = latin.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'track';
}

step(isLink ? 'Скачиваю трек' : 'Беру файл');

const rawName = isLink ? decodeURIComponent(new URL(sourceRef).pathname.split('/').pop() || 'track') : path.basename(sourceRef);
const baseName = safeName(rawName.replace(/\.[a-z0-9]+$/i, ''));
const target = path.join(musicDir, `${baseName}.mp3`);

if (existsSync(target)) stop(`Трек с таким именем уже есть: ${path.basename(target)}. Уберите старый или переименуйте файл.`);

const downloaded = path.join(musicDir, `.${baseName}.source`);

try {
  if (isLink) {
    // Ссылка может вести на что угодно — на страницу, на редирект, на файл.
    // Скачиваем, а разбираться, звук ли это, будет ffmpeg ниже.
    run('curl', ['-fsSL', '--max-time', '300', '-o', downloaded, sourceRef]);
  } else {
    const from = path.isAbsolute(sourceRef) ? sourceRef : path.resolve(process.cwd(), sourceRef);
    if (!existsSync(from)) stop(`Файла нет: ${from}`);
    copyFileSync(from, downloaded);
  }
} catch (error) {
  if (existsSync(downloaded)) unlinkSync(downloaded);
  stop(
    `Не получилось взять файл.\n\n${error.message}\n\n` +
      (isLink
        ? 'Проверьте ссылку: она должна вести прямо на аудиофайл, а не на страницу с плеером.'
        : 'Проверьте путь к файлу.'),
  );
}

step('Перевожу в общий формат');
try {
  // Приводим всё к одному виду: mp3, чтобы дальше не разбирать десяток форматов.
  run('ffmpeg', ['-y', '-i', downloaded, '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', target]);
} catch (error) {
  unlinkSync(downloaded);
  stop(
    `Это не похоже на звуковой файл.\n\n${error.message}\n\n` +
      'Нужен аудиофайл: mp3, wav, m4a, ogg. Ссылка на страницу с плеером не подойдёт — нужна ссылка на сам файл.',
  );
}
unlinkSync(downloaded);

step('Выравниваю громкость');
const level = normalizeLoudness(target, { targetLufs: TRACK_LUFS, truePeak: -1 });
if (level.ok) done(`было ${level.before.toFixed(1)} LUFS, стало ${(level.after ?? TRACK_LUFS).toFixed(1)} — как у остальных треков`);
else note(`громкость оставлена как есть: ${level.reason}`);

const seconds = Math.round(mediaDuration(target));

bank.tracks.push({
  file: `music/${path.basename(target)}`,
  title: options.title ? String(options.title) : rawName.replace(/\.[a-z0-9]+$/i, ''),
  mood: options.mood ? String(options.mood) : 'свой трек',
  seconds,
  author: options.author ? String(options.author) : 'не указан',
  license: options.license ? String(options.license) : 'свой файл — за права отвечает владелец',
  source: isLink ? sourceRef : 'добавлен с этого компьютера',
});
writeJSON(bankFile, bank);

const minutes = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
done(`в банке: ${bank.tracks[bank.tracks.length - 1].title} · ${minutes}`);

say('\n  Трек добавлен. Он попадёт в общую очередь выбора, если музыка включена.');
say('  Чтобы он играл всегда — назовите его в настройке music.track.\n');

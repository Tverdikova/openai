#!/usr/bin/env node
/**
 * БАНК ЗВУКОВ ДВИЖЕНИЯ. Показать, что есть, и положить туда своё.
 *
 *     node scripts/sfx.mjs --list
 *     node scripts/sfx.mjs --add "/путь/к/щелчку.wav" --role click
 *     node scripts/sfx.mjs --add "https://example.com/whoosh.mp3" --role whoosh
 *     node scripts/sfx.mjs --remove click-3.wav
 *
 * Файл кладётся в `public/sfx/` под латинским именем `<роль>-<номер>.wav`,
 * приводится к общей громкости и вписывается в `config/sfx.json` — без этой
 * записи система звук не увидит: при рендере читать папку нельзя, композиция
 * собирается в браузере. Исходное имя может быть любым — с пробелами,
 * кириллицей, скобками; наружу оно не попадает.
 *
 * ПОЧЕМУ ГРОМКОСТЬ МЕРЯЕТСЯ НЕ КАК У МУЗЫКИ. Интегральная громкость по EBU R128
 * на щелчке в сорок миллисекунд не значит ничего: почти весь файл — тишина, и
 * стандарт честно отвечает «−70». Поэтому здесь берётся МАКСИМАЛЬНАЯ МГНОВЕННАЯ
 * громкость — окно в 400 мс, то самое, которым ухо и оценивает короткий звук.
 * Перед замером файл обкладывается тишиной: звук короче окна иначе не даёт ни
 * одного полного отсчёта.
 */
import { copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  args, done, ensureDir, mediaDuration, note, p, problem, readJSON, run, say, step, stop, writeJSON,
} from './lib/util.mjs';

/** Общий уровень банка: максимальная мгновенная громкость. */
const TARGET_LUFS = -26;
/** Потолок по истинному пику. Запас в децибел спасает от хрипа после пережатия. */
const PEAK_CEIL = -1;

/**
 * СЛОВАРЬ РОЛЕЙ — копия того, что живёт в `core/sfx.ts`. Настоящий словарь там:
 * по нему считается микс и останавливается сборка при незнакомой роли. Здесь
 * нужны только имена и смыслы, чтобы человеку было что читать в списке.
 */
const ROLES = [
  ['typing', 'набор текста целиком, одним звуком на весь кусок'],
  ['type', 'одно нажатие: тап, Enter, один символ'],
  ['tick', 'шаг счётчика, галочка по списку'],
  ['scroll', 'непрерывная прокрутка'],
  ['select', 'выбор, наведение, стало активным'],
  ['enter', 'элемент появился в кадре'],
  ['swipe', 'сдвиг на шаг'],
  ['open', 'окно раскрылось'],
  ['close', 'окно закрылось'],
  ['snap', 'предмет встал на место'],
  ['drop', 'предмет опустился сверху'],
  ['toggle', 'переключатель'],
  ['check', 'галочка поставлена'],
  ['click', 'нажатие'],
  ['notify', 'уведомление прилетело'],
  ['error', 'ошибка'],
  ['whoosh', 'склейка'],
  ['intro', 'затяжной вуш под целый блок, пик к стыку'],
  ['rise', 'нарастание, только перед thud или success'],
  ['success', 'готово'],
  ['thud', 'тяжёлая посадка, не чаще раза на ролик'],
];

const RED = '\x1b[31m';
const OFF = '\x1b[0m';

const bankFile = p('config', 'sfx.json');
const sfxDir = p('public', 'sfx');
const bank = readJSON(bankFile);
if (!Array.isArray(bank.sounds)) bank.sounds = [];

const options = args(process.argv.slice(2), { boolean: ['list'] });

// ── показать банк ───────────────────────────────────────
if (options.list || (!options.add && !options.remove)) {
  say(`\n  Звуки движения — ${bank.sounds.length} шт., все на ${bank.targetLufs ?? TARGET_LUFS} LUFS.\n`);

  let empty = 0;
  for (const [role, meaning] of ROLES) {
    const list = bank.sounds.filter((s) => s.role === role);
    if (!list.length) {
      empty++;
      say(`  ${RED}${role}${OFF}  —  ${meaning}`);
      say(`      ${RED}звука нет: сцена попросит эту роль и получит тишину${OFF}`);
      say('');
      continue;
    }
    say(`  ${role}  —  ${meaning}`);
    for (const sound of list) {
      const name = path.basename(sound.file);
      const missing = existsSync(p('public', sound.file)) ? '' : `  ${RED}! файла нет на месте${OFF}`;
      say(`      ${name.padEnd(14)} ${String(sound.seconds?.toFixed(2) ?? '?').padStart(5)}с  ${sound.what ?? ''}${missing}`);
    }
    say('');
  }

  if (empty) {
    problem(`пустых ролей: ${empty}. Сцены, которые их попросят, прозвучат тишиной.`);
    say('');
  }
  say('  Добавить свой: node scripts/sfx.mjs --add <файл или ссылка> --role <роль>\n');
  process.exit(0);
}

// ── убрать звук ─────────────────────────────────────────
if (options.remove) {
  const name = String(options.remove);
  const index = bank.sounds.findIndex((s) => path.basename(s.file) === name || s.file === name);
  if (index === -1) stop(`В банке нет звука «${name}». Список: node scripts/sfx.mjs --list`);

  const [removed] = bank.sounds.splice(index, 1);
  writeJSON(bankFile, bank);
  const file = p('public', removed.file);
  if (existsSync(file)) unlinkSync(file);
  done(`убрал: ${path.basename(removed.file)} (${removed.role})`);
  process.exit(0);
}

// ── добавить звук ───────────────────────────────────────
const role = String(options.role ?? '');
if (!ROLES.some(([name]) => name === role)) {
  stop(
    `Роль «${role || 'не указана'}» не из словаря.\n\n` +
      `Роль — это СМЫСЛ звука, а не имя файла: сцена просит «щелчок», а какой именно\n` +
      `щелчок сегодня в банке, её не касается.\n\n` +
      `Есть такие: ${ROLES.map(([name]) => name).join(', ')}.`,
  );
}

const sourceRef = String(options.add);
const isLink = /^https?:\/\//i.test(sourceRef);

ensureDir(sfxDir);

/** Следующий свободный номер в роли: `click-1.wav`, `click-2.wav`, ... */
function nextName() {
  let number = 1;
  while (existsSync(path.join(sfxDir, `${role}-${number}.wav`))) number++;
  return `${role}-${number}.wav`;
}

const target = path.join(sfxDir, nextName());
const downloaded = path.join(sfxDir, `.${path.basename(target)}.source`);

step(isLink ? 'Скачиваю звук' : 'Беру файл');
try {
  if (isLink) {
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
      (isLink ? 'Ссылка должна вести прямо на звуковой файл.' : 'Проверьте путь к файлу.'),
  );
}

step('Перевожу в общий формат');
try {
  // Стерео сохраняется: широкий дизайнерский вуш, сведённый в моно, теряет
  // половину тела. Больше двух каналов сводим — вертикальный ролик их не несёт.
  const channels = Number(
    execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels', '-of', 'default=nw=1:nk=1', downloaded], { encoding: 'utf8' }).trim(),
  ) || 2;

  // Тишина по краям срезается: она врёт о длине. Выбор варианта под `lasts`
  // идёт по длине звука, и щелчок, у которого в файле полсекунды пустоты,
  // система приняла бы за полусекундное событие.
  const trim =
    'silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.02:detection=peak,' +
    'areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.05:detection=peak,areverse';

  run('ffmpeg', [
    '-y', '-hide_banner', '-nostats', '-i', downloaded,
    '-vn', '-ar', '48000', ...(channels > 2 ? ['-ac', '2'] : []),
    '-af', trim, '-c:a', 'pcm_s16le', target,
  ]);
} catch (error) {
  unlinkSync(downloaded);
  stop(
    `Это не похоже на звуковой файл.\n\n${error.message}\n\n` +
      'Нужен звук: wav, mp3, m4a, ogg — или видеофайл, из которого его можно вынуть.',
  );
}
unlinkSync(downloaded);

/**
 * Замер: максимальная мгновенная громкость и истинный пик.
 *
 * ffmpeg печатает разбор в stderr и заканчивает ненулевым кодом — тут это норма.
 */
function measure(file) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-nostats', '-v', 'verbose', '-i', file,
      '-af', 'adelay=300|300,apad=pad_dur=0.8,ebur128=peak=true:framelog=verbose',
      '-f', 'null', '-',
    ],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );
  const text = result.stderr ?? '';

  let momentary = -120;
  for (const match of text.matchAll(/M:\s*(-?\d+(?:\.\d+)?)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > momentary) momentary = value;
  }

  const peakBlock = text.slice(text.lastIndexOf('True peak:'));
  const peakMatch = peakBlock.match(/Peak:\s*(-?\d+(?:\.\d+)?)/);
  const truePeak = peakMatch ? Number(peakMatch[1]) : null;

  return { momentary, truePeak };
}

/**
 * Секунда, где звук громче всего.
 *
 * Считается по огибающей, а не по одному отсчёту: одиночный выброс может
 * прийтись на щелчок оцифровки, а слышимый пик — это энергия за окно. Файл
 * читается моно на 8 кГц — для огибающей этого достаточно, а памяти уходит
 * в десятки раз меньше.
 */
function findPeak(file) {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
    { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 },
  );
  const samples = raw.length >> 1;
  if (!samples) return 0;

  const window = 320; // 40 мс
  let sum = 0;
  let best = 0;
  let bestAt = 0;
  for (let i = 0; i < samples; i++) {
    const value = raw.readInt16LE(i * 2) / 32768;
    sum += value * value;
    if (i >= window) {
      const old = raw.readInt16LE((i - window) * 2) / 32768;
      sum -= old * old;
    }
    if (i >= window && sum > best) {
      best = sum;
      bestAt = i - window / 2;
    }
  }
  return Number((bestAt / 8000).toFixed(3));
}

step('Выравниваю громкость');
const before = measure(target);
if (before.momentary <= -70) {
  note('в файле почти нет звука — оставляю как есть');
} else {
  // Два ограничения сразу: попасть в общий уровень банка и не пробить потолок
  // пиков. Побеждает меньшее — иначе выравнивание само устроит перегруз.
  const byLoudness = TARGET_LUFS - before.momentary;
  const byPeak = before.truePeak === null ? Infinity : PEAK_CEIL - before.truePeak;
  const gain = Math.min(byLoudness, byPeak);

  const temp = `${target}.gain.wav`;
  run('ffmpeg', ['-y', '-hide_banner', '-nostats', '-i', target, '-af', `volume=${gain.toFixed(2)}dB`, '-c:a', 'pcm_s16le', temp]);
  copyFileSync(temp, target);
  unlinkSync(temp);

  const after = measure(target);
  done(`было ${before.momentary.toFixed(1)}, стало ${after.momentary.toFixed(1)} — как у остальных звуков`);
  if (byPeak < byLoudness) note('дальше поднимать нельзя: упёрлись в потолок пиков');
}

const seconds = Number(mediaDuration(target).toFixed(3));
const peakAt = findPeak(target);
const level = measure(target).momentary;

bank.sounds.push({
  file: `sfx/${path.basename(target)}`,
  role,
  what: options.what ? String(options.what) : ROLES.find(([name]) => name === role)[1],
  seconds,
  loudness: Number(level.toFixed(1)),
  peakAt,
  author: options.author ? String(options.author) : 'не указан',
  license: options.license ? String(options.license) : 'свой файл — за права отвечает владелец',
  source: options.source ? String(options.source) : isLink ? sourceRef : 'добавлен с этого компьютера',
});
writeJSON(bankFile, bank);

done(`в банке: ${path.basename(target)} · ${role} · ${seconds.toFixed(2)}с · пик на ${peakAt.toFixed(2)}с`);

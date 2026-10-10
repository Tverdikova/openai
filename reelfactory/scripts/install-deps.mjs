#!/usr/bin/env node
/**
 * УСТАНОВКА ТЕХНИЧЕСКОЙ ЧАСТИ. Первый шаг: сначала на машине появляется всё
 * необходимое, и только потом идут проверка и настройка.
 *
 *     node scripts/install-deps.mjs          спросит подтверждение
 *     node scripts/install-deps.mjs --yes    без вопросов
 *     node scripts/install-deps.mjs --model small
 *
 * Запускает его агент, когда человек пишет «запускай установку». Node.js к этому
 * моменту уже стоит — без него скрипт не запустить.
 *
 * Что делается по порядку:
 *   библиотеки — npm install, если их ещё нет
 *   .env       — файл ключей сервисов из .env.example
 *   скиллы     — ссылки .claude/skills → .agents/skills (Windows — соединения папок)
 *   ffmpeg     — режет паузы, склеивает звук, собирает готовый файл
 *   whisper    — распознаёт речь, чтобы посчитать тайминги по голосу
 *   модель     — веса для whisper, скачиваются один раз
 *
 * Скрипт ничего не делает молча и не просит прав администратора там, где можно
 * обойтись без них. Если шаг требует пароля, он открывает системное окно, где
 * пароль вводит сам человек, и останавливается до повторного запуска.
 */
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import readline from 'node:readline/promises';
import path from 'node:path';
import { args, done, has, isMac, isWindows, note, p, problem, runLoud, say, step, stop } from './lib/util.mjs';

const options = args();
const auto = options.yes === true;

const MODELS = {
  'large-v3-turbo': { file: 'ggml-large-v3-turbo.bin', size: '1.6 ГБ', about: 'лучшее качество на русском' },
  medium: { file: 'ggml-medium.bin', size: '1.5 ГБ', about: 'хорошее качество' },
  small: { file: 'ggml-small.bin', size: '0.5 ГБ', about: 'быстро, для слабых машин' },
  base: { file: 'ggml-base.bin', size: '0.15 ГБ', about: 'черновое качество, для проверки' },
};
const modelKey = typeof options.model === 'string' ? options.model : 'large-v3-turbo';
const model = MODELS[modelKey] ?? stop(`Неизвестная модель «${modelKey}». Доступны: ${Object.keys(MODELS).join(', ')}`);

async function confirm(question) {
  if (auto) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`  ${question} [Д/н] `);
  rl.close();
  return !/^n|^н/i.test(answer.trim());
}

/** Байты в мегабайты — для строки прогресса. */
const mb = (bytes) => Math.round(bytes / 1024 / 1024);

async function download(url, target, label) {
  mkdirSync(path.dirname(target), { recursive: true });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Не удалось скачать ${label}: ответ сервера ${response.status}`);

  const total = Number(response.headers.get('content-length') ?? 0);
  let loaded = 0;
  let lastShown = 0;
  const temp = `${target}.part`;

  /**
   * Скачивание большого файла обязано выглядеть как работа, а не как зависший
   * терминал: человек на пустом экране жмёт Ctrl+C на середине полутора
   * гигабайт. Поэтому сначала — прямая фраза о том, что началось и надолго ли.
   */
  say(
    total
      ? `  Скачиваю ${label}, ${mb(total)} МБ — это несколько минут.`
      : `  Скачиваю ${label} — размер сервер не сообщил, ориентируйтесь на мегабайты ниже.`,
  );

  /**
   * Показываются и проценты, и мегабайты, а шаг считается по скачанному
   * объёму, а не по процентам. Иначе при неизвестном размере процент навсегда
   * оставался бы нулём, и строка не появлялась бы вообще.
   */
  const STEP_BYTES = 8 * 1024 * 1024;
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => {
    loaded += chunk.length;
    if (loaded < lastShown + STEP_BYTES) return;
    lastShown = loaded;
    const progress = total
      ? `${Math.floor((loaded / total) * 100)}% · ${mb(loaded)} из ${mb(total)} МБ`
      : `${mb(loaded)} МБ`;
    process.stdout.write(`\r  ${label}: ${progress}      `);
  });

  await pipeline(source, createWriteStream(temp));
  renameSync(temp, target);
  process.stdout.write(`\r  ${label}: готово        \n`);
}

/** Дописать папку в PATH этого процесса — чтобы новые программы были видны без перезапуска. */
function addToPath(dir) {
  if (existsSync(dir) && !process.env.PATH.split(path.delimiter).includes(dir)) {
    process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
  }
}

/** Первый файл с таким именем внутри папки, на любой глубине. */
function findFile(dir, name) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === name) return full;
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    }
  }
  return null;
}

// Homebrew, поставленный только что, ещё не в PATH окна, из которого нас запустили.
if (isMac) {
  addToPath('/opt/homebrew/bin');
  addToPath('/usr/local/bin');
}
if (isWindows && existsSync(p('tools', 'whisper'))) {
  const exe = findFile(p('tools', 'whisper'), 'whisper-cli.exe');
  if (exe) addToPath(path.dirname(exe));
}

say('\n  Установка технической части\n  ===========================');

// ── 1. Библиотеки фабрики ───────────────────────────────
step('Библиотеки фабрики');
if (existsSync(p('node_modules', 'remotion'))) {
  done('уже установлены');
} else {
  say('  Устанавливаю. Первый раз это занимает несколько минут...');
  try {
    // Через оболочку: на Windows npm — это npm.cmd, напрямую он не запускается.
    execSync('npm install', { cwd: p(), stdio: 'inherit' });
    done('библиотеки установлены');
  } catch {
    problem('Установка библиотек не удалась — текст ошибки выше.');
    process.exit(1);
  }
}

// ── 2. Файл ключей ──────────────────────────────────────
step('Файл ключей сервисов');
if (existsSync(p('.env'))) {
  done('уже есть');
} else {
  copyFileSync(p('.env.example'), p('.env'));
  done('создан .env из примера — ключи вписываются туда, когда понадобятся');
}

// ── 3. Скиллы ───────────────────────────────────────────
/**
 * Скиллы живут в .agents/skills — там их ищет Codex. Claude ищет их в
 * .claude/skills, поэтому там на месте каждого — ссылка, а не копия. На Mac
 * ссылки приезжают из архива рабочими. На Windows архив их не восстанавливает:
 * на месте ссылки оказывается пустышка, и её заменяет соединение папок — оно
 * не требует ни прав администратора, ни режима разработчика.
 */
step('Скиллы — общие для Claude и Codex');
const skillsHome = p('.agents', 'skills');
const skillsLinks = p('.claude', 'skills');
mkdirSync(skillsLinks, { recursive: true });
let linked = 0;
for (const entry of readdirSync(skillsHome, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const target = path.join(skillsHome, entry.name);
  const link = path.join(skillsLinks, entry.name);
  if (existsSync(path.join(link, 'SKILL.md'))) continue;
  let stale = null;
  try {
    stale = lstatSync(link);
  } catch {}
  if (stale?.isDirectory() && !stale.isSymbolicLink()) {
    problem(`В .claude/skills/${entry.name} лежит обычная папка без SKILL.md — не трогаю, разберитесь вручную.`);
    continue;
  }
  if (stale) rmSync(link, { force: true });
  if (isWindows) symlinkSync(target, link, 'junction');
  else symlinkSync(path.relative(skillsLinks, target), link, 'dir');
  linked += 1;
}
done(linked ? `ссылок создано: ${linked}` : 'ссылки на месте');

// ── 4. Менеджер пакетов ─────────────────────────────────
step('Проверяю, чем ставить программы');

if (isMac && !has('brew')) {
  problem('На Mac программы ставятся через Homebrew, а его нет.');
  try {
    const release = await fetch('https://api.github.com/repos/Homebrew/brew/releases/latest', {
      headers: { 'User-Agent': 'reelfactory' },
    }).then((r) => r.json());
    const asset = (release.assets ?? []).find((a) => /\.pkg$/i.test(a.name));
    if (!asset) throw new Error('в последнем выпуске нет установщика .pkg');
    const pkg = p('tools', asset.name);
    await download(asset.browser_download_url, pkg, 'установщик Homebrew');
    runLoud('open', [pkg]);
    say('');
    say('  Открылось окно установщика Homebrew. В нём нажмите «Продолжить» и');
    say('  «Установить», а когда система спросит пароль учётной записи, введите его');
    say('  там же, в системном окне. Когда установщик скажет, что всё готово, —');
    say('  запустите этот шаг снова.');
  } catch (error) {
    problem(`Не получилось скачать установщик: ${error.message}`);
    say('  Скачайте Homebrew-….pkg со страницы github.com/Homebrew/brew/releases/latest,');
    say('  откройте его и запустите этот шаг снова.');
  }
  process.exit(1);
}
if (isWindows && !has('winget')) {
  problem('Не найден winget — встроенный установщик Windows.');
  say('  Обновите «Установщик приложений» в Microsoft Store и повторите.');
  process.exit(1);
}
done(isMac ? 'Homebrew на месте' : isWindows ? 'winget на месте' : 'системный пакетный менеджер');

// ── 5. ffmpeg ───────────────────────────────────────────
step('ffmpeg — обработка звука и видео');
if (has('ffmpeg') && has('ffprobe')) {
  done('уже установлен');
} else if (await confirm('Установить ffmpeg?')) {
  try {
    if (isMac) runLoud('brew', ['install', 'ffmpeg']);
    else if (isWindows) runLoud('winget', ['install', '--id', 'Gyan.FFmpeg', '-e', '--accept-source-agreements', '--accept-package-agreements']);
    else stop('Установите пакет ffmpeg пакетным менеджером вашей системы и повторите.');
    done('ffmpeg установлен');
    if (isWindows) note('Закройте и откройте окно заново, чтобы система увидела новую программу.');
  } catch (error) {
    problem(`Не получилось: ${error.message}`);
    say('  Поставьте ffmpeg вручную и запустите шаг снова.');
    process.exit(1);
  }
} else {
  note('Пропущено. Без ffmpeg ролик собрать нельзя.');
}

// ── 6. whisper ──────────────────────────────────────────
step('whisper — распознавание речи');
if (has('whisper-cli') || has('whisper')) {
  done('уже установлен');
} else if (await confirm('Установить whisper?')) {
  try {
    if (isMac) {
      runLoud('brew', ['install', 'whisper-cpp']);
      done('whisper установлен');
    } else if (isWindows) {
      // Готовой записи в winget нет — берём официальную сборку с GitHub.
      note('Скачиваю сборку whisper.cpp...');
      const releases = await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest', {
        headers: { 'User-Agent': 'reelfactory' },
      }).then((r) => r.json());
      const asset = (releases.assets ?? []).find((a) => /bin-x64\.zip$/i.test(a.name));
      if (!asset) throw new Error('в последнем выпуске нет готовой сборки для Windows');
      const zip = p('tools', asset.name);
      await download(asset.browser_download_url, zip, 'whisper');
      runLoud('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path "${zip}" -DestinationPath "${p('tools', 'whisper')}"`]);
      const exe = findFile(p('tools', 'whisper'), 'whisper-cli.exe');
      if (!exe) throw new Error('в сборке не нашлось whisper-cli.exe');
      const bin = path.dirname(exe);
      // PATH пользователя, а не системы: прав администратора не нужно.
      runLoud('powershell', [
        '-NoProfile',
        '-Command',
        `$old = [Environment]::GetEnvironmentVariable('Path', 'User'); ` +
          `if (-not (($old -split ';') -contains '${bin}')) { ` +
          `if ($old) { $new = $old + ';' + '${bin}' } else { $new = '${bin}' }; ` +
          `[Environment]::SetEnvironmentVariable('Path', $new, 'User') }`,
      ]);
      addToPath(bin);
      done('whisper установлен в tools\\whisper и добавлен в PATH');
      note('Новые программы станут видны после перезапуска приложения, в котором идёт работа.');
    } else {
      stop('Соберите whisper.cpp и добавьте whisper-cli в PATH, затем повторите.');
    }
  } catch (error) {
    problem(`Не получилось: ${error.message}`);
    say('  Поставьте whisper вручную и запустите шаг снова.');
    process.exit(1);
  }
} else {
  note('Пропущено. Без whisper не посчитать тайминги по голосу.');
}

// ── 7. Модель распознавания ─────────────────────────────
step(`Модель распознавания — ${modelKey} (${model.size}, ${model.about})`);
const modelPath = p('models', model.file);
if (existsSync(modelPath) && statSync(modelPath).size > 1_000_000) {
  done('уже скачана');
} else if (await confirm(`Скачать модель? Это ${model.size}, один раз.`)) {
  try {
    await download(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${model.file}?download=true`,
      modelPath,
      'модель',
    );
    done(`модель сохранена: models/${model.file}`);
  } catch (error) {
    problem(`Не получилось: ${error.message}`);
    say('  Проверьте интернет и запустите шаг снова.');
    process.exit(1);
  }
} else {
  note('Пропущено. Без модели whisper не запустится.');
}

say('\n  Техническая часть готова. Дальше — проверка: npm run doctor\n');

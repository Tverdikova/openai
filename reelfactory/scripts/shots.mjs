#!/usr/bin/env node
/**
 * СКРИНЫ — реальные экраны в ролике.
 *
 *     node scripts/shots.mjs --project ID --import ~/скрин1.png ~/скрин2.png
 *     node scripts/shots.mjs --project ID --capture
 *     node scripts/shots.mjs --project ID --capture --only deepseek
 *
 * Два источника картинок:
 *
 *   --import   человек прислал снимки сам. Работает всегда. Сам флаг
 *              необязателен: файлы можно просто перечислить после --project.
 *   --capture  система снимает сайты сама по списку адресов. ВЫКЛЮЧЕНО по
 *              умолчанию: съёмка чужих сайтов — осознанное решение владельца,
 *              а не то, что происходит само собой. Включается в настройке
 *              (`shots.web`).
 *
 * Скрин — доказательство, а не иллюстрация. Ставится там, где сцена утверждает
 * факт, в котором зритель может усомниться: цифра, чужой интерфейс, цена, дата.
 * Идеи, процессы и выгоды остаются графикой.
 */
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  args, done, ensureDir, isMac, isWindows, note, p, problem, readConfig,
  readJSON, say, slugify, step, stop, writeJSON,
} from './lib/util.mjs';

// `import` и `capture` — флаги без значения: за --import идёт список файлов, и
// забирать первый из них в значение флага нельзя.
const options = args(process.argv.slice(2), { boolean: ['import', 'capture'] });
if (!options.project) stop('Не указан проект: --project <идентификатор>');

const config = readConfig();
if (!config.shots.enabled) stop('Скрины отключены в настройке (shots.enabled).');

const dir = p('projects', String(options.project));
const meta = readJSON(path.join(dir, 'meta.json'));
// Снимки живут в папке проекта; в public они переезжают только на время рендера.
const shotsDir = path.join(dir, 'work', 'public', 'shots');
ensureDir(shotsDir);

// ── свои картинки ───────────────────────────────────────
if (options.import || options._.length) {
  // Обе формы дают одно и то же: файлы всегда приходят свободными аргументами,
  // и с флагом --import, и без него.
  const files = options._;
  if (!files.length) stop('Нечего добавлять: перечислите файлы после --import.');

  say(`\n  Добавляю присланные снимки: ${meta.title}\n`);
  const added = [];

  for (const file of files) {
    if (!existsSync(file)) {
      problem(`не найден: ${file}`);
      continue;
    }
    const extension = path.extname(file).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
      problem(`не картинка, пропускаю: ${path.basename(file)}`);
      continue;
    }
    const name = slugify(path.basename(file, extension));
    const target = path.join(shotsDir, `${name}${extension}`);
    copyFileSync(file, target);
    added.push(`${meta.id}/shots/${name}${extension}`);
    done(`${name}${extension}`);
  }

  if (!added.length) stop('Ни одного снимка добавить не удалось.');

  meta.shots = [...new Set([...(meta.shots ?? []), ...added])];
  writeJSON(path.join(dir, 'meta.json'), meta);
  say(`\n  Готово. В сцене снимок ставится через <ScreenPlate src="…" />\n`);
  process.exit(0);
}

// ── съёмка сайтов ───────────────────────────────────────
if (!options.capture) stop('Укажите, что делать: --import <файлы> или --capture');

if (!config.shots.web) {
  stop(
    'Съёмка сайтов выключена — это настройка по умолчанию.\n\n' +
      'Система не ходит по чужим сайтам, пока вы ей этого не разрешили: снимать\n' +
      'чужие страницы — ваше решение и ваша ответственность за то, что попадёт в\n' +
      'кадр.\n\n' +
      'Как включить — любым из трёх способов:\n' +
      '  · сказать системе «включи съёмку сайтов»;\n' +
      '  · пройти настройку заново: «настрой фабрику»;\n' +
      '  · вручную в config/project.json поставить shots.web = true\n\n' +
      'Подробнее про эту функцию — мануал, раздел 2.5 «Скрины реальных экранов».\n\n' +
      'Свои снимки можно добавлять всегда, ничего включать не нужно:\n' +
      '  npm run shots -- --project <проект> --import <файлы>',
  );
}

const manifestFile = path.join(dir, 'shots.json');
if (!existsSync(manifestFile)) {
  stop(
    `Нет списка съёмки: ${path.relative(p(), manifestFile)}\n\n` +
      'Он выглядит так:\n' +
      '{\n  "shots": [\n' +
      '    { "name": "pricing", "url": "https://example.com/pricing" },\n' +
      '    { "name": "stars", "url": "https://github.com/org", "area": "#org-repositories" }\n' +
      '  ]\n}',
  );
}

const manifest = readJSON(manifestFile);
const jobs = (manifest.shots ?? []).filter((s) => !options.only || s.name === options.only);
if (!jobs.length) stop('В списке съёмки нет ни одного подходящего пункта.');

if (jobs.length > config.shots.maxPerReel && !options.only) {
  note(
    `в списке ${jobs.length} снимков, а разумный предел — ${config.shots.maxPerReel} на ролик. ` +
      'Выше этого ролик превращается в обзор-нарезку.',
  );
}

// Берём Chrome, который уже стоит на машине: свой браузер тянуть незачем.
function findChrome() {
  if (config.shots.chromePath) return config.shots.chromePath;
  const candidates = isMac
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : isWindows
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const chrome = findChrome();
if (!chrome) {
  stop(
    'Не нашёл Google Chrome — он нужен для съёмки сайтов.\n' +
      'Установите его с google.com/chrome либо укажите путь в настройке (shots.chromePath).',
  );
}

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  stop('Не установлена библиотека съёмки. Выполните: npm install');
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const NAVIGATION_MS = 30000;  // медленные сайты успевают открыться
const CEILING_MS = 60000;     // ни один источник не висит дольше минуты

const started = Date.now();
const seconds = (ms = Date.now() - started) => `${(ms / 1000).toFixed(1)}с`;
const race = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('не уложился в минуту')), ms)),
  ]);

say(`\n  Съёмка сайтов: ${meta.title}\n`);
step(`${jobs.length} снимков, пауза ${config.shots.waitMs / 1000}с на каждый`);

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ['--disable-gpu', '--hide-scrollbars', '--no-first-run'],
});

async function capture(job) {
  const file = path.join(shotsDir, `${job.name}.png`);
  const startedAt = Date.now();
  const page = await browser.newPage();

  try {
    await page.setUserAgent(UA);
    await page.setViewport({
      width: config.shots.viewport.width,
      height: config.shots.viewport.height,
      deviceScaleFactor: config.shots.viewport.scale,
    });

    const response = await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_MS });
    const code = response?.status() ?? 0;

    /**
     * Одна пауза на всех — и всё. Прокрутка-разогрев и отключение анимаций
     * проверялись и делают хуже: часть сайтов подменяет картинки на пустые
     * прямоугольники, часть оставляет блоки невидимыми. Не возвращать.
     */
    await new Promise((resolve) => setTimeout(resolve, config.shots.waitMs));

    const images = await page
      .evaluate(() => {
        const all = [...document.images];
        return { total: all.length, ready: all.filter((i) => i.complete && i.naturalWidth > 0).length };
      })
      .catch(() => ({ total: 0, ready: 0 }));

    let element = null;
    if (job.area) {
      element = await page.$(job.area);
      if (!element) note(`${job.name}: блок «${job.area}» не найден, снимаю первый экран`);
    }

    if (element) {
      await element.scrollIntoView().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 600));
      await element.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: !!job.fullPage });
    }
    await page.close();

    const size = statSync(file).size;
    done(
      `${job.name.padEnd(14)} ${code}  ${(size / 1024).toFixed(0)}КБ  ` +
        `картинок ${images.ready}/${images.total}  ${seconds(Date.now() - startedAt)}`,
    );
    return { name: job.name, status: 'ок', url: job.url, images, at: new Date().toISOString() };
  } catch (error) {
    await page.close().catch(() => {});
    const reason = error.message.split('\n')[0];
    problem(`${job.name.padEnd(14)} ${reason} (${seconds(Date.now() - startedAt)})`);
    return { name: job.name, status: 'ошибка', url: job.url, reason };
  }
}

const queue = [...jobs];
const results = [];
await Promise.all(
  Array.from({ length: Math.min(config.shots.parallel, queue.length) }, async () => {
    while (queue.length) {
      const job = queue.shift();
      results.push(
        await race(capture(job), CEILING_MS).catch(() => ({
          name: job.name,
          status: 'ошибка',
          url: job.url,
          reason: 'не уложился в минуту',
        })),
      );
    }
  }),
);

await browser.close();

// Отчёт сливается, а не переписывается: пересъёмка одного источника не должна
// стирать данные по остальным.
const reportFile = path.join(dir, 'work', 'shots-report.json');
let previous = [];
if (existsSync(reportFile)) previous = readJSON(reportFile).results ?? [];
const merged = [...previous.filter((old) => !results.some((now) => now.name === old.name)), ...results];
writeJSON(reportFile, { at: new Date().toISOString(), results: merged });

meta.shots = [
  ...new Set([
    ...(meta.shots ?? []),
    ...results.filter((r) => r.status === 'ок').map((r) => `${meta.id}/shots/${r.name}.png`),
  ]),
];
writeJSON(path.join(dir, 'meta.json'), meta);

const failed = results.filter((r) => r.status !== 'ок');
say(`\n  Готово за ${seconds()} — снято ${results.length - failed.length} из ${results.length}`);
for (const item of failed) say(`  не вышло: ${item.name} — ${item.url} (${item.reason})`);

if (failed.length) {
  say('\n  Карусели и зацикленные анимации — лотерея: повторите точечно');
  say(`  node scripts/shots.mjs --project ${meta.id} --capture --only <имя>`);
}
say('');

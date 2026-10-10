#!/usr/bin/env node
/**
 * РАЗВЕДКА СТРАНИЦЫ. Печатает крупные блоки: селектор, размер, отступ сверху,
 * начало текста. Нужен, чтобы найти, какой блок снимать, не копаясь в исходниках.
 *
 *     node scripts/probe.mjs https://github.com/some-org
 *
 * Найденный селектор кладётся в поле `area` списка съёмки — тогда снимется
 * ровно нужный блок, а не первый экран.
 */
import { existsSync } from 'node:fs';
import { args, isMac, isWindows, readConfig, say, stop } from './lib/util.mjs';

const options = args();
const url = options._[0];
if (!url) stop('Укажите адрес: node scripts/probe.mjs https://example.com');

const config = readConfig();
if (!config.shots.web) {
  stop('Съёмка сайтов выключена в настройке (shots.web). Разведка — часть той же функции.');
}

function findChrome() {
  if (config.shots.chromePath) return config.shots.chromePath;
  const candidates = isMac
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : isWindows
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium'];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const chrome = findChrome();
if (!chrome) stop('Не нашёл Google Chrome. Установите его или укажите путь в настройке.');

const puppeteer = (await import('puppeteer-core')).default;
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage();

await page.setViewport({ width: 1440, height: 900 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise((resolve) => setTimeout(resolve, 8000));

const blocks = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll('section, div[id], main > div, article')];
  return nodes
    .map((node) => {
      const box = node.getBoundingClientRect();
      const id = node.id ? `#${node.id}` : '';
      const cls = node.className && typeof node.className === 'string'
        ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
      return {
        selector: id || `${node.tagName.toLowerCase()}${cls}`,
        width: Math.round(box.width),
        height: Math.round(box.height),
        top: Math.round(box.top + window.scrollY),
        text: (node.innerText ?? '').trim().slice(0, 60).replace(/\s+/g, ' '),
      };
    })
    .filter((b) => b.width > 500 && b.height > 200 && b.height < 2000 && b.text)
    .slice(0, 14);
});

await browser.close();

say(`\n  Крупные блоки страницы\n`);
for (const block of blocks) {
  say(`  ${block.selector}`);
  say(`     ${block.width}×${block.height}, сверху ${block.top}px — «${block.text}»`);
}
say('\n  Подходящий селектор впишите в поле area списка съёмки.\n');

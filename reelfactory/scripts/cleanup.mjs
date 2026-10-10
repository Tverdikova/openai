#!/usr/bin/env node
/**
 * ЧИСТКА ДОРОЖКИ. Живая речь всегда с провисаниями: длинные паузы, «эээ»,
 * повторы, фальстарты. Всё это вырезается ДО того, как считаются тайминги.
 *
 *     node scripts/cleanup.mjs --project 2026-08-09-analitika
 *
 * Результат: чистая дорожка, список склеек и заново пересчитанные слова —
 * уже во времени чистой дорожки. Тайминги сцен считаются только по ней, иначе
 * видео разъедется с голосом.
 *
 * Если проект снят на камеру, те же склейки применяются к картинке. Стыки при
 * этом видны — это честная цена чистки; прячутся они на уровне сцен, графикой
 * поверх стыка.
 */
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  args, done, ensureDir, ffmpegProbeStderr, fmt, mediaDuration, note, p, readConfig,
  readJSON, run, say, step, stop, writeJSON,
} from './lib/util.mjs';
import { normalizeLoudness } from './lib/loudness.mjs';

const options = args();
if (!options.project) stop('Не указан проект: --project <идентификатор>');

const config = readConfig();

/**
 * Настройки берутся из конфига, но их можно переопределить на один прогон —
 * когда человек говорит «почисти построже» или «оставь дыхание».
 *   --min-silence 0.5   какая пауза считается затянутой
 *   --threshold -40     что считать тишиной, в децибелах
 *   --no-fillers        не трогать слова-паразиты
 */
const rules = {
  ...config.cleanup,
  minSilenceSec: options['min-silence'] !== undefined ? Number(options['min-silence']) : config.cleanup.minSilenceSec,
  silenceThresholdDb: options.threshold !== undefined ? Number(options.threshold) : config.cleanup.silenceThresholdDb,
  keepPadSec: options['keep-pad'] !== undefined ? Number(options['keep-pad']) : config.cleanup.keepPadSec,
  cutFillers: options['no-fillers'] ? false : config.cleanup.cutFillers,
};
const dir = p('projects', String(options.project));
const meta = readJSON(path.join(dir, 'meta.json'));
const workDir = path.join(dir, 'work');
// Материалы, которые видит рендер, живут в папке проекта; в public они
// переезжают только на время рендера.
const materialsDir = path.join(workDir, 'public');
ensureDir(materialsDir);

const media = p(meta.source.file ?? '');
if (!existsSync(media)) stop('Исходная дорожка не найдена.');
const isVideo = meta.source.kind === 'video';
const duration = mediaDuration(media);

const wordsFile = path.join(workDir, 'words.json');
if (!existsSync(wordsFile)) stop(`Сначала расшифровка: node scripts/transcribe.mjs --project ${meta.id}`);
const words = readJSON(wordsFile);

say(`\n  Чистка дорожки: ${meta.title}\n`);

// ── что вырезаем ────────────────────────────────────────
const cuts = [];
const normalize = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

step('Ищу лишнее');

// 1. Затянутые паузы
let silenceCount = 0;
if (rules.enabled) {
  const log = ffmpegProbeStderr([
    '-i', media,
    '-af', `silencedetect=noise=${rules.silenceThresholdDb}dB:d=${rules.minSilenceSec}`,
    '-f', 'null', '-',
  ]);
  let start = null;
  for (const line of log.split('\n')) {
    const begin = line.match(/silence_start:\s*(-?[\d.]+)/);
    const finish = line.match(/silence_end:\s*([\d.]+)/);
    if (begin) start = Math.max(0, parseFloat(begin[1]));
    if (finish && start !== null) {
      const end = parseFloat(finish[1]);
      // по краям склейки оставляем немного тишины: иначе речь звучит обрубленной
      const from = start + rules.keepPadSec;
      const to = end - rules.keepPadSec;
      if (to - from > 0.05) {
        cuts.push({ from, to, why: 'пауза' });
        silenceCount++;
      }
      start = null;
    }
  }
}
note(`затянутых пауз: ${silenceCount}`);

/**
 * ЗАПИНКА ИЛИ РЕЧЬ. Одного совпадения со словарём мало: «эм» внутри быстрой,
 * связной фразы — чаще всего ошибка распознавания, а не мычание. Настоящая
 * запинка стоит особняком: перед ней или после неё человек делает паузу.
 *
 * Поэтому режем только то, что отделено заметным зазором хотя бы с одной
 * стороны. Так вырезается «…и вот… эм… дальше», но не трогается слово,
 * вплотную вжатое в поток речи.
 */
const HESITATION_GAP = 0.12;
const isolated = (index) => {
  const before = index > 0 ? words[index].start - words[index - 1].end : Infinity;
  const after = index + 1 < words.length ? words[index + 1].start - words[index].end : Infinity;
  return before >= HESITATION_GAP || after >= HESITATION_GAP;
};

// 2. Слова-паразиты — по одному слову и парами вроде «как бы»
let fillerCount = 0;
if (rules.enabled && rules.cutFillers) {
  const single = new Set(rules.fillers.filter((f) => !f.includes(' ')).map(normalize));
  const pairs = new Set(rules.fillers.filter((f) => f.includes(' ')).map((f) => normalize(f)));

  for (let i = 0; i < words.length; i++) {
    const one = normalize(words[i].text);
    if (single.has(one) && isolated(i)) {
      cuts.push({ from: words[i].start, to: words[i].end, why: `паразит «${words[i].text}»` });
      fillerCount++;
      continue;
    }
    if (i + 1 < words.length && pairs.has(one + normalize(words[i + 1].text))) {
      cuts.push({ from: words[i].start, to: words[i + 1].end, why: 'паразит' });
      fillerCount++;
      i++;
    }
  }
}
note(`слов-паразитов: ${fillerCount}`);

/**
 * 3. Повторы и фальстарты: одно и то же слово дважды подряд — первое лишнее.
 *
 * Зазор нарочно маленький. Настоящий фальстарт звучит слитно, человек
 * спотыкается и тут же повторяет слово. А вот «да, да», «нет, нет», «очень,
 * очень» с ощутимой паузой — это приём речи, и вырезать его нельзя: пропадёт
 * нажим, ради которого человек это и сказал.
 */
const STUMBLE_GAP = 0.4;
let repeatCount = 0;
if (rules.enabled && rules.cutRepeats) {
  for (let i = 1; i < words.length; i++) {
    const previous = normalize(words[i - 1].text);
    if (previous.length >= 3 && previous === normalize(words[i].text) && words[i].start - words[i - 1].end < STUMBLE_GAP) {
      cuts.push({ from: words[i - 1].start, to: words[i].start, why: `повтор «${words[i].text}»` });
      repeatCount++;
    }
  }
}
note(`повторов: ${repeatCount}`);

// ── склейки ─────────────────────────────────────────────
step('Считаю склейки');

cuts.sort((a, b) => a.from - b.from);
const merged = [];
for (const cut of cuts) {
  const last = merged.at(-1);
  if (last && cut.from <= last.to + 0.01) last.to = Math.max(last.to, cut.to);
  else merged.push({ ...cut });
}

const keep = [];
let cursor = 0;
for (const cut of merged) {
  if (cut.from > cursor + 0.02) keep.push({ from: cursor, to: Math.min(cut.from, duration) });
  cursor = Math.max(cursor, cut.to);
}
if (cursor < duration - 0.02) keep.push({ from: cursor, to: duration });

if (!keep.length) stop('После чистки не осталось ни одного куска — проверьте настройки в блоке cleanup.');

const cleanDuration = keep.reduce((sum, k) => sum + (k.to - k.from), 0);
const saved = duration - cleanDuration;
done(`было ${fmt(duration)}, стало ${fmt(cleanDuration)} — короче на ${fmt(saved)}`);

/**
 * Чистка обязана убирать лишнее, а не переписывать речь. Если из дорожки ушла
 * пятая часть, дело обычно не в запинках: тихая запись, дальний микрофон, и
 * половина настоящих слов сочтена тишиной. Молчать об этом нельзя — человек
 * узнает о пропаже уже на готовом ролике.
 */
if (saved / duration > 0.2) {
  note(
    `вырезано ${Math.round((saved / duration) * 100)}% дорожки — это много. Послушайте чистую ` +
      `дорожку: если пропала речь, попросите почистить мягче — --min-silence 1.5 --threshold -50`,
  );
}

writeJSON(path.join(workDir, 'edl.json'), { source: meta.source.file, duration, cleanDuration, keep, cuts: merged });

// ── применяем ───────────────────────────────────────────
step('Собираю чистую дорожку');

const extension = isVideo ? '.mp4' : '.m4a';
const cleanName = `clean${extension}`;
const cleanFile = path.join(materialsDir, cleanName);

if (!rules.enabled || merged.length === 0) {
  copyFileSync(media, cleanFile);
  note('резать нечего — дорожка взята как есть');
} else {
  const parts = [];
  const labels = [];
  keep.forEach((k, i) => {
    if (isVideo) {
      parts.push(`[0:v]trim=start=${k.from.toFixed(3)}:end=${k.to.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
      labels.push(`[v${i}]`);
    }
    parts.push(`[0:a]atrim=start=${k.from.toFixed(3)}:end=${k.to.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
    labels.push(`[a${i}]`);
  });
  // concat отдаёт по одному выходу на дорожку: видео + звук или только звук
  const outputs = isVideo ? '[vout][aout]' : '[aout]';
  const filter =
    `${parts.join(';')};${labels.join('')}concat=n=${keep.length}:v=${isVideo ? 1 : 0}:a=1${outputs}`;

  const ffmpegArgs = ['-y', '-i', media, '-filter_complex', filter];
  if (isVideo) ffmpegArgs.push('-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p');
  else ffmpegArgs.push('-map', '[aout]');
  ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', cleanFile);

  run('ffmpeg', ffmpegArgs);
}
done(`work/public/${cleanName}`);

/**
 * ОБРАБОТКА ГОЛОСА. Телефон пишет не только речь: гул помещения, ровный шип
 * кондиционера, свистящие «с» и уровень, гуляющий вместе с рукой. Выравнивание
 * громкости этого не лечит — оно двигает всю дорожку разом вместе с шумом.
 *
 * Порядок внутри цепочки не случайный и повторяет работу звукорежиссёра:
 *
 *   1. подрез низа — гул помещения и удары воздуха в микрофон живут ниже голоса;
 *   2. снятие ровного шума — шип вентиляции и электроники;
 *   3. свистящие — их подрезает деэссер, иначе после компрессора они режут ухо;
 *   4. разборчивость — лёгкий подъём там, где живут согласные;
 *   5. компрессор — собирает уровень: близко к микрофону и далеко звучат ровно.
 *
 * И только после этого дорожка идёт на стандартную громкость: сначала чистый
 * голос, потом уровень, и лишь потом под него ляжет музыка.
 */
const VOICE_CHAIN = [
  'highpass=f=90',
  'afftdn=nf=-25',
  'deesser=i=0.35',
  'equalizer=f=3000:t=q:w=1.2:g=2.5',
  'acompressor=threshold=-18dB:ratio=3:attack=8:release=180:makeup=2',
].join(',');

if (rules.voicePolish !== false) {
  step('Чищу голос');
  const polished = path.join(workDir, `polished${extension}`);
  try {
    const polishArgs = ['-y', '-i', cleanFile, '-af', VOICE_CHAIN];
    // На видео картинка не трогается: перекодировать её ради звука незачем.
    if (isVideo) polishArgs.push('-map', '0:v', '-map', '0:a', '-c:v', 'copy');
    polishArgs.push('-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', polished);
    run('ffmpeg', polishArgs);
    copyFileSync(polished, cleanFile);
    rmSync(polished, { force: true });
    done('гул, шип и свистящие убраны, уровень собран');
  } catch (error) {
    // Обработка — улучшение, а не условие выпуска. Не вышло — говорим об этом и
    // идём дальше с исходной дорожкой, а не роняем весь конвейер.
    rmSync(polished, { force: true });
    note(`обработку голоса пропустил: ${error.message.split('\n')[0]}`);
  }
} else {
  note('обработка голоса выключена настройкой cleanup.voicePolish');
}

/**
 * ГОЛОС ПРИВОДИТСЯ К СТАНДАРТУ ЗДЕСЬ, А НЕ В КОНЦЕ. Порядок принципиален: сначала
 * голос выходит на нормальный уровень, и только потом под него подкладывается
 * музыка. Если поднимать громкость уже готового ролика, вместе с голосом
 * поднимется и музыка — их соотношение останется тем же, каким было при тихой
 * записи, и музыка так и будет спорить с речью.
 */
step('Привожу голос к стандартной громкости');
const voiceTarget = config.render?.loudness?.targetLufs ?? -13;
const voiceLevel = normalizeLoudness(cleanFile, { targetLufs: voiceTarget, truePeak: -1.5 });
if (voiceLevel.ok) {
  done(`было ${voiceLevel.before.toFixed(1)} LUFS, стало ${(voiceLevel.after ?? voiceTarget).toFixed(1)}`);
} else {
  note(`громкость голоса оставлена как есть: ${voiceLevel.reason}`);
}

// ── слова во времени чистой дорожки ─────────────────────
step('Пересчитываю слова под чистую дорожку');

/**
 * Перевод момента исходника во время чистой дорожки.
 *
 * Метки слов от распознавания слегка неточны и часто на несколько сотых заезжают
 * в соседнюю тишину. Поэтому момент, попавший в вырезанный кусок, не
 * отбрасывается, а прижимается к месту склейки — в чистой дорожке это ровно та
 * точка, где сходятся соседние куски. Иначе слова пропадали бы на ровном месте.
 */
function remap(time) {
  let passed = 0;
  for (const k of keep) {
    if (time < k.from) return passed;
    if (time <= k.to) return passed + (time - k.from);
    passed += k.to - k.from;
  }
  return passed;
}

/** Звучит ли этот момент в чистой дорожке, то есть не попал ли он в вырезанное. */
function survives(time) {
  return keep.some((k) => time >= k.from - 0.001 && time <= k.to + 0.001);
}

/**
 * Минимальная длина слова в субтитрах.
 *
 * Распознавание изредка отдаёт короткое слово нулевой длины: начало равно концу.
 * Раньше такое слово молча выбрасывалось, и оно пропадало из субтитров — «12
 * минут и ролик готов» превращалось в «минут и ролик готов». Но слово-то
 * звучало. Поэтому слово выбрасывается ТОЛЬКО тогда, когда оно целиком попало в
 * вырезанный кусок, а короткой метке просто даётся минимальная длительность.
 */
const MIN_WORD_SEC = 0.12;

const clean = [];
let dropped = 0;
let rescued = 0;
for (const word of words) {
  const start = remap(word.start);
  let end = remap(word.end);

  if (end <= start) {
    // Слово целиком в вырезанном куске — оно действительно не звучит.
    if (!survives(word.start) && !survives(word.end)) {
      dropped++;
      continue;
    }
    // Слово звучит, а метка схлопнулась. Даём ему минимальную длину, не залезая
    // на соседа: субтитр обязан совпадать со сказанным слово в слово.
    end = Math.min(start + MIN_WORD_SEC, cleanDuration);
    if (end <= start) {
      dropped++;
      continue;
    }
    rescued++;
  }

  clean.push({ text: word.text, start: Number(start.toFixed(3)), end: Number(end.toFixed(3)) });
}
if (dropped) note(`слов вырезано вместе с лишним: ${dropped}`);
if (rescued) note(`слов с нулевой меткой в расшифровке: ${rescued} — оставлены в субтитрах`);

writeJSON(path.join(workDir, 'words.clean.json'), clean);
done(`слов осталось: ${clean.length} из ${words.length}`);

// ── отдаём рендеру ──────────────────────────────────────
// Путь внутри ролика — как будто файл уже в public: туда он переедет на рендер.
meta.clean = {
  file: `${meta.id}/${cleanName}`,
  durationSeconds: mediaDuration(cleanFile),
  kind: isVideo ? 'video' : 'audio',
};
meta.stage = 'blocks';
writeJSON(path.join(dir, 'meta.json'), meta);

say(`\n  Дальше — разметка блоков:  node scripts/blocks.mjs --project ${meta.id}\n`);

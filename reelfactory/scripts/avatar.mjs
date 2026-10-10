#!/usr/bin/env node
/**
 * ИИ-АВАТАР. Говорящая голова по готовой озвучке — отдельным слоем поверх сцен.
 *
 *     node scripts/avatar.mjs --avatars               список ваших аватаров
 *     node scripts/avatar.mjs --project ID           сделать аватара под озвучку
 *
 * Аватар не заменяет графику и не отменяет правил: он ложится слоем, а сцены
 * продолжают иллюстрировать смысл. Куда именно его класть — угол, круг или во
 * весь кадр — решает настройка `avatar.placement`.
 *
 * Работа идёт по чистой дорожке: аватар говорит уже без запинок и пауз.
 *
 * Поддержан HeyGen. Другой сервис добавляется одним объектом в `providers` —
 * остальному конвейеру всё равно, кто нарисовал видео.
 */
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import {
  args, done, ensureDir, note, p, readConfig, readEnv, readJSON, say, step, stop, writeJSON,
} from './lib/util.mjs';

const options = args();
const env = readEnv();
const config = readConfig();

const key = env.AVATAR_API_KEY;
if (!key) {
  stop(
    'Аватар не подключён: в файле .env нет строки AVATAR_API_KEY.\n' +
      'Он не обязателен — без него ролик собирается как обычно.',
  );
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── сервисы ─────────────────────────────────────────────
const providers = {
  heygen: {
    title: 'HeyGen',

    async list() {
      const response = await fetch('https://api.heygen.com/v2/avatars', { headers: { 'X-Api-Key': key } });
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      const data = await response.json();
      return (data.data?.avatars ?? []).map((a) => ({ id: a.avatar_id, name: a.avatar_name }));
    },

    /** Звук нужно сначала передать сервису — локальный файл он не видит. */
    async upload(file) {
      const response = await fetch('https://upload.heygen.com/v1/asset', {
        method: 'POST',
        headers: { 'X-Api-Key': key, 'Content-Type': 'audio/mpeg' },
        body: readFileSync(file),
      });
      if (!response.ok) throw new Error(`загрузка звука: ${response.status} ${await response.text()}`);
      const data = await response.json();
      const id = data.data?.id ?? data.data?.asset_id;
      if (!id) throw new Error('сервис не вернул идентификатор загруженного звука');
      return id;
    },

    async create({ avatarId, audioAssetId, width, height }) {
      const response = await fetch('https://api.heygen.com/v2/video/generate', {
        method: 'POST',
        headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_inputs: [
            {
              character: { type: 'avatar', avatar_id: avatarId, avatar_style: 'normal' },
              voice: { type: 'audio', audio_asset_id: audioAssetId },
            },
          ],
          dimension: { width, height },
        }),
      });
      if (!response.ok) throw new Error(`создание видео: ${response.status} ${await response.text()}`);
      const data = await response.json();
      const id = data.data?.video_id;
      if (!id) throw new Error('сервис не вернул идентификатор задания');
      return id;
    },

    async status(jobId) {
      const response = await fetch(`https://api.heygen.com/v1/video_status.get?video_id=${jobId}`, {
        headers: { 'X-Api-Key': key },
      });
      if (!response.ok) throw new Error(`проверка готовности: ${response.status}`);
      const data = (await response.json()).data ?? {};
      return { state: data.status, url: data.video_url, error: data.error?.message };
    },
  },
};

const providerName = config.avatar.provider;
const provider = providers[providerName];
if (!provider) {
  stop(
    `Сервис аватара «${providerName}» не подключён.\n` +
      `Сейчас поддержан: ${Object.keys(providers).join(', ')}. Выберите его в настройке.`,
  );
}

// ── список аватаров ─────────────────────────────────────
if (options.avatars) {
  const list = await provider.list().catch((error) => stop(`${provider.title}: ${error.message}`));
  say(`\n  Ваши аватары в ${provider.title}\n`);
  for (const item of list) say(`  ${item.id}  ${item.name}`);
  say('\n  Нужный идентификатор пропишется в настройке.\n');
  process.exit(0);
}

// ── генерация под проект ────────────────────────────────
if (!options.project) stop('Не указан проект: --project <идентификатор>');

const dir = p('projects', String(options.project));
const meta = readJSON(path.join(dir, 'meta.json'));
if (!meta.clean) stop('Нет чистой дорожки — аватар делается по ней. Сначала чистка.');

const avatarId = options.avatar ? String(options.avatar) : config.avatar.avatarId;
if (!avatarId) stop('Не выбран аватар. Список: node scripts/avatar.mjs --avatars');

// Материалы ролика живут в папке проекта, в public они попадают только на рендер.
const materialsDir = path.join(dir, 'work', 'public');
const audioFile = path.join(materialsDir, path.posix.basename(meta.clean.file));
if (!existsSync(audioFile)) stop('Чистая дорожка не найдена — прогоните чистку заново.');

say(`\n  Аватар через ${provider.title}: ${meta.title}\n`);

try {
  step('Передаю озвучку сервису');
  const audioAssetId = await provider.upload(audioFile);
  done('озвучка загружена');

  step('Ставлю задание на генерацию');
  const jobId = await provider.create({
    avatarId,
    audioAssetId,
    width: config.format.width,
    height: config.format.height,
  });
  done(`задание ${jobId}`);

  step('Жду результат — обычно это несколько минут');
  let url = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    await wait(5000);
    const { state, url: ready, error } = await provider.status(jobId);
    if (state === 'completed' && ready) {
      url = ready;
      break;
    }
    if (state === 'failed') throw new Error(error ?? 'сервис сообщил об ошибке');
    if (attempt % 6 === 0 && attempt) note(`ещё жду, прошло ${(attempt * 5) / 60 | 0} мин`);
  }
  if (!url) throw new Error('сервис не ответил за десять минут');
  done('видео готово');

  step('Скачиваю');
  const target = path.join(materialsDir, 'avatar.mp4');
  ensureDir(path.dirname(target));
  const file = await fetch(url);
  await pipeline(Readable.fromWeb(file.body), createWriteStream(target));
  done(`projects/${meta.id}/work/public/avatar.mp4`);

  meta.avatar = { provider: providerName, avatarId, file: `${meta.id}/avatar.mp4` };
  writeJSON(path.join(dir, 'meta.json'), meta);

  say('\n  Добавьте слой в описание ролика: source.avatar — и он появится в кадре.\n');
} catch (error) {
  stop(`${provider.title}: ${error.message}`);
}

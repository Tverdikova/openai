/**
 * ГРОМКОСТЬ ГОТОВОГО РОЛИКА.
 *
 * Площадки давно выравнивают звук сами: ролик, который тише принятого уровня,
 * они не поднимают, а вот громкий — прижимают. Поэтому тихая запись остаётся
 * тихой и рядом с чужими роликами звучит слабо, даже если снято хорошо.
 *
 * Лечится это не «прибавить громкости»: простое усиление тащит вверх и шум, и
 * случайный щелчок, а на пике даёт перегруз. Здесь замеряется настоящая
 * громкость по стандарту EBU R128 и приводится к целевой — тем же способом,
 * которым это делают на телевидении и площадках.
 *
 * Два прохода, и это важно: первый только слушает и считает, второй правит,
 * зная точные числа. Один проход правит вслепую и промахивается.
 */
import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';

/** Есть ли в файле звук вообще. Ролик без звука выравнивать нечего. */
function hasAudio(file) {
  try {
    const out = execFileSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file],
      { encoding: 'utf8' },
    );
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/** ffmpeg печатает разбор в stderr и возвращает ненулевой код — здесь это норма. */
function ffmpegStderr(args) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return result.stderr ?? '';
}

/** Разбор JSON, который loudnorm печатает последним блоком в stderr. */
function parseMeasurement(stderr) {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(stderr.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Привести громкость файла к целевой. Файл переписывается на месте.
 *
 * Возвращает `{ ok, before, after, reason }` — по этим числам видно, что
 * изменилось, и есть что показать человеку.
 */
export function normalizeLoudness(file, { targetLufs = -14, truePeak = -1, lra = 11 } = {}) {
  if (!existsSync(file)) return { ok: false, reason: 'файла нет' };
  if (!hasAudio(file)) return { ok: false, reason: 'в ролике нет звука' };

  const filter = `I=${targetLufs}:TP=${truePeak}:LRA=${lra}`;

  // Проход первый: только замер.
  const measured = parseMeasurement(
    ffmpegStderr(['-hide_banner', '-nostats', '-i', file, '-af', `loudnorm=${filter}:print_format=json`, '-f', 'null', '-']),
  );
  if (!measured) return { ok: false, reason: 'не удалось замерить громкость' };

  const before = Number(measured.input_i);
  if (!Number.isFinite(before)) return { ok: false, reason: 'замер не дал результата' };

  // Тишина: в дорожке нечего поднимать, а формально «поднять» её значит вытащить
  // наверх один шум. Такой ролик честнее оставить как есть и сказать об этом.
  if (before < -60) return { ok: false, before, reason: 'дорожка почти пустая' };

  // Временный файл берёт расширение исходного: по нему ffmpeg выбирает формат,
  // и звуковая дорожка не должна вдруг оказаться завёрнутой в видеоконтейнер.
  const dot = file.lastIndexOf('.');
  const temp = dot === -1 ? `${file}.norm` : `${file.slice(0, dot)}.norm${file.slice(dot)}`;

  // Кодек по контейнеру: mp3 не примет aac, а перекладывать музыку в mp4 ради
  // выравнивания громкости незачем — файл должен остаться таким же, как был.
  const extension = file.slice(dot + 1).toLowerCase();
  const isMp3 = extension === 'mp3';

  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-nostats', '-y',
      '-i', file,
      // Картинку не трогаем: перекодирование ради звука ухудшило бы её впустую.
      '-c:v', 'copy',
      '-af',
      `loudnorm=${filter}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:` +
        `measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:` +
        `offset=${measured.target_offset}:linear=true`,
      '-c:a', isMp3 ? 'libmp3lame' : 'aac', '-b:a', '192k',
      ...(isMp3 ? [] : ['-movflags', '+faststart']),
      temp,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  if (result.status !== 0 || !existsSync(temp)) {
    if (existsSync(temp)) unlinkSync(temp);
    return { ok: false, before, reason: 'не удалось перезаписать звук' };
  }

  renameSync(temp, file);

  const after = Number(parseMeasurement(
    ffmpegStderr(['-hide_banner', '-nostats', '-i', file, '-af', `loudnorm=${filter}:print_format=json`, '-f', 'null', '-']),
  )?.input_i);

  return { ok: true, before, after: Number.isFinite(after) ? after : undefined };
}

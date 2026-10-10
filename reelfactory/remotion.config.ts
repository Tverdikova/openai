import { Config } from '@remotion/cli/config';
import project from './config/project.json';

/**
 * Настройки рендера. Значения берутся из config/project.json (его пишет мастер
 * первого запуска), а не хардкодятся здесь.
 */
Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');
Config.setCrf(project.render.crf);
Config.setConcurrency(project.render.concurrency);
Config.setChromiumOpenGlRenderer('angle');
Config.setEntryPoint('core/entry.ts');

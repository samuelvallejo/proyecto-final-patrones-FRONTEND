import spanish from '../public/locales/es.json';
export type TranslationKey = keyof typeof spanish;
/** Only trusted resource templates may contain HTML; escape all server/user values. */
export function t(key: TranslationKey): string { return spanish[key]; }

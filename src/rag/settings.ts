import type { db } from '../db/index.js';
import { ragSettingsTable } from '../db/schema.js';
import { settings } from '../config/settings.js';

export const ragSettingLimits = {
  searchLimit: { min: 1, max: 50 },
  searchThreshold: { min: 0, max: 1 },
  maxResponseTokens: { min: 1, max: 32000 },
};
export interface RagSettings {
  searchLimit: number;
  searchThreshold: number;
  maxResponseTokens: number;
}
export function getRagSettings(database: typeof db): RagSettings {
  const saved = database.select().from(ragSettingsTable).get();
  return {
    searchLimit: saved?.searchLimit ?? settings.searchLimit,
    searchThreshold: saved?.searchThreshold ?? settings.searchThreshold,
    maxResponseTokens: saved?.maxResponseTokens ?? settings.maxResponseTokens,
  };
}
export function saveRagSettings(database: typeof db, input: unknown): RagSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Configuração inválida.'), { status: 400 });
  const value = input as Record<string, unknown>;
  const keys = Object.keys(ragSettingLimits) as Array<keyof RagSettings>;
  if (Object.keys(value).length !== keys.length || keys.some(key => {
    const number = value[key];
    return typeof number !== 'number' || !Number.isFinite(number) ||
      number < ragSettingLimits[key].min || number > ragSettingLimits[key].max ||
      (key !== 'searchThreshold' && !Number.isInteger(number));
  })) throw Object.assign(new Error('Informe trechos de 1 a 50, relevância de 0 a 1 e tokens de 1 a 32000.'), { status: 400 });
  const config = { searchLimit: value.searchLimit as number, searchThreshold: value.searchThreshold as number,
    maxResponseTokens: value.maxResponseTokens as number };
  database.insert(ragSettingsTable).values({ id: 1, ...config })
    .onConflictDoUpdate({ target: ragSettingsTable.id, set: config }).run();
  return config;
}

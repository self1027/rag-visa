import type { db } from '../db/index.js';
import { embeddingSelectionTable } from '../db/schema.js';
import { baseSettings, type EmbeddingConfig } from './settings.js';

export interface EmbeddingProfile extends EmbeddingConfig { id: string; label: string }
const fields = ['embeddingModel', 'embeddingProvider', 'embeddingUrl', 'embeddingRevision', 'embeddingQueryPrefix',
  'embeddingDocumentPrefix', 'embeddingDimensions', 'embeddingContextTokens', 'collection', 'chunkMaxLength', 'chunkOverlap'] as const;

export function getEmbeddingProfiles(): EmbeddingProfile[] {
  const defaults = Object.fromEntries(fields.map(key => [key, baseSettings[key]])) as EmbeddingConfig;
  const additional: unknown = JSON.parse(process.env.EMBEDDING_PROFILES || '[]');
  if (!Array.isArray(additional)) throw new Error('EMBEDDING_PROFILES deve ser uma lista.');
  const profiles: EmbeddingProfile[] = [{ ...defaults, id: 'default', label: process.env.EMBEDDING_LABEL || defaults.embeddingModel }];
  for (const value of additional) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Perfil de embeddings inválido.');
    const profile = value as EmbeddingProfile;
    if (Object.keys(value).some(key => ![...fields, 'id', 'label'].includes(key as typeof fields[number])) ||
      typeof profile.id !== 'string' || !/^[a-z0-9_-]{1,50}$/.test(profile.id) ||
      typeof profile.label !== 'string' || !profile.label.trim() || profile.label.length > 120 ||
      fields.some(key => key === 'embeddingDimensions' || key === 'embeddingContextTokens' || key === 'chunkMaxLength' || key === 'chunkOverlap'
        ? !Number.isSafeInteger(profile[key]) || profile[key] < (key === 'chunkOverlap' ? 0 : 1) : typeof profile[key] !== 'string') ||
      profile.chunkMaxLength < 16 || profile.chunkOverlap >= profile.chunkMaxLength - 4 ||
      !profile.embeddingModel || !profile.collection || !['ollama', 'sentence-transformers'].includes(profile.embeddingProvider) ||
      !/^https?:$/.test(new URL(profile.embeddingUrl).protocol) ||
      profiles.some(other => other.id === profile.id || other.collection === profile.collection)) {
      throw new Error('Perfil de embeddings inválido; IDs e coleções devem ser exclusivos.');
    }
    profiles.push({ ...profile });
  }
  return profiles;
}

export function getSelectedEmbedder(database: typeof db): EmbeddingProfile {
  const id = database.get<{ profile_id: string }>('SELECT profile_id FROM embedding_selection WHERE id = 1')?.profile_id || 'default';
  const profile = getEmbeddingProfiles().find(profile => profile.id === id);
  if (!profile) throw new Error('O embedder salvo não está mais configurado no servidor.');
  return profile;
}

export function saveSelectedEmbedder(database: typeof db, id: string) {
  database.insert(embeddingSelectionTable).values({ id: 1, profileId: id })
    .onConflictDoUpdate({ target: embeddingSelectionTable.id, set: { profileId: id } }).run();
}

export function publicEmbedders(database: typeof db) {
  return { selectedId: getSelectedEmbedder(database).id, profiles: getEmbeddingProfiles().map(profile => ({
    id: profile.id, label: profile.label, model: profile.embeddingModel, provider: profile.embeddingProvider,
    dimensions: profile.embeddingDimensions, contextTokens: profile.embeddingContextTokens,
  })) };
}

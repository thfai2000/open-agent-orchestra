import { and, eq } from 'drizzle-orm';
import { createLogger } from '@oao/shared';
import { db } from '../database/index.js';
import { models } from '../database/schema.js';

const logger = createLogger('github-catalog');

const DEFAULT_CATALOG_URL = 'https://models.github.ai/catalog/models';

/**
 * GitHub Models Catalog API entry. The exact shape is documented at
 * https://docs.github.com/en/rest/models/catalog and is also accessible at
 * https://models.github.ai/catalog/models. Only fields we actually persist are
 * declared here; the rest are forwarded as `metadata` if the caller wants them.
 */
export interface GithubCatalogModelEntry {
  id?: string; // e.g. "openai/gpt-4o-mini"
  name?: string; // human-friendly name, e.g. "GPT-4o mini"
  publisher?: string; // e.g. "OpenAI"
  registry?: string;
  summary?: string;
  tags?: string[];
  supported_input_modalities?: string[];
  supported_output_modalities?: string[];
  capabilities?: string[];
  /**
   * Catalog rate-limit tier. As of 2026-04 the live response uses
   * "low" or "high" — this is the closest signal to "premium" the catalog
   * exposes (no explicit credit/billing field).
   */
  rate_limit_tier?: string;
  /** Catalog-side max input/output token limits. */
  limits?: { max_input_tokens?: number; max_output_tokens?: number };
  /** Catalog version identifier (e.g. "2025-04-14"). */
  version?: string;
  /** Marketplace URL. */
  html_url?: string;
  /**
   * Some catalog endpoints surface a `reasoning_efforts` (or similar) array per
   * model. We accept it under any of these names defensively because the upstream
   * spec is still moving.
   */
  reasoning_efforts?: string[];
  reasoningEfforts?: string[];
  supported_reasoning_efforts?: string[];
}

export interface CatalogSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: Array<{ id?: string; error: string }>;
}

const DEFAULT_REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

function inferModelName(entry: GithubCatalogModelEntry): string | null {
  // The Copilot SDK accepts the short slug after the publisher prefix
  // (e.g. "gpt-4o-mini" rather than "openai/gpt-4o-mini"). Some entries
  // already expose only the slug in `id`. Strip a single leading
  // "publisher/" segment if present.
  const raw = (entry.id ?? entry.name ?? '').trim();
  if (!raw) return null;
  const slashIdx = raw.indexOf('/');
  return slashIdx >= 0 ? raw.slice(slashIdx + 1) : raw;
}

function normaliseReasoningEfforts(entry: GithubCatalogModelEntry): string[] {
  const candidates =
    entry.supported_reasoning_efforts
    ?? entry.reasoning_efforts
    ?? entry.reasoningEfforts
    ?? null;

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return [...DEFAULT_REASONING_EFFORTS];
  }

  const allowed = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
  const filtered = candidates
    .map((value) => String(value).toLowerCase().trim())
    .filter((value) => allowed.has(value));

  return filtered.length > 0 ? Array.from(new Set(filtered)) : [...DEFAULT_REASONING_EFFORTS];
}

export async function fetchGithubCatalog(params: {
  url?: string | null;
  githubToken: string;
}): Promise<GithubCatalogModelEntry[]> {
  const url = (params.url && params.url.trim()) || DEFAULT_CATALOG_URL;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${params.githubToken}`,
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'oao-platform/github-catalog-sync',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `GitHub Models catalog fetch failed (${response.status} ${response.statusText}) at ${url}: ${text.slice(0, 500)}`,
    );
  }

  const payload = (await response.json()) as unknown;
  // Accept both an array response and `{ models: [...] }` shapes.
  if (Array.isArray(payload)) {
    return payload as GithubCatalogModelEntry[];
  }

  if (payload && typeof payload === 'object' && Array.isArray((payload as { models?: unknown }).models)) {
    return (payload as { models: GithubCatalogModelEntry[] }).models;
  }

  throw new Error('GitHub Models catalog response did not contain an array of models.');
}

/**
 * Upserts catalog entries into the user's `models` table. Catalog rows are
 * marked `catalogSource = 'github_catalog'`; subsequent syncs update the
 * descriptive metadata but never overwrite admin-controlled fields like
 * `creditCost` or `isActive` once the row exists.
 *
 * NOTE on premium/credit info: as of 2026-04, the GitHub Models catalog
 * `/catalog/models` endpoint does NOT expose any premium/credit/billing field.
 * The closest signal is `rate_limit_tier` ("low" / "high"), which is mirrored
 * onto the local `models.rateLimitTier` column for UI surfacing.
 */
export async function syncGithubCatalogIntoUser(params: {
  userId: string;
  githubToken: string;
  url?: string | null;
}): Promise<CatalogSyncResult> {
  const entries = await fetchGithubCatalog({ url: params.url, githubToken: params.githubToken });
  const result: CatalogSyncResult = {
    fetched: entries.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const now = new Date();
  for (const entry of entries) {
    const modelName = inferModelName(entry);
    if (!modelName) {
      result.skipped += 1;
      continue;
    }

    try {
      const existing = await db.query.models.findFirst({
        where: and(eq(models.userId, params.userId), eq(models.name, modelName)),
      });

      const supportedReasoningEfforts = normaliseReasoningEfforts(entry);
      const displayName = entry.name?.trim() || modelName;
      const publisher = entry.publisher?.trim() || null;
      const summary = entry.summary?.trim() || null;
      const catalogModelId = entry.id?.trim() || modelName;
      const rateLimitTier = entry.rate_limit_tier?.trim() || null;
      const tags = Array.isArray(entry.tags) ? entry.tags.filter((t): t is string => typeof t === 'string') : null;
      const capabilities = Array.isArray(entry.capabilities)
        ? entry.capabilities.filter((c): c is string => typeof c === 'string')
        : null;
      const htmlUrl = entry.html_url?.trim() || null;
      const modelVersion = entry.version?.trim() || null;

      if (existing) {
        await db
          .update(models)
          .set({
            // Catalog-managed metadata is overwritten on every sync.
            catalogSource: 'github_catalog',
            catalogModelId,
            displayName,
            publisher,
            summary,
            rateLimitTier,
            tags,
            capabilities,
            htmlUrl,
            modelVersion,
            supportedReasoningEfforts,
            lastSyncedAt: now,
            // Force this row to be GitHub-provider; do not touch creditCost / isActive.
            providerType: 'github',
            provider: 'github',
            customProviderType: null,
            customBaseUrl: null,
            customAuthType: 'none',
            customWireApi: null,
            customAzureApiVersion: null,
            updatedAt: now,
          })
          .where(eq(models.id, existing.id));
        result.updated += 1;
      } else {
        await db.insert(models).values({
          userId: params.userId,
          name: modelName,
          provider: 'github',
          providerType: 'github',
          customAuthType: 'none',
          description: summary,
          creditCost: '1.00',
          // New catalog rows are inserted DISABLED so users explicitly opt in.
          isActive: false,
          catalogSource: 'github_catalog',
          catalogModelId,
          displayName,
          publisher,
          summary,
          rateLimitTier,
          tags,
          capabilities,
          htmlUrl,
          modelVersion,
          supportedReasoningEfforts,
          lastSyncedAt: now,
        });
        result.inserted += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ userId: params.userId, modelName, error: message }, 'Catalog upsert failed');
      result.errors.push({ id: entry.id, error: message });
    }
  }

  logger.info(
    {
      userId: params.userId,
      fetched: result.fetched,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
    },
    'GitHub Models catalog sync complete',
  );

  return result;
}

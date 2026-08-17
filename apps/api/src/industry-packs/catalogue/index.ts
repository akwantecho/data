import { healthcarePack } from './healthcare';
import { hospitalityPack } from './hospitality';
import { packDefinitionSchema, type PackDefinition } from './pack-definition';
import { realEstatePack } from './real-estate';

/**
 * The packs this build ships (plan §17).
 *
 * The catalogue is the *source*; the database is where packs are installed from.
 * Syncing writes these definitions into `industry_packs` and its child tables, and
 * the installer then reads only from the database — so a pack inserted by hand,
 * or shipped later by an administrator, installs exactly the same way.
 */
export const PACK_CATALOGUE: PackDefinition[] = [healthcarePack, hospitalityPack, realEstatePack];

/**
 * Parses every shipped pack, throwing on the first invalid one.
 *
 * Called by the sync path rather than at import time so a malformed pack surfaces
 * as a reported error, not as a module that refuses to load.
 */
export function validatedCatalogue(packs: PackDefinition[] = PACK_CATALOGUE): PackDefinition[] {
  return packs.map((pack) => {
    const parsed = packDefinitionSchema.safeParse(pack);

    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'pack'}: ${issue.message}`)
        .join('; ');

      throw new Error(`Industry pack "${pack.code}" is invalid — ${detail}`);
    }

    return parsed.data;
  });
}

export { healthcarePack, hospitalityPack, realEstatePack };
export type { PackDefinition };

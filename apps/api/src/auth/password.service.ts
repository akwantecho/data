import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id password hashing (ADR-0006).
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet baseline
 * (19 MiB memory, 2 iterations, parallelism 1). The salt is generated per hash
 * and embedded in the encoded output, so no separate salt column is needed.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hash(plainText: string): Promise<string> {
    return hash(plainText, ARGON2_OPTIONS);
  }

  /**
   * Verifies a password. A malformed or missing stored hash returns false rather
   * than throwing, so a corrupt row cannot turn into a 500 that distinguishes
   * accounts from one another.
   */
  async verify(passwordHash: string, plainText: string): Promise<boolean> {
    try {
      return await verify(passwordHash, plainText, ARGON2_OPTIONS);
    } catch {
      return false;
    }
  }
}

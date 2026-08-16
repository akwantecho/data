import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces an argon2id hash that is not the password', async () => {
    const hash = await service.hash('Password123!');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain('Password123!');
  });

  it('salts each hash, so identical passwords differ', async () => {
    const [first, second] = await Promise.all([
      service.hash('Password123!'),
      service.hash('Password123!'),
    ]);

    expect(first).not.toBe(second);
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    const hash = await service.hash('Password123!');

    await expect(service.verify(hash, 'Password123!')).resolves.toBe(true);
    await expect(service.verify(hash, 'password123!')).resolves.toBe(false);
  });

  it('returns false instead of throwing for a malformed stored hash', async () => {
    await expect(service.verify('not-a-hash', 'Password123!')).resolves.toBe(false);
  });
});

import { createBranchSchema, listBranchesSchema, updateBranchSchema } from './branches.dto';
import { createDepartmentSchema } from '../departments/departments.dto';

describe('branch validation', () => {
  it('accepts a well-formed branch', () => {
    const result = createBranchSchema.parse({
      name: '  Muscat Clinic  ',
      code: 'Muscat_01',
      countryCode: 'om',
      timezone: 'Asia/Muscat',
    });

    expect(result).toEqual({
      name: 'Muscat Clinic',
      code: 'muscat_01',
      countryCode: 'OM',
      timezone: 'Asia/Muscat',
    });
  });

  it('rejects a code with spaces or punctuation', () => {
    for (const code of ['has space', 'has.dot', '-leading', 'ünïcode']) {
      expect(createBranchSchema.safeParse({ name: 'Branch', code }).success).toBe(false);
    }
  });

  it('rejects an unknown timezone', () => {
    const result = createBranchSchema.safeParse({
      name: 'Branch',
      code: 'branch',
      timezone: 'Mars/Olympus',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a country code that is not two letters', () => {
    expect(
      createBranchSchema.safeParse({ name: 'Branch', code: 'branch', countryCode: 'OMN' }).success,
    ).toBe(false);
  });

  it('rejects an empty update', () => {
    expect(updateBranchSchema.safeParse({}).success).toBe(false);
  });

  it('strips unknown fields such as organizationId', () => {
    const result = createBranchSchema.parse({
      name: 'Branch',
      code: 'branch',
      organizationId: 'someone-else',
    });

    expect(result).not.toHaveProperty('organizationId');
  });

  it('defaults to hiding inactive branches', () => {
    expect(listBranchesSchema.parse({}).includeInactive).toBe(false);
    expect(listBranchesSchema.parse({ includeInactive: 'true' }).includeInactive).toBe(true);
  });
});

describe('department validation', () => {
  it('accepts a department without a branch', () => {
    const result = createDepartmentSchema.parse({ name: 'Finance', code: 'finance' });

    expect(result.branchId).toBeUndefined();
  });

  it('rejects a branch id that is not a uuid', () => {
    const result = createDepartmentSchema.safeParse({
      name: 'Finance',
      code: 'finance',
      branchId: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
  });
});

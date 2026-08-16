import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';
import { ApiException } from '../errors/api-exception';

const schema = z.object({
  name: z.string().min(1),
  currencyCode: z.string().length(3),
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed value for valid input', () => {
    expect(pipe.transform({ name: 'Alpha Medical Group', currencyCode: 'OMR' })).toEqual({
      name: 'Alpha Medical Group',
      currencyCode: 'OMR',
    });
  });

  it('strips unknown keys so clients cannot inject fields such as organizationId', () => {
    expect(
      pipe.transform({ name: 'Alpha', currencyCode: 'OMR', organizationId: 'other-org' }),
    ).toEqual({ name: 'Alpha', currencyCode: 'OMR' });
  });

  it('raises a VALIDATION_ERROR with per-field details', () => {
    expect.assertions(3);

    try {
      pipe.transform({ name: '', currencyCode: 'OMRX' });
    } catch (error) {
      const apiError = error as ApiException;
      expect(apiError).toBeInstanceOf(ApiException);
      expect(apiError.code).toBe('VALIDATION_ERROR');
      expect(apiError.details.map((detail) => detail.field)).toEqual(['name', 'currencyCode']);
    }
  });
});

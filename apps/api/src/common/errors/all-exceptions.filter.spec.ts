import { ArgumentsHost, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ApiException } from './api-exception';

function buildHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });

  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'GET', url: '/api/test' }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  it('passes through the platform error envelope', () => {
    const { host, status, json } = buildHost();

    filter.catch(
      ApiException.validation('Bad input', [{ field: 'name', message: 'required' }]),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      code: 'VALIDATION_ERROR',
      message: 'Bad input',
      details: [{ field: 'name', message: 'required' }],
    });
  });

  it('maps framework HTTP exceptions onto platform error codes', () => {
    const { host, status, json } = buildHost();

    filter.catch(new NotFoundException('Nothing here'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      code: 'NOT_FOUND',
      message: 'Nothing here',
      details: [],
    });
  });

  it('turns validation pipe message arrays into details', () => {
    const { host, json } = buildHost();

    filter.catch(
      new HttpException({ message: ['name must be a string'] }, HttpStatus.BAD_REQUEST),
      host,
    );

    expect(json).toHaveBeenCalledWith({
      code: 'VALIDATION_ERROR',
      message: 'The request could not be processed.',
      details: [{ message: 'name must be a string' }],
    });
  });

  it('never leaks internals for unexpected errors', () => {
    const { host, status, json } = buildHost();

    filter.catch(new Error('connect ECONNREFUSED 127.0.0.1:5432 (password=secret)'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'The request could not be processed.',
      details: [],
    });
    expect(JSON.stringify(json.mock.calls[0])).not.toContain('secret');
  });
});

import { describe, expect, test, jest } from '@jest/globals';
import { ValhallaRoutesProvider } from '../valhalla/ValhallaRoutesProvider';
import { Coordinates } from '@data/coordinates';

const SCHOOL: Coordinates = [-21.1910535, -48.7856113];
const NEAR_STUDENT: Coordinates = [-21.2484163, -48.8101064];
const FAR_STUDENT: Coordinates = [-20.40460921, -54.63691728]; // geocodificado em outro estado (~600 km)

const valhallaError = (errorCode: number) => Object.assign(new Error('Request failed with status code 400'), {
  response: { status: 400, data: { error_code: errorCode } },
});

const routeResponse = (lengthKm: number, timeSeconds: number) => ({
  data: { trip: { legs: [{ shape: '' }], summary: { length: lengthKm, time: timeSeconds } } },
});

describe('ValhallaRoutesProvider.computeDistanceMatrix', () => {
  test.each([154, 171, 442])('recupera célula a célula quando a matriz inteira falha com erro %i', async (errorCode) => {
    const provider = new ValhallaRoutesProvider('http://valhalla.test');
    const post = jest.fn(async (url: string, body: any) => {
      if (url === '/sources_to_targets') throw valhallaError(errorCode);

      const [origin] = body.locations;
      if (origin.lat === FAR_STUDENT[0]) throw valhallaError(442);
      return routeResponse(8.5, 587);
    });
    (provider as any).axios = { post };

    const result = await provider.computeDistanceMatrix([NEAR_STUDENT, FAR_STUDENT], [SCHOOL]);

    expect(result.success()).toBe(true);
    expect(result.value).toEqual([
      expect.objectContaining({ originIndex: 0, condition: 'ROUTE_EXISTS', distanceMeters: 8500, duration: '587s' }),
      expect.objectContaining({ originIndex: 1, condition: 'ROUTE_NOT_FOUND' }),
    ]);
  });

  test('falha a matriz inteira em erros que não são de um local específico', async () => {
    const provider = new ValhallaRoutesProvider('http://valhalla.test');
    (provider as any).axios = { post: jest.fn(async () => { throw valhallaError(100); }) };

    const result = await provider.computeDistanceMatrix([NEAR_STUDENT], [SCHOOL]);

    expect(result.fail()).toBe(true);
  });
});

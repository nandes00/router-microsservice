import axios from 'axios';
import { describe, expect, test, beforeEach, afterEach, jest } from '@jest/globals';
import { ValidateLatLongService } from '../validateLatLongService';

// Mock do Axios para não gastar API do Google
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const TOLERANCE = 100;
const COORDINATES: [string, string] = ['-23.55050000', '-46.63330000'];
const FULL_ADDRESS = 'RUA DAS FLORES, 123, CENTRO, SÃO PAULO, São Paulo';

const geocodeResponse = (data: Record<string, unknown>) => ({ data } as any);

const preciseResult = (lat: number, lng: number) => ({
  types: ['street_address'],
  geometry: { location: { lat, lng }, location_type: 'ROOFTOP' },
});

describe('ValidateLatLongService', () => {
  let service: ValidateLatLongService;

  beforeEach(() => {
    service = new ValidateLatLongService('TEST_KEY');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('INCOMPLETE_ADDRESS', () => {
    test.each([
      ['vazio', ''],
      ['com menos de 3 partes', 'RUA DAS FLORES, 123'],
      ['sem número', 'RUA DAS FLORES, CENTRO, SÃO PAULO'],
      ['S/N', 'RUA DAS FLORES, S/N, CENTRO, SÃO PAULO, 1'],
      ['SN', 'RUA DAS FLORES, SN, CENTRO 2, SÃO PAULO'],
    ])('endereço %s não chama o Google', async (_label, address) => {
      const result = await service.execute(COORDINATES, address, TOLERANCE);

      expect(result).toEqual({
        valid: false,
        reason: 'Endereço incompleto (tolerância: 100 m)',
        code: 'INCOMPLETE_ADDRESS',
      });
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });

  test('ZERO_RESULTS devolve NOT_FOUND', async () => {
    mockedAxios.get.mockResolvedValueOnce(geocodeResponse({ status: 'ZERO_RESULTS', results: [] }));

    const result = await service.execute(COORDINATES, FULL_ADDRESS, TOLERANCE);

    expect(result).toEqual({
      valid: false,
      reason: 'Endereço inválido ou não encontrado (tolerância: 100 m)',
      code: 'NOT_FOUND',
    });
  });

  test.each(['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'INVALID_REQUEST', 'UNKNOWN_ERROR'])(
    'status %s é problema de infraestrutura: INTERNAL_ERROR com o reason de hoje',
    async (status) => {
      mockedAxios.get.mockResolvedValueOnce(geocodeResponse({ status, results: [] }));

      const result = await service.execute(COORDINATES, FULL_ADDRESS, TOLERANCE);

      expect(result).toEqual({
        valid: false,
        reason: 'Endereço inválido ou não encontrado (tolerância: 100 m)',
        code: 'INTERNAL_ERROR',
      });
    },
  );

  test('resultado sem precisão devolve IMPRECISE', async () => {
    mockedAxios.get.mockResolvedValueOnce(geocodeResponse({
      status: 'OK',
      results: [{
        types: ['locality', 'political'],
        geometry: { location: { lat: -23.55, lng: -46.63 }, location_type: 'APPROXIMATE' },
      }],
    }));

    const result = await service.execute(COORDINATES, FULL_ADDRESS, TOLERANCE);

    expect(result).toEqual({
      valid: false,
      reason: 'Geocodificação imprecisa (tolerância: 100 m)',
      code: 'IMPRECISE',
    });
  });

  test('distância acima da tolerância devolve DISTANCE', async () => {
    mockedAxios.get.mockResolvedValueOnce(geocodeResponse({
      status: 'OK',
      results: [preciseResult(-23.5605, -46.6333)],
    }));

    const result = await service.execute(COORDINATES, FULL_ADDRESS, TOLERANCE);

    expect(result.valid).toBe(false);
    expect(result.code).toBe('DISTANCE');
    expect(result.distance).toBeGreaterThan(TOLERANCE);
    expect(result.reason).toBe(
      `Distância do endereço é maior que 100 m (distância: ${result.distance!.toFixed(2)} m, tolerância: 100 m)`,
    );
  });

  test('coordenada dentro da tolerância devolve VALID', async () => {
    mockedAxios.get.mockResolvedValueOnce(geocodeResponse({
      status: 'OK',
      results: [preciseResult(-23.5505, -46.6333)],
    }));

    const result = await service.execute(COORDINATES, FULL_ADDRESS, TOLERANCE);

    expect(result).toEqual({
      valid: true,
      reason: 'Coordenada válida (distância: 0.00 m, tolerância: 100 m)',
      distance: 0,
      code: 'VALID',
    });
  });

  test('exceção na chamada ao Google devolve INTERNAL_ERROR', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('network down'));

    const result = await service.execute(COORDINATES, FULL_ADDRESS, TOLERANCE);

    expect(result).toEqual({
      valid: false,
      reason: 'Erro interno na validação (tolerância: 100 m)',
      code: 'INTERNAL_ERROR',
    });
  });
});

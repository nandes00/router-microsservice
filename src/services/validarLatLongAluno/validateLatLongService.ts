import axios from 'axios';
import { GOOGLE_API_KEY } from '@env';

// Código técnico e estável do resultado. O Rails decide o motivo exibido a partir dele
export type ValidationCode = 'VALID' | 'INCOMPLETE_ADDRESS' | 'NOT_FOUND' | 'IMPRECISE' | 'DISTANCE' | 'INTERNAL_ERROR';

export interface ValidateResult {
  valid: boolean
  reason: string
  distance?: number // distância calculada em metros
  code: ValidationCode
}

export class ValidateLatLongService {
  constructor(private readonly apiKey: string | undefined = GOOGLE_API_KEY) {
    if (!apiKey) {
      throw new Error(
        '[ValidateLatLongService] GOOGLE_API_KEY is not defined. Google Geocoding cannot be used without a valid key.',
      );
    }
  }

  async execute(
    coordinates: [string, string],
    address: string,
    maxDistanceMeters: number,
  ): Promise<ValidateResult> {
    try {
      if (this.isPartialAddress(address)) {
        return { valid: false, reason: `Endereço incompleto (tolerância: ${maxDistanceMeters} m)`, code: 'INCOMPLETE_ADDRESS' };
      }

      const [lat, lng] = coordinates.map(parseFloat);
      const response = await this.requestWithRetry(address, 3);

      if (response.data.status !== 'OK') {
        return {
          valid: false,
          reason: `Endereço inválido ou não encontrado (tolerância: ${maxDistanceMeters} m)`,
          code: this.codeForGeocodeStatus(response.data.status),
        };
      }
      const preciseResult = this.pickPreciseResult(response.data.results);
      if (!preciseResult) {
        return { valid: false, reason: `Geocodificação imprecisa (tolerância: ${maxDistanceMeters} m)`, code: 'IMPRECISE' };
      }

      const resultLocation = preciseResult.geometry.location;

      const distance = this.getDistanceInMeters(lat, lng, resultLocation.lat, resultLocation.lng);

      if (distance > maxDistanceMeters) {
        return {
          valid: false,
          reason: `Distância do endereço é maior que ${maxDistanceMeters} m (distância: ${distance.toFixed(2)} m, tolerância: ${maxDistanceMeters} m)`,
          distance,
          code: 'DISTANCE',
        };
      }

      return { valid: true, reason: `Coordenada válida (distância: ${distance.toFixed(2)} m, tolerância: ${maxDistanceMeters} m)`, distance, code: 'VALID' };
    } catch (err: any) {
      return { valid: false, reason: `Erro interno na validação (tolerância: ${maxDistanceMeters} m)`, code: 'INTERNAL_ERROR' };
    }
  }

  private codeForGeocodeStatus(status: string): ValidationCode {
    return status === 'ZERO_RESULTS' ? 'NOT_FOUND' : 'INTERNAL_ERROR';
  }

  private async requestWithRetry(address: string, retries: number) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
          params: { address, key: this.apiKey },
        });
        return response;
      } catch (error: any) {
        const status = error?.response?.status;
        if (status && status >= 500 && attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Falha ao obter resposta do Google API após múltiplas tentativas');
  }

  private getDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.deg2rad(lat1)) *
      Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance;
  }

  private deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  private isPartialAddress(address: string): boolean {
    const addr = (address || '').trim();
    if (!addr) return true;

    const parts = addr.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length < 3) return true;

    const hasNumber = /\b\d+\b/.test(addr);
    const hasSN = /\bS\/?N\b/i.test(addr);
    if (!hasNumber || hasSN) return true;

    return false;
  }

  private pickPreciseResult(results: any[]): any | null {
    if (!Array.isArray(results)) return null;

    const isPrecise = (r: any) => {
      const types: string[] = r?.types || [];
      const locationType: string | undefined = r?.geometry?.location_type;

      const impreciseTypes = new Set([
        'locality', // cidade
        'administrative_area_level_1',
        'administrative_area_level_2',
        'administrative_area_level_3',
        'sublocality',
        'political',
        'plus_code',
        'country',
      ]);

      const typesImprecise = types.some(t => impreciseTypes.has(t));
      const preciseLocationType = locationType === 'ROOFTOP' || locationType === 'RANGE_INTERPOLATED';

      return !typesImprecise && preciseLocationType;
    };

    const precise = results.find(isPrecise);
    if (precise) return precise;

    const acceptableTypes = new Set(['street_address', 'premise', 'subpremise', 'route']);
    const acceptable = results.find((r: any) => (r?.types || []).some((t: string) => acceptableTypes.has(t)));
    return acceptable || null;
  }
}

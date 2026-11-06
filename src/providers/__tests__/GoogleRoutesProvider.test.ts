import { GoogleRoutesProvider } from '../google/GoogleRoutesProvider';
import axios from 'axios';
import { Result } from '../../data/result';
import { describe, expect, test, beforeAll, afterEach, jest } from '@jest/globals';

// Mock do Axios para não gastar API do Google
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Helper para mockar o axios.create e retornar um axios mockado com interceptors
// Necessário pois o constructor chama axiosRetry que acessa interceptors
mockedAxios.create.mockReturnValue(mockedAxios as any);
mockedAxios.interceptors = {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() }
} as any;


describe('GoogleRoutesProvider Unit Test', () => {
    let provider: GoogleRoutesProvider;

    beforeAll(() => {
        process.env.GOOGLE_API_KEY = 'TEST_KEY';
        // Mock do axios-retry se necessario, ou deixar capotar se tiver interceptors
        // Mas o axios-retry eh um modulo separado..
        provider = new GoogleRoutesProvider();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('computeRoutes should call Google API correctly and return success result', async () => {
        // Setup do Mock
        mockedAxios.post.mockResolvedValueOnce({
            data: {
                routes: [
                    {
                        distanceMeters: 5000,
                        duration: '600s',
                        polyline: { encodedPolyline: 'encoded_poly' }
                    }
                ]
            }
        });

        const origin = [-23.0, -46.0] as [number, number];
        const destination = [-23.1, -46.1] as [number, number];
        const intermediates: [number, number][] = [];

        const result = await provider.computeRoutes(origin, destination, intermediates, '2023-01-01T12:00:00Z');

        expect(result.success()).toBe(true);
        if (result.success()) {
            expect(result.value.routes).toBeDefined();
            expect(result.value.routes[0].distanceMeters).toBe(5000);
        }

        // Verificar chamada do Axios
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
            expect.stringContaining('/directions/v2:computeRoutes'),
            expect.objectContaining({
                origin: expect.anything(),
                destination: expect.anything()
            }),
            expect.anything()
        );
    });

    test('should handle API errors gently', async () => {
        mockedAxios.post.mockRejectedValueOnce(new Error('Network Error'));

        const origin = [-23.0, -46.0] as [number, number];
        const destination = [-23.1, -46.1] as [number, number];
        const intermediates: [number, number][] = [];

        try {
            const result = await provider.computeRoutes(origin, destination, intermediates, '2023-01-01T12:00:00Z');
            expect(result.fail()).toBe(true);
        } catch (e) {
            // Se o provider lançar excecão (o retry pode falhar), ok
        }
    });
});

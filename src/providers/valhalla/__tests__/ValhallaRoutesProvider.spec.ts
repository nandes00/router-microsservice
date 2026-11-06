import { ValhallaRoutesProvider } from '../ValhallaRoutesProvider';
import { Coordinates } from '../../../data/coordinates';
import axios from 'axios';
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ValhallaRoutesProvider', () => {
    let provider: ValhallaRoutesProvider;
    let mockAxiosInstance: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockAxiosInstance = {
            post: jest.fn(),
            create: jest.fn().mockReturnThis(),
            // axiosRetry (no construtor do provider) anexa interceptors ao cliente;
            // sem estes stubs, o setup falha com "Cannot read properties of undefined (reading 'request')".
            interceptors: {
                request: { use: jest.fn() },
                response: { use: jest.fn() },
            },
        };
        mockedAxios.create.mockReturnValue(mockAxiosInstance);

        provider = new ValhallaRoutesProvider('http://valhalla:8002');
    });

    describe('computeDistanceMatrix', () => {
        test('should correctly map origins and destinations to Valhalla format and return mapped result', async () => {
            const origins: Coordinates[] = [[-22.1, -54.1], [-22.2, -54.2]];
            const destinations: Coordinates[] = [[-22.3, -54.3]];

            const mockResponse = {
                data: {
                    sources_to_targets: [
                        [
                            { distance: 1.5, time: 120, to_index: 0, from_index: 0 }
                        ],
                        [
                            { distance: 2.5, time: 240, to_index: 0, from_index: 1 }
                        ]
                    ]
                }
            };

            mockAxiosInstance.post.mockResolvedValue(mockResponse);

            const result = await provider.computeDistanceMatrix(origins, destinations);

            expect(result.success()).toBe(true);
            const data = result.result as any[];
            expect(data).toHaveLength(2);

            // Check mapping
            expect(data[0]).toEqual({
                originIndex: 0,
                destinationIndex: 0,
                status: { message: 'OK' },
                condition: 'ROUTE_EXISTS',
                distanceMeters: 1500,
                duration: '120s'
            });

            expect(mockAxiosInstance.post).toHaveBeenCalledWith('/sources_to_targets', expect.objectContaining({
                sources: [{ lat: -22.1, lon: -54.1 }, { lat: -22.2, lon: -54.2 }],
                targets: [{ lat: -22.3, lon: -54.3 }],
            }));
        });

        test('should return ROUTE_NOT_FOUND when distance/time is null', async () => {
            const origins: Coordinates[] = [[-22.1, -54.1]];
            const destinations: Coordinates[] = [[-22.3, -54.3]];

            const mockResponse = {
                data: {
                    sources_to_targets: [
                        [
                            { distance: null, time: null, to_index: 0, from_index: 0 }
                        ]
                    ]
                }
            };

            const noRouteError: any = new Error('Bad Request');
            noRouteError.response = { status: 400, data: { error_code: 442 } };

            mockAxiosInstance.post.mockImplementation((url: string) =>
                url === '/sources_to_targets' ? Promise.resolve(mockResponse) : Promise.reject(noRouteError)
            );

            const result = await provider.computeDistanceMatrix(origins, destinations);

            expect(result.success()).toBe(true);
            const data = result.result as any[];
            expect(data[0].condition).toBe('ROUTE_NOT_FOUND');
            expect(data[0].distanceMeters).toBe(0);
        });

        test('should recover only null cells via /route and keep valid cells untouched', async () => {
            const origins: Coordinates[] = [[-22.1, -54.1], [-22.2, -54.2]];
            const destinations: Coordinates[] = [[-22.3, -54.3]];

            mockAxiosInstance.post.mockImplementation((url: string) => {
                if (url === '/sources_to_targets') {
                    return Promise.resolve({
                        data: {
                            sources_to_targets: [
                                [{ distance: null, time: null, to_index: 0, from_index: 0 }],
                                [{ distance: 2.5, time: 240, to_index: 0, from_index: 1 }],
                            ],
                        },
                    });
                }

                return Promise.resolve({
                    data: { trip: { summary: { length: 2.788, time: 312.66 }, legs: [{ shape: '' }] } },
                });
            });

            const result = await provider.computeDistanceMatrix(origins, destinations);

            expect(result.success()).toBe(true);
            const data = result.result as any[];
            expect(data[0]).toEqual(expect.objectContaining({ originIndex: 0, condition: 'ROUTE_EXISTS', distanceMeters: 2788, duration: '313s' }));
            expect(data[1]).toEqual(expect.objectContaining({ originIndex: 1, condition: 'ROUTE_EXISTS', distanceMeters: 2500, duration: '240s' }));

            const routeCalls = mockAxiosInstance.post.mock.calls.filter(([url]: [string]) => url === '/route');
            expect(routeCalls).toHaveLength(1);
            expect(routeCalls[0][1]).toEqual(expect.objectContaining({
                locations: [
                    { lat: -22.1, lon: -54.1, type: 'break' },
                    { lat: -22.3, lon: -54.3, type: 'break' },
                ],
                costing: 'auto',
            }));
        });

        test('should not call /route when every cell has a route', async () => {
            mockAxiosInstance.post.mockResolvedValue({
                data: { sources_to_targets: [[{ distance: 1.5, time: 120, to_index: 0, from_index: 0 }]] },
            });

            await provider.computeDistanceMatrix([[-22.1, -54.1]], [[-22.3, -54.3]]);

            expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
        });

        test('should recover cells when Valhalla rejects the whole matrix with error 442', async () => {
            const noPathError: any = new Error('Bad Request');
            noPathError.response = { status: 400, data: { error_code: 442 } };

            mockAxiosInstance.post.mockImplementation((url: string) =>
                url === '/sources_to_targets'
                    ? Promise.reject(noPathError)
                    : Promise.resolve({ data: { trip: { summary: { length: 1.2, time: 90 }, legs: [{ shape: '' }] } } })
            );

            const result = await provider.computeDistanceMatrix([[-22.1, -54.1]], [[-22.3, -54.3]]);

            expect(result.success()).toBe(true);
            expect(result.result).toEqual([
                { originIndex: 0, destinationIndex: 0, status: { message: 'OK' }, condition: 'ROUTE_EXISTS', distanceMeters: 1200, duration: '90s' },
            ]);
        });

        test('should fail when Valhalla matrix errors for another reason', async () => {
            const serverError: any = new Error('Internal Server Error');
            serverError.response = { status: 500, data: { error_code: 500 } };
            mockAxiosInstance.post.mockRejectedValue(serverError);

            const result = await provider.computeDistanceMatrix([[-22.1, -54.1]], [[-22.3, -54.3]]);

            expect(result.fail()).toBe(true);
        });
    });

    describe('validateRouteRestriction', () => {
        test('should return success(true) if origin and destination are identical', async () => {
            const coord: Coordinates = [-22.1, -54.1];
            const result = await provider.validateRouteRestriction(coord, coord, [], { type: 'bus' });

            expect(result.success()).toBe(true);
            expect(result.value).toBe(true);
            expect(mockAxiosInstance.post).not.toHaveBeenCalled();
        });

        test('should call Valhalla /route and return true for status 0', async () => {
            const origin: Coordinates = [-22.1, -54.1];
            const dest: Coordinates = [-22.2, -54.2];

            mockAxiosInstance.post.mockResolvedValue({
                data: { trip: { status: 0 } }
            });

            const result = await provider.validateRouteRestriction(origin, dest, [], { type: 'bus', height: 3.5 });

            expect(result.success()).toBe(true);
            expect(result.value).toBe(true);
            expect(mockAxiosInstance.post).toHaveBeenCalledWith('/route', expect.objectContaining({
                costing: 'bus'
            }));
        });

        test('should return success(false) if Valhalla returns 400', async () => {
            const origin: Coordinates = [-22.1, -54.1];
            const dest: Coordinates = [-22.2, -54.2];

            const error: any = new Error('Bad Request');
            error.response = { status: 400, data: { error: 'No route found' } };
            mockAxiosInstance.post.mockRejectedValue(error);

            const result = await provider.validateRouteRestriction(origin, dest, [], { type: 'bus' });

            expect(result.success()).toBe(true);
            expect(result.value).toBe(false);
        });
    });
});

import { CalculateDistanceService } from '../calculateDistancesService';
import { ValhallaRoutesProvider } from '../../providers/valhalla/ValhallaRoutesProvider';
import { success } from '../../data/result';
import { ISchoolLocation, IStudent, ICalculateRouteConfig } from '../calculateRoute/interfaces';
import { describe, expect, test, jest, beforeEach } from '@jest/globals';

jest.mock('../../providers/valhalla/ValhallaRoutesProvider');

describe('CalculateDistanceService with Valhalla', () => {
    let valhallaProviderMock: jest.Mocked<ValhallaRoutesProvider>;

    beforeEach(() => {
        valhallaProviderMock = new ValhallaRoutesProvider() as jest.Mocked<ValhallaRoutesProvider>;
        jest.clearAllMocks();
    });

    test('should validate students distances using Valhalla Provider correctly', async () => {
        const schoolLocation: ISchoolLocation = {
            id: 1,
            coordinates: [-22.1, -54.1]
        } as any;

        const students: IStudent[] = [
            { id: 101, coordinates: [-22.101, -54.101], schoolId: 1, reason: 'not_informed', usesWheelchair: false, specialNeed: false, arrivalTime: '07:00:00', departureTime: '12:00:00' },
            { id: 102, coordinates: [-22.2, -54.2], schoolId: 1, reason: 'not_informed', usesWheelchair: false, specialNeed: false, arrivalTime: '07:00:00', departureTime: '12:00:00' }
        ];

        const config: ICalculateRouteConfig = {
            maxDistance: 5000,
            maxDuration: 3600,
            minDistance: 0,
            averageStopDuration: 60,
            averageStopDurationWheelchair: 300,
        } as any;

        // Mock response from Valhalla
        valhallaProviderMock.computeDistanceMatrix.mockResolvedValue(success([
            {
                originIndex: 0,
                destinationIndex: 0,
                status: { message: 'OK' },
                condition: 'ROUTE_EXISTS' as any,
                distanceMeters: 500,
                duration: '60s'
            },
            {
                originIndex: 1,
                destinationIndex: 0,
                status: { message: 'OK' },
                condition: 'ROUTE_EXISTS' as any,
                distanceMeters: 10000, // too far
                duration: '600s'
            }
        ]));

        (valhallaProviderMock as any).COMPUTE_DISTANCE_MATRIX_MAX_ELEMENTS = 100;

        const service = new CalculateDistanceService(students, schoolLocation, config, valhallaProviderMock);
        const result = await service.execute();

        expect(result.success()).toBe(true);
        const { validAddresses, invalidAddresses } = result.value;

        expect(validAddresses).toHaveLength(1);
        expect(validAddresses[0].id).toBe(101);
        expect(validAddresses[0].distance).toBe(500);

        expect(invalidAddresses).toHaveLength(1);
        expect(invalidAddresses[0].id).toBe(102); // excluded by distance

        expect(valhallaProviderMock.computeDistanceMatrix).toHaveBeenCalled();
    });
});

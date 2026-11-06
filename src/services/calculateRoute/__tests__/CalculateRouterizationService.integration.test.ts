import { CalculateRouterizationService } from '../calculateRouterizationService';
import { ValhallaRoutesProvider } from '../../../providers/valhalla/ValhallaRoutesProvider';
import { GoogleRoutesProvider } from '../../../providers/google/GoogleRoutesProvider';
import { success } from '../../../data/result';
import { ISchool, IStopPoint, IVehicle, ICalculateRouteConfig, IStudentData, IExclusionZone } from '../interfaces';
import { describe, expect, test, beforeAll, jest } from '@jest/globals';
import { Coordinates } from '../../../data/coordinates';

// Mock do GoogleRoutesProvider INTEIRO
jest.mock('../../../providers/google/GoogleRoutesProvider');

describe('CalculateRouterizationService Integration "Bancada"', () => {

    let routingProviderMock: GoogleRoutesProvider;
    let validationProviderReal: ValhallaRoutesProvider;

    beforeAll(() => {
        // Instancia o Mock
        routingProviderMock = new GoogleRoutesProvider();
        // Instancia o Real
        process.env.VALHALLA_URL = 'http://localhost:8002';
        validationProviderReal = new ValhallaRoutesProvider();

        // Configurar o comportamento do Mock
        (routingProviderMock.computeRoutes as unknown as jest.Mock).mockReturnValue(
            Promise.resolve(success({
                routes: [
                    {
                        distanceMeters: 1000,
                        duration: '600s',
                        // Valid Polyline for (-23.55, -46.63) -> (-23.56, -46.65)
                        polyline: { encodedPolyline: 'zncoCj~}yG`@{@' },
                        legs: [{
                            distanceMeters: 1000,
                            duration: '600s',
                            polyline: { encodedPolyline: 'zncoCj~}yG`@{@' },
                            startLocation: { latLng: { latitude: -23.55, longitude: -46.63 } },
                            endLocation: { latLng: { latitude: -23.56, longitude: -46.65 } }
                        }]
                    }
                ]
            }))
        );

        (routingProviderMock.computeDistanceMatrix as unknown as jest.Mock).mockReturnValue(
            Promise.resolve(success([
                {
                    distanceMeters: 1000,
                    duration: '600s',
                    originIndex: 0,
                    destinationIndex: 0,
                    condition: 'ROUTE_EXISTS' as const,
                    status: {}
                }
            ]))
        );

        // Propriedade readonly necessária para o calculo de chunks
        Object.defineProperty(routingProviderMock, 'COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS', { value: 25 });
        Object.defineProperty(routingProviderMock, 'computeRoutes', { value: routingProviderMock.computeRoutes }); // Ensure mock is callable
    });

    test('should routerize successfully using Real Valhalla Validation', async () => {
        const schools: ISchool[] = [{
            id: 1,
            coordinates: [-23.550520, -46.633308] as Coordinates,
            students: [],
        }];

        const student1: IStudentData = {
            id: 101,
            schoolId: 1,
            coordinates: [-23.559616, -46.658632] as Coordinates,
            reason: 'not_informed',
            usesWheelchair: false,
            specialNeed: false,
            arrivalTime: '07:00:00',
            departureTime: '12:00:00',
            distance: 0,
            duration: 0
        };

        const stopPoints: IStopPoint[] = [{
            coordinates: [-23.559616, -46.658632] as Coordinates,
            students: [student1]
        }];

        const vehicles: IVehicle[] = [{
            id: 10,
            capacity: 20,
            wheelchairSectionCapacity: 0,
            max_capacity: false,
            kind: 'Micro-ônibus',
            height: 2.5, width: 2.2, length: 6.0, weight: 3.5, axis: 2, type: 'bus',
            vehicleTypeId: 1
        } as IVehicle];

        const config: ICalculateRouteConfig = {
            maxDistance: 50000,
            maxDuration: 3600,
            minDistance: 0,
            schoolMaxDistance: 5000,
            averageStopDuration: 60,
            averageStopDurationWheelchair: 300,
            stopPointMaxDistanceType: 'walk',
            stopPointMaxDistance: 1000,
            vehicles: vehicles,
            onlySchoolsWithStudent: false,
            activateGroupingOfSchoolsByArrivalTimes: false,
            maxToleranceBetweenArrivalTimes: 1800,
            activateGroupingOfSchoolsByDepartureTimes: false,
            maxToleranceBetweenDepartureTimes: 1800
        };

        const directions = ['forward'];

        const service = new CalculateRouterizationService(
            schools,
            stopPoints,
            vehicles,
            config,
            routingProviderMock,
            validationProviderReal,
            directions
        );

        const result = await service.execute();

        expect(result.success()).toBe(true);
        if (result.success()) {
            expect(result.value.lines.length).toBeGreaterThanOrEqual(1);
        }
    });

    test('should reject route that intersects exclusion zone', async () => {
        const schools = [{
            id: 1,
            coordinates: [-23.550520, -46.633308] as Coordinates,
            students: [],
        }];

        const student1 = {
            id: 101,
            schoolId: 1,
            coordinates: [-23.559616, -46.658632] as Coordinates,
            reason: 'not_informed',
            usesWheelchair: false,
            specialNeed: false,
            arrivalTime: '07:00:00',
            departureTime: '12:00:00',
            distance: 0,
            duration: 0
        } as IStudentData;

        const stopPoints = [{
            coordinates: [-23.559616, -46.658632] as Coordinates,
            students: [student1]
        }];

        const vehicles = [{
            id: 10,
            capacity: 20,
            wheelchairSectionCapacity: 0,
            max_capacity: false,
            kind: 'Micro-ônibus',
            height: 2.5, width: 2.2, length: 6.0, weight: 3.5, axis: 2, type: 'bus',
            vehicleTypeId: 1
        } as IVehicle, {
            id: 11,
            capacity: 30,
            wheelchairSectionCapacity: 0,
            max_capacity: false,
            kind: 'Ônibus',
            height: 2.5, width: 2.2, length: 6.0, weight: 3.5, axis: 2, type: 'bus',
            vehicleTypeId: 4
        } as IVehicle];

        const exclusionZones: IExclusionZone[] = [{
            polygon: [
                [-23.61, -46.35] as Coordinates,
                [-23.61, -46.37] as Coordinates,
                [-23.62, -46.37] as Coordinates,
                [-23.62, -46.35] as Coordinates,
                [-23.61, -46.35] as Coordinates
            ],
            vehicleTypeIds: [1, 2, 3]
        }];

        const config: ICalculateRouteConfig = {
            maxDistance: 50000, maxDuration: 3600, minDistance: 0, schoolMaxDistance: 5000,
            averageStopDuration: 60, averageStopDurationWheelchair: 300,
            stopPointMaxDistanceType: 'walk', stopPointMaxDistance: 1000,
            vehicles: vehicles,
            onlySchoolsWithStudent: false,
            activateGroupingOfSchoolsByArrivalTimes: false, maxToleranceBetweenArrivalTimes: 1800,
            activateGroupingOfSchoolsByDepartureTimes: false, maxToleranceBetweenDepartureTimes: 1800,
            exclusionZones: exclusionZones
        };

        const directions = ['forward'];

        const service = new CalculateRouterizationService(
            schools, stopPoints, vehicles, config,
            routingProviderMock, validationProviderReal, directions
        );

        // Spy on console.log to verify rejection
        const logSpy = jest.spyOn(console, 'log');

        await service.execute();

        // Verify that the rejection log was produced
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('rejected by Exclusion Zone'));

        logSpy.mockRestore();
    }, 30000); // Extended timeout due to algorithm iterations

    test('should throw error when all vehicles are blocked by exclusion zone', async () => {
        const schools = [{
            id: 1,
            coordinates: [-23.550520, -46.633308] as Coordinates,
            students: [],
        }];

        const student1 = {
            id: 101,
            schoolId: 1,
            coordinates: [-23.559616, -46.658632] as Coordinates,
            reason: 'not_informed',
            usesWheelchair: false,
            specialNeed: false,
            arrivalTime: '07:00:00',
            departureTime: '12:00:00',
            distance: 0,
            duration: 0
        } as IStudentData;

        const stopPoints = [{
            coordinates: [-23.559616, -46.658632] as Coordinates,
            students: [student1]
        }];

        const vehicles = [{
            id: 10,
            capacity: 20,
            wheelchairSectionCapacity: 0,
            max_capacity: false,
            kind: 'Micro-ônibus',
            height: 2.5, width: 2.2, length: 6.0, weight: 3.5, axis: 2, type: 'bus',
            vehicleTypeId: 1
        } as IVehicle];

        const exclusionZones: IExclusionZone[] = [{
            polygon: [
                [-23.61, -46.35] as Coordinates,
                [-23.61, -46.37] as Coordinates,
                [-23.62, -46.37] as Coordinates,
                [-23.62, -46.35] as Coordinates,
                [-23.61, -46.35] as Coordinates
            ],
            vehicleTypeIds: [1]
        }];

        const config: ICalculateRouteConfig = {
            maxDistance: 50000, maxDuration: 3600, minDistance: 0, schoolMaxDistance: 5000,
            averageStopDuration: 60, averageStopDurationWheelchair: 300,
            stopPointMaxDistanceType: 'walk', stopPointMaxDistance: 1000,
            vehicles: vehicles,
            onlySchoolsWithStudent: false,
            activateGroupingOfSchoolsByArrivalTimes: false, maxToleranceBetweenArrivalTimes: 1800,
            activateGroupingOfSchoolsByDepartureTimes: false, maxToleranceBetweenDepartureTimes: 1800,
            exclusionZones: exclusionZones
        };

        const directions = ['forward'];

        const service = new CalculateRouterizationService(
            schools, stopPoints, vehicles, config,
            routingProviderMock, validationProviderReal, directions
        );

        await expect(service.execute()).rejects.toThrow(
            /Não foi possível encontrar um veículo compatível para a rota/
        );
    }, 30000);
});

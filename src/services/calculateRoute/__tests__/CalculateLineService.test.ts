import { describe, expect, it, beforeAll, jest } from '@jest/globals';
import { CalculateLineService } from '../calculateLineService';
import { GoogleRoutesProvider } from '../../../providers/google/GoogleRoutesProvider';
import { success } from '../../../data/result';
import { ICalculateRouteConfig, ISchool, IStopPoint, IStudentData } from '../interfaces';

jest.mock('../../../providers/google/GoogleRoutesProvider');

describe('CalculateLineService — Validação de Limites de Rota', () => {
  let routingProviderMock: GoogleRoutesProvider;

  beforeAll(() => {
    routingProviderMock = new GoogleRoutesProvider();

    (routingProviderMock.computeRoutes as unknown as jest.Mock).mockImplementation(() =>
      Promise.resolve(
        success({
          routes: [
            {
              distanceMeters: 50000,
              duration: '7100s',
              polyline: { encodedPolyline: 'dummy' },
              legs: [
                {
                  distanceMeters: 50000,
                  duration: '7100s',
                  polyline: { encodedPolyline: 'dummy' },
                  startLocation: { latLng: { latitude: -20.0, longitude: -47.0 } },
                  endLocation: { latLng: { latitude: -20.1, longitude: -47.1 } },
                },
              ],
            },
          ],
        }),
      ),
    );

    Object.defineProperty(routingProviderMock, 'COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS', {
      value: 25,
    });
  });

  const mockStudent = (id: number): IStudentData => ({
    id,
    arrivalTime: '2026-09-04T07:00:00Z',
    departureTime: '2026-09-04T12:00:00Z',
    usesWheelchair: false,
    specialNeed: false,
    reason: 'distance',
    coordinates: [-20.0, -47.0],
    schoolId: 1,
    distance: 1000,
    duration: 300,
    stopPointDistance: 0,
  });

  const school: ISchool = {
    id: 1,
    coordinates: [-20.1, -47.1],
    students: [],
  };

  const baseConfig: ICalculateRouteConfig = {
    maxDistance: 80000,
    maxDuration: 7200,
    minDistance: 2000,
    schoolMaxDistance: 5000,
    averageStopDuration: 60,
    averageStopDurationWheelchair: 120,
    stopPointMaxDistanceType: 'walk',
    stopPointMaxDistance: 1000,
    vehicles: [],
    onlySchoolsWithStudent: false,
    activateGroupingOfSchoolsByArrivalTimes: false,
    maxToleranceBetweenArrivalTimes: 3600,
    activateGroupingOfSchoolsByDepartureTimes: false,
    maxToleranceBetweenDepartureTimes: 3600,
  };

  it('marca withinLimits = false quando o tempo de parada (standByTime) faz a rota exceder maxDuration', async () => {
    const stopPoints: IStopPoint[] = [
      { coordinates: [-20.01, -47.01], students: [mockStudent(1)] },
      { coordinates: [-20.02, -47.02], students: [mockStudent(2)] },
      { coordinates: [-20.03, -47.03], students: [mockStudent(3)] },
    ];

    const service = new CalculateLineService(
      stopPoints,
      [school],
      baseConfig,
      routingProviderMock,
      ['forward'],
    );

    const result = await service.execute();
    expect(result.success()).toBe(true);

    const data = result.result;
    expect(data).toBeDefined();
    expect(data?.route.forwardRoute.duration).toBe(7280);
    expect(data?.withinLimits).toBe(false);
  });

  it('marca withinLimits = true quando a rota total com paradas permanece dentro de maxDuration', async () => {
    (routingProviderMock.computeRoutes as unknown as jest.Mock).mockImplementationOnce(() =>
      Promise.resolve(
        success({
          routes: [
            {
              distanceMeters: 40000,
              duration: '7000s',
              polyline: { encodedPolyline: 'dummy' },
              legs: [],
            },
          ],
        }),
      ),
    );

    const stopPoints: IStopPoint[] = [
      { coordinates: [-20.01, -47.01], students: [mockStudent(1)] },
    ];

    const service = new CalculateLineService(
      stopPoints,
      [school],
      baseConfig,
      routingProviderMock,
      ['forward'],
    );

    const result = await service.execute();
    expect(result.success()).toBe(true);

    const data = result.result;
    expect(data).toBeDefined();
    expect(data?.route.forwardRoute.duration).toBe(7060);
    expect(data?.withinLimits).toBe(true);
  });
});

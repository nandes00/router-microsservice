import { describe, expect, test, beforeAll, jest } from '@jest/globals';
import { RouteConsolidationService } from '../routeConsolidationService';
import { GoogleRoutesProvider } from '../../../providers/google/GoogleRoutesProvider';
import { success } from '../../../data/result';
import {
  ICalculateRouteConfig,
  IRouteData,
  ISchool,
  IStopPoint,
  IStudentData,
  IVehicle,
} from '../interfaces';
import { Coordinates } from '../../../data/coordinates';

// Mock the GoogleRoutesProvider
jest.mock('../../../providers/google/GoogleRoutesProvider');

describe('RouteConsolidationService Unit & Integration Test Bench', () => {
  let routingProviderMock: GoogleRoutesProvider;

  beforeAll(() => {
    routingProviderMock = new GoogleRoutesProvider();

    (routingProviderMock.computeRoutes as unknown as jest.Mock).mockImplementation(() =>
      Promise.resolve(
        success({
          routes: [
            {
              distanceMeters: 2000,
              duration: '900s',
              polyline: { encodedPolyline: 'zncoCj~}yG`@{@' },
              legs: [
                {
                  distanceMeters: 2000,
                  duration: '900s',
                  polyline: { encodedPolyline: 'zncoCj~}yG`@{@' },
                  startLocation: { latLng: { latitude: -23.55, longitude: -46.63 } },
                  endLocation: { latLng: { latitude: -23.56, longitude: -46.65 } },
                },
              ],
            },
          ],
        }),
      ),
    );

    Object.defineProperty(
      routingProviderMock,
      'COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS',
      { value: 25 },
    );
  });

  const schools: ISchool[] = [
    {
      id: 1,
      coordinates: [-23.55052, -46.633308] as Coordinates,
      students: [],
    },
  ];

  const vehicles: IVehicle[] = [
    {
      id: 1,
      capacity: 30,
      wheelchairSectionCapacity: 2,
      kind: 'Micro-ônibus',
      max_capacity: false,
    },
  ];

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
    maxToleranceBetweenDepartureTimes: 1800,
  };

  const createStudent = (id: number, lat: number, lng: number): IStudentData => ({
    id,
    schoolId: 1,
    coordinates: [lat, lng] as Coordinates,
    reason: 'not_informed',
    usesWheelchair: false,
    specialNeed: false,
    arrivalTime: '07:00:00',
    departureTime: '12:00:00',
    distance: 0,
    duration: 0,
  });

  const createDummyRouteData = (
    stopPoints: IStopPoint[],
    studentsCount: number,
    wheelchairCount = 0,
    distance = 5000,
    duration = 1200,
  ): IRouteData => ({
    route: {
      furthestStopPoint: stopPoints[0],
      forwardRoute: {
        distance,
        duration,
        schools: [],
        stopPoints: stopPoints.map((sp) => ({
          ...sp,
          traveledDistance: distance,
          traveledDuration: duration,
        })),
        studentRoute: {
          encodedPolyline: 'dummy',
          distance,
          duration,
          legs: [],
        },
      },
      backRoute: {
        distance,
        duration,
        schools: [],
        stopPoints: stopPoints.map((sp) => ({
          ...sp,
          traveledDistance: distance,
          traveledDuration: duration,
        })),
        studentRoute: {
          encodedPolyline: 'dummy',
          distance,
          duration,
          legs: [],
        },
      },
    },
    withinLimits: true,
    studentsCapacity: 30,
    distancePercentage: distance / 50000,
    durationPercentage: duration / 3600,
    students: studentsCount,
    wheelchairStudentsQuantity: wheelchairCount,
    wheelchairStudentsCapacity: 2,
  });

  test('should merge two 1-student routes into a single route', async () => {
    const student1 = createStudent(101, -23.5596, -46.6586);
    const student2 = createStudent(102, -23.5601, -46.659);

    const route1 = createDummyRouteData(
      [{ coordinates: [-23.5596, -46.6586], students: [student1] }],
      1,
    );
    const route2 = createDummyRouteData(
      [{ coordinates: [-23.5601, -46.659], students: [student2] }],
      1,
    );

    const service = new RouteConsolidationService(
      schools,
      vehicles,
      config,
      routingProviderMock,
      ['forward', 'back'],
    );

    const result = await service.execute([route1, route2]);

    expect(result.length).toBe(1);
    expect(result[0].students).toBe(2);
  });

  test('should absorb a 1-student sparse route into a dense route (15 students)', async () => {
    const singleStudent = createStudent(999, -23.5596, -46.6586);
    const sparseRoute = createDummyRouteData(
      [{ coordinates: [-23.5596, -46.6586], students: [singleStudent] }],
      1,
    );

    const denseStudents = Array.from({ length: 15 }, (_, i) =>
      createStudent(i + 1, -23.551 + i * 0.001, -46.635 + i * 0.001),
    );
    const denseStops = denseStudents.map((st) => ({
      coordinates: st.coordinates,
      students: [st],
    }));
    const denseRoute = createDummyRouteData(denseStops, 15);

    const service = new RouteConsolidationService(
      schools,
      vehicles,
      config,
      routingProviderMock,
      ['forward', 'back'],
    );

    const result = await service.execute([sparseRoute, denseRoute]);

    expect(result.length).toBe(1);
    expect(result[0].students).toBe(16);
  });

  test('should NOT merge routes if total capacity exceeds vehicle limit', async () => {
    const studentsGroupA = Array.from({ length: 20 }, (_, i) =>
      createStudent(100 + i, -23.55 + i * 0.001, -46.63),
    );
    const routeA = createDummyRouteData(
      [{ coordinates: [-23.55, -46.63], students: studentsGroupA }],
      20,
    );

    const studentsGroupB = Array.from({ length: 20 }, (_, i) =>
      createStudent(200 + i, -23.56 + i * 0.001, -46.64),
    );
    const routeB = createDummyRouteData(
      [{ coordinates: [-23.56, -46.64], students: studentsGroupB }],
      20,
    );

    const service = new RouteConsolidationService(
      schools,
      vehicles,
      config,
      routingProviderMock,
      ['forward', 'back'],
    );

    // Max capacity is 30. 20 + 20 = 40 > 30, so they must remain 2 separate routes.
    const result = await service.execute([routeA, routeB]);

    expect(result.length).toBe(2);
  });

  test('should preserve all student IDs without loss or duplication', async () => {
    const student1 = createStudent(501, -23.559, -46.658);
    const student2 = createStudent(502, -23.56, -46.659);
    const student3 = createStudent(503, -23.561, -46.66);

    const route1 = createDummyRouteData(
      [{ coordinates: [-23.559, -46.658], students: [student1, student2] }],
      2,
    );
    const route2 = createDummyRouteData(
      [{ coordinates: [-23.561, -46.66], students: [student3] }],
      1,
    );

    const service = new RouteConsolidationService(
      schools,
      vehicles,
      config,
      routingProviderMock,
      ['forward', 'back'],
    );

    const result = await service.execute([route1, route2]);

    expect(result.length).toBe(1);
    const allStops = result[0].route.backRoute.stopPoints;
    const allStudents = allStops.flatMap((sp) => sp.students);
    const studentIds = allStudents.map((s) => s.id);

    expect(studentIds).toContain(501);
    expect(studentIds).toContain(502);
    expect(studentIds).toContain(503);
    expect(new Set(studentIds).size).toBe(3);
  });
});

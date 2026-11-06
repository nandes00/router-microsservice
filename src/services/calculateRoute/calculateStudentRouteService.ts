import { Coordinates, calculateAbsoluteDistance } from '@data/coordinates';
import { IComputeRoutesResponse } from '@providers/interfaces/dtos';
import { IRoutesProvider } from '@providers/interfaces/IRoutesProvider';
import { RoutesProviderFactory } from '@providers/index';
import { success, Result, fail } from '@data/result';
import { ICalculatedLine, ICalculateRouteConfig, ISchool, IStopPoint, IStudentData, IStudentsRoute } from './interfaces';
import { parseMapsDuration, waypointToCoordinate } from '@utils/calculateRouteHelpers';

export class CalculateStudentRouteService {
  private computedRoute: ICalculatedLine | undefined;
  private readonly computedRoutesFails: Error[] = [];
  impossibleAddresses: IStudentData[] = [];

  constructor(
    private readonly stopPoints: IStopPoint[],
    private readonly schools: ISchool[],
    private readonly forwardDepartureTime: string,
    private readonly backDepartureTime: string,
    private readonly googleRoutesAPI: IRoutesProvider = RoutesProviderFactory.getRoutingProvider(),
    private readonly config: ICalculateRouteConfig,
  ) { }

  async execute(): Promise<Result<ICalculatedLine, Error[]>> {
    try {
      await this.computeRoute();
    } catch (error: any) {
      this.computedRoutesFails.push(error);
    }

    if (this.computedRoutesFails.length > 0) return fail(this.computedRoutesFails);

    return success(this.computedRoute!);
  }

  private async computeRoute() {
    const firstSchoolLocation = this.schools[0].coordinates;

    const { furthestStopPoint, stopPoints } = this.splitFurthestStopPoint(this.stopPoints, firstSchoolLocation);
    const stopPointsCoordinates = stopPoints.map(({ coordinates }) => coordinates);

    const twoWayRoute = await this.calculateTwoWayRoute(furthestStopPoint.coordinates, firstSchoolLocation, stopPointsCoordinates);

    if (!twoWayRoute.backRoute || !twoWayRoute.forwardRoute) return;

    const forwardRoute = this.parseRoute(twoWayRoute.forwardRoute, stopPoints, this.schools);
    const backRoute = this.parseRoute(twoWayRoute.backRoute, stopPoints, this.schools);
    forwardRoute.stopPoints.unshift({
      ...furthestStopPoint,
      traveledDistance: forwardRoute.studentRoute.distance,
      traveledDuration: forwardRoute.studentRoute.duration,
    });
    backRoute.stopPoints.push({
      ...furthestStopPoint,
      traveledDistance: backRoute.studentRoute.distance,
      traveledDuration: backRoute.studentRoute.duration,
    });

    this.computedRoute = { backRoute, forwardRoute, furthestStopPoint };

    this.calculateAverageDurationByStopPoint();

    if (!this.computedRoute) {
      throw new Error('Falha ao construir o objeto de rota final no CalculateStudentRouteService');
    }
  }

  private splitFurthestStopPoint(stopPoints: IStopPoint[], reference: Coordinates) {
    let [furthestStopPoint, ...otherStopPoints] = stopPoints;
    let furthestDistance = calculateAbsoluteDistance(furthestStopPoint, { coordinates: reference });
    const intermediates: IStopPoint[] = [];

    otherStopPoints.forEach((student) => {
      const distance = calculateAbsoluteDistance(student, { coordinates: reference });
      if (distance > furthestDistance) {
        intermediates.push(furthestStopPoint);
        furthestStopPoint = student;
        furthestDistance = distance;
      } else {
        intermediates.push(student);
      }
    });

    return {
      stopPoints: intermediates,
      furthestStopPoint,
    };
  }

  private async calculateTwoWayRoute(origin: Coordinates, destination: Coordinates, intermediates: Coordinates[]) {
    const [forwardRouteInfo, backRouteInfo] = await Promise.all([
      this.googleRoutesAPI.computeRoutes(origin, destination, intermediates, this.forwardDepartureTime),
      this.googleRoutesAPI.computeRoutes(destination, origin, intermediates, this.backDepartureTime),
    ]);

    if (forwardRouteInfo.fail()) {
      this.computedRoutesFails.push(forwardRouteInfo.error);
    };
    if (backRouteInfo.fail()) {
      this.computedRoutesFails.push(backRouteInfo.error);
    };

    return {
      forwardRoute: forwardRouteInfo.result,
      backRoute: backRouteInfo.result,
    };
  }

  private parseRoute(computeRoutesResponse: IComputeRoutesResponse, stopPoints: IStopPoint[], schools: ISchool[]): IStudentsRoute {
    if (!computeRoutesResponse.routes || computeRoutesResponse.routes.length === 0) {
      throw new Error('Provedor de rotas não retornou nenhum trajeto válido (zero routes)');
    }

    const {
      distanceMeters, duration, polyline: { encodedPolyline }, legs, optimizedIntermediateWaypointIndex,
    } = computeRoutesResponse.routes[0];

    const parsedRoute: IStudentsRoute = {
      studentRoute: {
        encodedPolyline,
        distance: distanceMeters || 0,
        duration: parseMapsDuration(duration),
        legs: legs.map(leg => ({
          encodedPolyline: leg.polyline.encodedPolyline,
          distance: leg.distanceMeters ?? 0,
          duration: parseMapsDuration(leg.duration),
          startLocation: waypointToCoordinate(leg.startLocation),
          endLocation: waypointToCoordinate(leg.endLocation),
        })),
      },
      distance: distanceMeters || 0,
      duration: parseMapsDuration(duration),
      stopPoints: [],
      schools,
    };

    if (optimizedIntermediateWaypointIndex && optimizedIntermediateWaypointIndex.length > 0) {
      optimizedIntermediateWaypointIndex.forEach((optimizedIndex, index) => {
        const intermediateIndex = optimizedIndex === -1 ? 0 : optimizedIndex;
        const lastIntermediate = index > 0 ? parsedRoute.stopPoints[index - 1] : undefined;

        const traveledDistance = (parsedRoute.studentRoute.legs[index]?.distance || 0) + (lastIntermediate ? lastIntermediate.traveledDistance : 0);
        const traveledDuration = (parsedRoute.studentRoute.legs[index]?.duration || 0) + (lastIntermediate ? lastIntermediate.traveledDuration : 0);

        parsedRoute.stopPoints.push({
          ...stopPoints[intermediateIndex], traveledDistance, traveledDuration,
        });
      });
    } else {
      stopPoints.forEach((sp, index) => {
        const leg = parsedRoute.studentRoute.legs[index];
        const lastIntermediate = index > 0 ? parsedRoute.stopPoints[index - 1] : undefined;
        const traveledDistance = (leg?.distance || 0) + (lastIntermediate ? lastIntermediate.traveledDistance : 0);
        const traveledDuration = (leg?.duration || 0) + (lastIntermediate ? lastIntermediate.traveledDuration : 0);

        parsedRoute.stopPoints.push({
          ...sp,
          traveledDistance,
          traveledDuration,
        });
      });
    }

    return parsedRoute;
  }

  private calculateAverageDurationByStopPoint() {
    this.computedRoute!.forwardRoute.stopPoints.forEach((_, index) => {
      const averageStopDuration = this.config.averageStopDuration * (this.computedRoute!.forwardRoute.stopPoints.length - (index + 1));

      this.computedRoute!.forwardRoute.stopPoints[index].traveledDuration += averageStopDuration;
    });

    this.computedRoute!.backRoute.stopPoints.forEach((_, index) => {
      const averageStopDuration = this.config.averageStopDuration * index;

      this.computedRoute!.backRoute.stopPoints[index].traveledDuration += averageStopDuration;
    });
  }
}

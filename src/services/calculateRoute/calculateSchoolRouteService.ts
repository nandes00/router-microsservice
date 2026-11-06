import { IComputeRoutesResponse } from '@providers/interfaces/dtos';
import { IRoutesProvider } from '@providers/interfaces/IRoutesProvider';
import { RoutesProviderFactory } from '@providers/index';
import { Coordinates } from '@data/coordinates';
import { Result, fail, success } from '@data/result';
import { parseMapsDuration, waypointToCoordinate } from '@utils/calculateRouteHelpers';
import { IRoute, ISchool, ISchoolTravelLocation, IStudentData } from './interfaces';

interface ICalculatedRoute {
  route: IRoute
  schools: ISchoolTravelLocation[]
}

interface ICalculatedRoutes {
  forwardRoute: ICalculatedRoute
  backRoute: ICalculatedRoute
}

export class CalculateSchoolRouteService {
  private computedRoute: ICalculatedRoutes | undefined;
  private readonly computedRoutesFails: Error[] = [];
  impossibleAddresses: IStudentData[] = [];

  constructor(
    private readonly schools: ISchool[],
    private readonly forwardDepartureTime: string,
    private readonly backDepartureTime: string,
    private readonly googleRoutesAPI: IRoutesProvider = RoutesProviderFactory.getRoutingProvider(),
    private readonly directions: string[],
  ) { }

  async execute(): Promise<Result<ICalculatedRoutes, Error[]>> {
    if (this.schools.length < 2) return fail([new Error('Too few schools')]);

    try {
      await this.computeRoute();
    } catch (error: any) {
      this.computedRoutesFails.push(error);
    }

    if (this.computedRoutesFails.length > 0) return fail(this.computedRoutesFails);

    return success(this.computedRoute!);
  }

  private async computeRoute() {
    if (this.schools.length <= 1) return;

    const firstSchool = this.schools[0];
    const lastSchool = this.schools[this.schools.length - 1];
    const intermediateSchools = this.schools.slice(1, this.schools.length - 1);

    const route = this.directions.length === 2
      ? await this.calculateTwoWayRoute(
        firstSchool.coordinates,
        lastSchool.coordinates,
        intermediateSchools.map(({ coordinates }) => coordinates),
      )
      : await this.calculateOneWayRoute(
        firstSchool.coordinates,
        lastSchool.coordinates,
        intermediateSchools.map(({ coordinates }) => coordinates),
      );

    if (!route.backRoute || !route.forwardRoute) return;

    this.computedRoute = {
      forwardRoute: this.parseSchoolRoute(route.forwardRoute, firstSchool, lastSchool, intermediateSchools),
      backRoute: this.parseSchoolRoute(route.backRoute, firstSchool, lastSchool, intermediateSchools),
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

  private async calculateOneWayRoute(origin: Coordinates, destination: Coordinates, intermediates: Coordinates[]) {
    const time = this.directions.includes('forward') ? this.forwardDepartureTime : this.backDepartureTime;

    const routeInfo = await this.googleRoutesAPI.computeRoutes(
      origin, destination, intermediates, time,
    );

    if (routeInfo.fail()) {
      this.computedRoutesFails.push(routeInfo.error);
    }

    return {
      forwardRoute: routeInfo.result, // TODO: revisar como é criada forwardRoute
      backRoute: routeInfo.result,
    };
  }

  private parseSchoolRoute(
    computeRoutesResponse: IComputeRoutesResponse, firstSchool: ISchool, lastSchool: ISchool, intermediateSchools: ISchool[],
  ): ICalculatedRoute {
    if (!computeRoutesResponse.routes || computeRoutesResponse.routes.length === 0) {
      throw new Error('Provedor de rotas não retornou trajetos entre as escolas');
    }

    const {
      distanceMeters, duration, polyline: { encodedPolyline }, legs, optimizedIntermediateWaypointIndex,
    } = computeRoutesResponse.routes[0];

    const parsedRoute: IRoute = {
      encodedPolyline,
      distance: distanceMeters || 0,
      duration: parseMapsDuration(duration),
      legs: legs.map(leg => ({
        encodedPolyline: leg.polyline.encodedPolyline,
        distance: leg.distanceMeters,
        duration: parseMapsDuration(leg.duration),
        startLocation: waypointToCoordinate(leg.startLocation),
        endLocation: waypointToCoordinate(leg.endLocation),
      })),
    };

    const intermediates: ISchoolTravelLocation[] = [];

    if (optimizedIntermediateWaypointIndex) {
      optimizedIntermediateWaypointIndex.forEach((optimizedIndex, index) => {
        const intermediateIndex = optimizedIndex === -1 ? 0 : optimizedIndex;
        const lastIntermediate = index > 0 ? intermediates[index - 1] : undefined;

        const distance = parsedRoute.legs[index].distance + (lastIntermediate?.distance ? lastIntermediate.distance : 0);
        const duration = parsedRoute.legs[index].duration + (lastIntermediate?.duration ? lastIntermediate.duration : 0);

        intermediates.push({
          ...intermediateSchools[intermediateIndex],
          distance,
          duration,
        });
      });
    }

    const schools = [
      { ...firstSchool, distance: 0, duration: 0 },
      ...intermediates,
      { ...lastSchool, distance: parsedRoute.distance, duration: parsedRoute.duration },
    ];

    return { route: parsedRoute, schools };
  }
}

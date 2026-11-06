import { Coordinates, coordinatesToWaypoint } from '@data/coordinates';
import { Result } from '@data/result';
import {
  IComputeDistanceMatrixResponse,
  IComputeRouteResponse,
  IComputeRoutesResponse,
  TravelModes
} from '@providers/interfaces/dtos';
import { IRoutesProvider } from '@providers/interfaces/IRoutesProvider';
import { GoogleRoutesProvider } from '@providers/google/GoogleRoutesProvider';
import { RequestMocker } from '@utils/mock';
import moment from 'moment';

export class GoogleRoutesAPIMock implements IRoutesProvider {
  readonly COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS = 25;
  readonly COMPUTE_DISTANCE_MATRIX_MAX_ELEMENTS = 25;

  calls: number = 0;
  retries: number = 0;
  cost = { routes: 0, routesMatrix: 0 };

  mockName: string | undefined;

  async computeRoutes(
    origin: Coordinates,
    destination: Coordinates,
    intermediates: Coordinates[],
    departureTime: string = moment().toISOString()
  ): Promise<Result<IComputeRoutesResponse>> {
    const body = {
      origin: coordinatesToWaypoint(origin),
      destination: coordinatesToWaypoint(destination),
      intermediates: intermediates.map(coordinatesToWaypoint),
      computeAlternativeRoutes: false,
      optimizeWaypointOrder: true,
      departureTime,
    };

    return new RequestMocker(this.mountMockName('computeRoutesMock')).fetchData(body, () =>
      new GoogleRoutesProvider().computeRoutes(origin, destination, intermediates, departureTime)
    );
  }

  async computeRoute(
    origin: Coordinates,
    destination: Coordinates,
    travelMode: TravelModes = TravelModes.drive
  ): Promise<Result<IComputeRouteResponse>> {
    const body = {
      origin: coordinatesToWaypoint(origin),
      destination: coordinatesToWaypoint(destination),
      computeAlternativeRoutes: false,
      travelMode,
    };
    return new RequestMocker(this.mountMockName('computeRouteMock')).fetchData(body, () =>
      new GoogleRoutesProvider().computeRoute(origin, destination, travelMode)
    );
  }

  async computeDistanceMatrix(
    origins: Coordinates[],
    destinations: Coordinates[]
  ): Promise<Result<IComputeDistanceMatrixResponse[]>> {
    const body = {
      origins: origins.map((point) => ({ waypoint: coordinatesToWaypoint(point) })),
      destinations: destinations.map((point) => ({ waypoint: coordinatesToWaypoint(point) })),
    };

    return new RequestMocker(this.mountMockName('computeDistanceMatrix')).fetchData(body, () =>
      new GoogleRoutesProvider().computeDistanceMatrix(origins, destinations)
    );
  }

  private mountMockName(nameSpace: string) {
    if (this.mockName) {
      return `${nameSpace}_${this.mockName}`;
    }
    return nameSpace;
  }
}

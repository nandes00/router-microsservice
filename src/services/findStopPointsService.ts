import { ICluster, calculateAbsoluteDistance, clusterize, coordinateIsEqual } from '@data/coordinates';
import { ICalculateRouteConfig, IStopPoint, IStudentData, IVehicle } from './calculateRoute/interfaces';
import { IRoutesProvider } from '@providers/interfaces/IRoutesProvider';
import { RoutesProviderFactory } from '@providers/index';
import { IComputeRouteResponse, TravelModes } from '@providers/interfaces/dtos';
import { decode } from '@mapbox/polyline';
import { Result } from '@data/result';
import { chunks } from '@data/array';
import { pLimit } from '@utils/promiseHelper';

export class FindStopPointsService {
  private readonly stopPoints: IStopPoint[] = [];
  private readonly maxSize: number;
  private readonly greaterCapacityForWheelchair: number;
  private readonly absoluteMaxDistance: number;
  private clustersNumber: number = 2;
  private remainingStudents: IStudentData[] = [];

  constructor(
    private readonly students: IStudentData[],
    private readonly vehicles: IVehicle[],
    private readonly config: ICalculateRouteConfig,
    private readonly routesProvider: IRoutesProvider = RoutesProviderFactory.getMatrixProvider(),
  ) {
    if (this.vehicles.length === 0) {
      this.maxSize = Math.max(...this.config.vehicles.map(vehicle => vehicle.capacity));
      this.greaterCapacityForWheelchair = Math.max(...this.config.vehicles.filter((vehicle) => vehicle.wheelchairSectionCapacity > 0).map(vehicle => vehicle.capacity));
    } else {
      this.maxSize = Math.min(...this.vehicles.map(vehicle => vehicle.capacity));
      this.greaterCapacityForWheelchair = Math.min(...this.vehicles.filter((vehicle) => vehicle.wheelchairSectionCapacity > 0).map(vehicle => vehicle.capacity));
    }

    this.remainingStudents = this.students;
    this.absoluteMaxDistance = this.config.stopPointMaxDistanceType === 'walk' ? this.config.stopPointMaxDistance * 0.75 : this.config.stopPointMaxDistance;
  }

  async execute(): Promise<IStopPoint[]> {
    do {
      const mappedClusters = this.fixSinglePointClusters(clusterize(this.remainingStudents, this.clustersNumber));

      this.remainingStudents = [];
      const doneClusters: IStopPoint[] = [];

      for (const chunk of mappedClusters) {
        let stopPoint = this.createPossibleStopPoint(chunk);

        if (stopPoint && stopPoint.students.length <= this.maxSize && this.isAbsoluteCloseEnough(stopPoint) && this.doesNotExceedTheCapacityOfWheelchairStudents(stopPoint)) {
          if (this.config.stopPointMaxDistanceType === 'absolute') {
            doneClusters.push(stopPoint);
            continue;
          }

          stopPoint = await this.computeRoutes(stopPoint);
          if (this.isWalkCloseEnough(stopPoint)) {
            doneClusters.push(stopPoint);
            continue;
          }
        }
        this.remainingStudents.push(...chunk.points);
      }

      this.clustersNumber = doneClusters.length > 0 ? 2 : this.clustersNumber + 1;

      this.stopPoints.push(...doneClusters);
    } while (this.remainingStudents.length > 0);

    return this.stopPoints;
  }

  private createPossibleStopPoint(chunk: ICluster<IStudentData>): IStopPoint | undefined {
    const students = chunk.points;
    //const disabledStudents = students.filter(student => student.reason === 'special_need');
    const disabledStudents = students.filter(student => student.specialNeed);

    if (disabledStudents.length === 0) return { coordinates: chunk.coordinates, students };
    if (disabledStudents.length === 1 || this.checkSamePosition(disabledStudents)) return { coordinates: disabledStudents[0].coordinates, students };

    return undefined;
  }

  private checkSamePosition(students: IStudentData[]) {
    return students.every((student) => coordinateIsEqual(students[0].coordinates, student.coordinates));
  }

  private fixSinglePointClusters(clusters: ICluster<IStudentData>[]): ICluster<IStudentData>[] {
    return clusters.flatMap((cluster) => {
      if (cluster.points.every(point => point.coordinates.join(',') === cluster.points[0].coordinates.join(',')) && cluster.points.length > this.maxSize) {
        return chunks(cluster.points, this.maxSize).map(chunk => ({ ...cluster, points: chunk }));
      }

      return [cluster];
    });
  }

  private retrieveNewStopPoint(route: Result<IComputeRouteResponse>) {
    return decode(route.result!.routes[0].polyline.encodedPolyline)[0];
  }

  private isWalkCloseEnough(stopPoint: IStopPoint) {
    return stopPoint.students.every(student => {
      return student.stopPointDistance !== undefined && student.stopPointDistance < this.config.stopPointMaxDistance;
    });
  }

  private isAbsoluteCloseEnough(stopPoint: IStopPoint) {
    return stopPoint.students.every(student => calculateAbsoluteDistance(student, stopPoint) < this.absoluteMaxDistance);
  }

  private doesNotExceedTheCapacityOfWheelchairStudents(stopPoint: IStopPoint) {
    const wheelchairStudentsCount = stopPoint.students.filter((student) => student.usesWheelchair).length;
    if (wheelchairStudentsCount > 0) {
      return wheelchairStudentsCount <= this.greaterCapacityForWheelchair;
    }

    return true;
  }

  private async computeRoutes(stopPoint: IStopPoint) {
    const limit = pLimit(3);
    let lastValidRoute: Result<IComputeRouteResponse> | null = null;

    stopPoint.students = await Promise.all(stopPoint.students.map(async student => {
      return limit(async () => {
        const currentRoute = await this.routesProvider.computeRoute(stopPoint.coordinates, student.coordinates, TravelModes.walk);
        if (currentRoute.fail()) return student;

        let stopPointDistance;
        if (!!currentRoute.value && !!currentRoute.value.routes && !!currentRoute.value.routes[0]) {
          stopPointDistance = currentRoute.value.routes[0].distanceMeters || 0;
          lastValidRoute = currentRoute;
        } else return student;

        return {
          ...student,
          stopPointDistance: stopPointDistance,
        };
      });
    }));

    if (stopPoint.students.length > 1 && lastValidRoute) {
      stopPoint.coordinates = this.retrieveNewStopPoint(lastValidRoute);
    }
    return stopPoint;
  }
}

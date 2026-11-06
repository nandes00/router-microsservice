import { IWaypoint } from '@providers/interfaces/dtos';
import { Coordinates } from '@data/coordinates';
import { IStopPoint, IStudentData } from '@services/calculateRoute/interfaces';

export function studentsFromStopPoins(stopPoints: IStopPoint[]): IStudentData[] {
  return stopPoints.flatMap((stopPoint) => stopPoint.students);
}

export function parseMapsDuration(duration: string) {
  const match = duration.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

export function waypointToCoordinate(waypoint: IWaypoint): Coordinates {
  return [waypoint.latLng.latitude, waypoint.latLng.longitude];
}

import bearing from '@turf/bearing';
import centerOfMass from '@turf/center-of-mass';
import clustersKmeans from '@turf/clusters-kmeans';
import distance from '@turf/distance';
import * as helpers from '@turf/helpers';

// GeoJSON Types Polyfill for Turf v7 compatibility
export type Position = number[];
export type BBox = [number, number, number, number] | [number, number, number, number, number, number];
export type Id = string | number;
export type Properties = { [name: string]: any } | null;

export interface Geometry {
  type: string;
  coordinates: any;
}

export interface Point extends Geometry {
  type: 'Point';
  coordinates: Position;
}

export interface Feature<G extends Geometry | null = Geometry, P = Properties> {
  type: 'Feature';
  geometry: G;
  id?: Id;
  properties: P;
  bbox?: BBox;
}

export interface FeatureCollection<G extends Geometry | null = Geometry, P = Properties> {
  type: 'FeatureCollection';
  features: Array<Feature<G, P>>;
  bbox?: BBox;
}

export type Coordinates = [number, number];

export interface IPoints {
  coordinates: Coordinates
}

export function coordinatesToWaypoint(coordinates: Coordinates) {
  return {
    location: {
      latLng: {
        latitude: coordinates[0],
        longitude: coordinates[1],
      },
    },
  };
}

export function findCentroid<T extends IPoints>(geoPoints: T[]): Coordinates {
  const turfPoints = points(geoPoints.map(p => p.coordinates));

  return turfPointToCoordinates(centerOfMass(turfPoints).geometry);
}

export function orderPoints<T extends IPoints>(points: T[], reference: Coordinates): T[] {
  const pointsWithAngle: { angle: number, point: T }[] = points.map((currentPoint) => {
    const angle = bearing(point(reference), point(currentPoint.coordinates));

    return { point: currentPoint, angle };
  });

  return pointsWithAngle.sort((pointA, pointB) => pointA.angle - pointB.angle).map(({ point }) => point);
}

// This method is no longer used, manteining it here because who knows what is comming, it can be necessary
export function splitCoordinates<T extends IPoints>(points: T[], reference: Coordinates): [T[], T[]] {
  const orderedPoints = orderPoints(points, reference);

  const middle = Math.floor(orderedPoints.length / 2);

  const pointsA: T[] = orderedPoints.slice(0, middle);
  const pointsB: T[] = orderedPoints.slice(middle, orderedPoints.length);

  return [pointsA, pointsB];
}

export function calculateAbsoluteDistance<T extends IPoints, U extends IPoints>(pointA: T, pointB: U): number {
  return distance(point(pointA.coordinates), point(pointB.coordinates), { units: 'meters' });
}

export interface ICluster<T extends IPoints> {
  coordinates: Coordinates
  points: T[]
}

interface IClusterData {
  cluster: number
  centroid: Coordinates
}

export function clusterize<T extends IPoints>(points: T[], clustersNumber: number) {
  if (clustersNumber === 1) return [{ points, coordinates: findCentroid(points) }];

  const studentPoints = helpers.featureCollection(points.map(student => {
    return point(student.coordinates, student);
  }));
  const clusters = clustersKmeans(studentPoints, { numberOfClusters: clustersNumber }) as FeatureCollection<Point, T & IClusterData>;

  const mappedClusters = clusters.features.reduce<ICluster<T>[]>((acc, val) => {
    const { cluster, centroid, ...rest } = val.properties;
    const point: T = rest as unknown as T; // typescript didn't undertand that Omit<T & { cluster: number, centroid: Coordinates }, 'cluster' | 'centroid'> is equal T
    if (acc[cluster]) {
      acc[cluster].points.push(point);
    } else {
      acc[cluster] = {
        coordinates: [centroid[1], centroid[0]],
        points: [point],
      };
    }
    return acc;
  }, []).flat();

  return mappedClusters;
}

function turfPointToCoordinates(point: Point): Coordinates {
  return [point.coordinates[1], point.coordinates[0]];
}

export function point<P = Properties>(coordinates: Position, properties?: P, options?: {
  bbox?: BBox
  id?: Id
}): Feature<Point, P> {
  return helpers.point([coordinates[1], coordinates[0]], properties as any, options) as any;
}

export function points<P = Properties>(coordinates: Position[], properties?: P, options?: {
  bbox?: BBox
  id?: Id
}): FeatureCollection<Point, P> {
  return helpers.points(coordinates.map(([lat, lng]) => ([lng, lat])), properties as any, options) as any;
}

export function coordinateIsEqual(coordA?: Coordinates, coordB?: Coordinates) {
  if (!coordA || !coordB) return false;

  return (coordA[0] === coordB[0]) && (coordA[1] === coordB[1]);
}

import { decode } from '@mapbox/polyline';
import { lineString, point } from '@turf/helpers';

interface IGeoJSONData {
  tipo: string
  [key: string]: any
}

const toTurfNotation = ([x, y]: [number, number]) => ([y, x]);

export const encodedPolylineToGeoJSON = (polyline: string, options: IGeoJSONData) => {
  const routes = decode(polyline).map((point) => toTurfNotation(point));
  if (routes.length <= 1) return null;

  return lineString(routes, options);
};

export const coordinatesToGeoJSON = (coordinates: [number, number], options: IGeoJSONData) => point(toTurfNotation(coordinates), options);

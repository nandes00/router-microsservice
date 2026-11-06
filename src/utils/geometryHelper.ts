import { decode } from '@mapbox/polyline';
import { booleanIntersects } from '@turf/boolean-intersects';
import { lineString, polygon } from '@turf/helpers';
import { Coordinates } from '../data/coordinates';

export const routeIntersectsPolygon = (
    encodedPolyline: string,
    polygons?: Coordinates[][],
): boolean => {
    if (!polygons || polygons.length === 0) return false;
    if (!encodedPolyline) return false;

    try {
        // Decode polyline returns [lat, lng]
        const decoded = decode(encodedPolyline);
        if (decoded.length < 2) return false;

        // Convert to Turf format [lng, lat]
        const lineCoords = decoded.map(c => [c[1], c[0]]);
        const lineStringObj = lineString(lineCoords);

        for (let i = 0; i < polygons.length; i++) {
            const zone = polygons[i];

            // Ensure polygon is closed for Turf
            const closedZone = [...zone];
            if (
                closedZone[0][0] !== closedZone[closedZone.length - 1][0] ||
                closedZone[0][1] !== closedZone[closedZone.length - 1][1]
            ) {
                closedZone.push(closedZone[0]);
            }

            // Convert zone to Turf format [lng, lat]
            const polygonCoords = [closedZone.map(c => [c[1], c[0]])];
            const polygonObj = polygon(polygonCoords);

            if (booleanIntersects(lineStringObj, polygonObj)) {
                return true;
            }
        }

        return false;
    } catch (error) {
        console.error('[GeometryHelper] Error validating polygon intersection:', error);
        return false;
    }
};

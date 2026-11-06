import { Coordinates } from '@data/coordinates';

export interface IWaypoint {
    latLng: {
        latitude: number;
        longitude: number;
    };
}

export enum TravelModes {
    drive = 'DRIVE',
    walk = 'WALK',
}

export interface IComputeRoutesLeg {
    distanceMeters: number;
    duration: string;
    polyline: { encodedPolyline: string };
    startLocation: IWaypoint;
    endLocation: IWaypoint;
}

export interface IComputeRoutesResponse {
    routes: {
        distanceMeters?: number;
        duration: string;
        polyline: { encodedPolyline: string };
        optimizedIntermediateWaypointIndex?: number[];
        legs: IComputeRoutesLeg[];
    }[];
}

export interface IComputeRouteResponse {
    routes: {
        distanceMeters: number;
        duration: string;
        polyline: { encodedPolyline: string };
    }[];
}

export type ComputeDistanceMatrixContiditons =
    | 'ROUTE_EXISTS'
    | 'ROUTE_NOT_FOUND'
    | 'ROUTE_MATRIX_ELEMENT_CONDITION_UNSPECIFIED';

export interface IComputeDistanceMatrixResponse {
    originIndex: number;
    destinationIndex: number;
    status: {
        code?: number;
        message?: string;
        details?: object[];
    };
    distanceMeters?: number;
    duration?: string;
    condition: ComputeDistanceMatrixContiditons;
}

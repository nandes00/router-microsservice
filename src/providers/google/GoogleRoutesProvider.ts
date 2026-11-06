import { Coordinates, coordinatesToWaypoint } from '@data/coordinates';
import { Result, fail, success } from '@data/result';
import { GOOGLE_API_KEY } from '@env';
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { pLimit } from '@utils/promiseHelper';
import { NoRouteFoundError } from '../errors';
import {
    IComputeDistanceMatrixResponse,
    IComputeRouteResponse,
    IComputeRoutesResponse,
    TravelModes,
} from '../interfaces/dtos';
import { IRoutesProvider, IVehicleProfile } from '../interfaces/IRoutesProvider';

class RateLimiter {
    private tokens: number;
    private capacity: number;
    private intervalMs: number;
    private tokensPerInterval: number;
    private timer: NodeJS.Timeout | null = null;
    private waiters: Array<() => void> = [];

    constructor(limitPerMinute: number) {
        this.capacity = Math.max(1, limitPerMinute);
        this.tokens = this.capacity;
        this.intervalMs = 1000;
        this.tokensPerInterval = Math.max(1, Math.floor(this.capacity / 60));
        this.timer = setInterval(() => this.refill(), this.intervalMs);
        if (this.timer.unref) {
            this.timer.unref();
        }
    }

    private refill() {
        this.tokens = Math.min(this.capacity, this.tokens + this.tokensPerInterval);
        this.resolveWaiters();
    }

    private resolveWaiters() {
        while (this.tokens > 0 && this.waiters.length > 0) {
            this.tokens--;
            const w = this.waiters.shift();
            if (w) w();
        }
    }

    removeToken(): Promise<void> {
        if (this.tokens > 0) {
            this.tokens--;
            return Promise.resolve();
        }
        return new Promise((resolve) => this.waiters.push(resolve));
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async schedule<T>(fn: () => Promise<T>): Promise<T> {
        await this.removeToken();
        return fn();
    }
}

export class GoogleRoutesProvider implements IRoutesProvider {
    private static sharedLimiter: RateLimiter | null = null;
    private static sharedConcurrency = pLimit(
        parseInt(process.env.GOOGLE_MAX_CONCURRENT_REQUESTS || '8', 10)
    );

    private readonly axios: AxiosInstance;
    calls: number = 0;
    retries: number = 0;
    cost: { routes: number; routesMatrix: number } = {
        routes: 0,
        routesMatrix: 0,
    };

    readonly COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS = 25;
    readonly COMPUTE_DISTANCE_MATRIX_MAX_ELEMENTS = 625;

    constructor(
        apiKey: string | undefined = GOOGLE_API_KEY,
        baseURL: string = 'https://routes.googleapis.com'
    ) {
        if (!apiKey) {
            throw new Error(
                '[GoogleRoutesProvider] GOOGLE_API_KEY is not defined. Please check your .env file or ensure you are using Valhalla for both Matrix and Routing.'
            );
        }
        this.axios = axios.create({
            params: { key: apiKey },
            baseURL,
            timeout: 60000,
        });
        axiosRetry(this.axios, {
            retries: 5,
            shouldResetTimeout: true,
            retryDelay: (retryCount, error) => {
                const retryAfter =
                    (error &&
                        error.response &&
                        error.response.headers &&
                        (error.response.headers['retry-after'] ||
                            error.response.headers['Retry-After'])) as any;
                if (retryAfter) {
                    const secs = parseInt(retryAfter, 10);
                    if (!isNaN(secs)) return secs * 1000;
                }
                const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
                return Math.min(delay, 15000);
            },
            retryCondition: (error) => {
                if (axiosRetry.isNetworkOrIdempotentRequestError(error)) return true;
                const status = error && error.response && error.response.status;
                if (typeof status !== 'number') return false;
                return status === 429 || (status >= 500 && status <= 599);
            },
            onRetry: (retryCount, error) => {
                this.retries++;
                console.warn(
                    `[Google API Retry] Attempt ${retryCount} for ${error && error.config?.url}: ${error && error.message}`
                );
            },
        });

        if (!GoogleRoutesProvider.sharedLimiter) {
            const limitPerMinute = parseInt(
                process.env.GOOGLE_REQUESTS_PER_MINUTE || '600',
                10
            );
            GoogleRoutesProvider.sharedLimiter = new RateLimiter(limitPerMinute);
        }
    }

    private schedule<T>(fn: () => Promise<T>): Promise<T> {
        return GoogleRoutesProvider.sharedConcurrency(() =>
            GoogleRoutesProvider.sharedLimiter!.schedule(fn)
        );
    }

    async computeRoutes(
        origin: Coordinates,
        destination: Coordinates,
        intermediates: Coordinates[],
        departureTime: string
    ): Promise<Result<IComputeRoutesResponse>> {
        try {
            const body = {
                origin: coordinatesToWaypoint(origin),
                destination: coordinatesToWaypoint(destination),
                intermediates: intermediates.map(coordinatesToWaypoint),
                computeAlternativeRoutes: false,
                optimizeWaypointOrder: true,
                routingPreference: 'TRAFFIC_AWARE',
                travelMode: TravelModes.drive,
                departureTime,
            };

            if (intermediates.length > this.COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS) {
                return fail(
                    new Error(
                        `Intermediate Points Limit Exceeded: The provided value of ${intermediates.length} points exceeds the maximum limit of ${this.COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS} allowed intermediate points`
                    )
                );
            }
            this.cost.routes += 0.01;
            const response = await this.schedule(() =>
                this.axios.post<IComputeRoutesResponse>(
                    '/directions/v2:computeRoutes',
                    body,
                    {
                        headers: {
                            'X-Goog-FieldMask':
                                'routes.optimizedIntermediateWaypointIndex,routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline,routes.legs.startLocation.*,routes.legs.endLocation.*',
                        },
                    }
                )
            );

            this.calls++;

            if (!response.data || !response.data.routes || response.data.routes.length === 0) {
                console.warn('[Google] API returned successful but with empty routes. Data:', JSON.stringify(response.data));
                return fail(new NoRouteFoundError('[Google] No routes found in the response. Check your coordinates and API Key permissions.'));
            }

            return success(response.data);
        } catch (error: any) {
            console.error('[Google] Error in computeRoutes:', error.response?.data || error.message);
            return fail(error);
        }
    }

    async computeRoute(
        origin: Coordinates,
        destination: Coordinates,
        travelMode: TravelModes = TravelModes.drive
    ): Promise<Result<IComputeRouteResponse>> {
        try {
            const body = {
                travelMode,
                origin: coordinatesToWaypoint(origin),
                destination: coordinatesToWaypoint(destination),
                computeAlternativeRoutes: false,
            };
            this.cost.routes += 0.005;
            const response = await this.schedule(() =>
                this.axios.post<IComputeRouteResponse>(
                    '/directions/v2:computeRoutes',
                    body,
                    {
                        headers: {
                            'X-Goog-FieldMask':
                                'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
                        },
                    }
                )
            );

            this.calls++;

            if (!response.data || !response.data.routes || response.data.routes.length === 0) {
                return fail(new NoRouteFoundError('[Google] No route found in the response.'));
            }

            return success(response.data);
        } catch (error: any) {
            console.error('[Google] Error in computeRoute:', error.response?.data || error.message);
            return fail(error);
        }
    }

    async computeDistanceMatrix(
        origins: Coordinates[],
        destinations: Coordinates[]
    ): Promise<Result<IComputeDistanceMatrixResponse[]>> {
        try {
            const body = {
                origins: origins.map((point) => ({
                    waypoint: coordinatesToWaypoint(point),
                })),
                destinations: destinations.map((point) => ({
                    waypoint: coordinatesToWaypoint(point),
                })),
            };
            const elementsNumber = origins.length * destinations.length;

            if (elementsNumber > this.COMPUTE_DISTANCE_MATRIX_MAX_ELEMENTS) {
                return fail(
                    new Error(
                        `Exceeded Elements Limit: The provided value of ${elementsNumber} elements surpasses the maximum allowable limit of ${this.COMPUTE_DISTANCE_MATRIX_MAX_ELEMENTS}.`
                    )
                );
            }
            this.cost.routesMatrix += elementsNumber * 0.005;
            const response = await this.schedule(() =>
                this.axios.post<IComputeDistanceMatrixResponse[]>(
                    '/distanceMatrix/v2:computeRouteMatrix',
                    body,
                    {
                        headers: {
                            'X-Goog-FieldMask':
                                'status,condition,distanceMeters,duration,originIndex,destinationIndex',
                        },
                    }
                )
            );

            this.calls++;

            if (!response.data || response.data.length === 0) {
                return fail(new Error('[Google] No distance matrix data found in the response.'));
            }

            return success(response.data);
        } catch (error: any) {
            console.error('[Google] Error in computeDistanceMatrix:', error.response?.data || error.message);
            return fail(error);
        }
    }

    async validateRouteRestriction(
        origin: Coordinates,
        destination: Coordinates,
        intermediates: Coordinates[],
        vehicleProfile: IVehicleProfile
    ): Promise<Result<boolean>> {
        return success(true);
    }
}

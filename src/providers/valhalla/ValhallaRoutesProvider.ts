import { Coordinates } from '@data/coordinates';
import { Result, fail, success } from '@data/result';
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import {
    IComputeDistanceMatrixResponse,
    IComputeRouteResponse,
    IComputeRoutesResponse,
    IComputeRoutesLeg,
    TravelModes,
} from '../interfaces/dtos';
import { IRoutesProvider, IVehicleProfile } from '../interfaces/IRoutesProvider';
import * as polyline from '@mapbox/polyline';
import { pLimit } from '@utils/promiseHelper';
import { NoRouteFoundError } from '../errors';

const VALHALLA_NO_PATH_ERROR_CODE = 442;
const VALHALLA_MAX_DISTANCE_EXCEEDED_ERROR_CODE = 154;
const VALHALLA_NO_SUITABLE_EDGES_ERROR_CODE = 171;

const VALHALLA_MATRIX_CELL_ERROR_CODES = [
    VALHALLA_NO_PATH_ERROR_CODE,
    VALHALLA_MAX_DISTANCE_EXCEEDED_ERROR_CODE,
    VALHALLA_NO_SUITABLE_EDGES_ERROR_CODE,
];

export class ValhallaRoutesProvider implements IRoutesProvider {
    private readonly axios: AxiosInstance;

    /**
     * Máximo de pontos intermediários por requisição ao /optimized_route.
     * O Valhalla calcula uma matriz N×N internamente para otimizar a rota,
     * onde N = intermediates + origin + destination.
     * Com max_matrix_location_pairs = 12000 no Valhalla, o limite seguro é
     * √12000 ≈ 109 locations → 107 intermediates. Usamos 100 para margem.
     */
    readonly COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS = 100;
    readonly COMPUTE_DISTANCE_MATRIX_MAX_ELEMENTS = 2500;

    calls: number = 0;
    retries: number = 0;
    cost: { routes: number; routesMatrix: number } = {
        routes: 0,
        routesMatrix: 0,
    };

    readonly minSpeedKmh: number;

    constructor(
        baseURL: string = process.env.VALHALLA_URL || 'http://valhalla:8002',
        minSpeedKmh?: number
    ) {
        const envMinSpeed = process.env.VALHALLA_MIN_SPEED_KMH ? parseFloat(process.env.VALHALLA_MIN_SPEED_KMH) : NaN;
        this.minSpeedKmh = minSpeedKmh ?? (!isNaN(envMinSpeed) && envMinSpeed > 0 ? envMinSpeed : 30);

        this.axios = axios.create({
            baseURL,
            timeout: 60000,
        });

        axiosRetry(this.axios, {
            retries: 3,
            retryDelay: axiosRetry.exponentialDelay,
            retryCondition: (error) => {
                // Tenta novamente em erros de rede ou timeout (5xx)
                return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
                    (error.response ? error.response.status >= 500 : false);
            },
            onRetry: (retryCount, error) => {
                this.retries++;
                console.log(`[Valhalla] Retry ${retryCount} for request: ${error.message}`);
            }
        });
    }

    private normalizePolyline(encoded: string): string {
        try {
            // Valhalla costuma enviar precision 6. Decodificamos com 6 e codificamos com 5 (padrão Google).
            const coordinates = polyline.decode(encoded, 6);
            return polyline.encode(coordinates, 5);
        } catch (error) {
            console.error('[Valhalla] Error normalizing polyline:', error);
            return encoded;
        }
    }

    applyFloorSpeed(distanceMeters: number, durationSeconds: number): number {
        if (distanceMeters <= 0 || durationSeconds <= 0 || this.minSpeedKmh <= 0) {
            return durationSeconds;
        }

        const maxDurationSeconds = Math.round(distanceMeters / (this.minSpeedKmh / 3.6));

        if (durationSeconds > maxDurationSeconds) {
            return maxDurationSeconds;
        }

        return durationSeconds;
    }

    async computeRoutes(
        origin: Coordinates,
        destination: Coordinates,
        intermediates: Coordinates[],
        departureTime: string
    ): Promise<Result<IComputeRoutesResponse>> {
        try {
            // No Valhalla, para múltiplos pontos com otimização, usamos /optimized_trip
            // O primeiro e o último ponto são fixos no nosso modelo de negócio.
            const locations = [
                { lat: origin[0], lon: origin[1], type: 'break', name: '-1' },
                ...intermediates.map((coord, index) => ({
                    lat: coord[0],
                    lon: coord[1],
                    type: 'break',
                    name: index.toString()
                })),
                { lat: destination[0], lon: destination[1], type: 'break', name: '-2' },
            ];

            const json: any = {
                locations,
                costing: 'auto',
                units: 'km',
                // Garante que o primeiro ponto seja a origem e o último o destino
                // Nota: O optimized_trip do Valhalla por padrão fixa a origem.
                // Algumas versões permitem parâmetros extras para fixar o destino.
            };

            // Adiciona opções de custo se houver (pode ser expandido futuramente)
            json.costing_options = {
                auto: {
                    country_crossing_penalty: 2000.0
                }
            };
            const response = await this.axios.post('/optimized_route', json);
            this.calls++;

            const trip = response.data.trip;

            // Mapeia legs do Valhalla para IComputeRoutesLeg
            const legs = trip.legs.map((leg: any, index: number) => {
                const distanceMeters = Math.round(leg.summary.length * 1000);
                const durationSeconds = this.applyFloorSpeed(distanceMeters, Math.round(leg.summary.time));
                return {
                    distanceMeters,
                    duration: `${durationSeconds}s`,
                    polyline: { encodedPolyline: this.normalizePolyline(leg.shape) },
                    startLocation: { latLng: { latitude: trip.locations[index].lat, longitude: trip.locations[index].lon } },
                    endLocation: { latLng: { latitude: trip.locations[index + 1].lat, longitude: trip.locations[index + 1].lon } },
                };
            });

            // Reconstrói o índice de waypoints otimizados
            // O sistema espera os índices das paradas intermediárias na ordem em que aparecem no trajeto otimizado
            const optimizedIntermediateWaypointIndex = trip.locations
                .slice(1, -1) // Remove origin e destination
                .map((loc: any) => parseInt(loc.name, 10));

            // Consolida todos os pontos de todas as pernas em uma única polyline contínua
            const allPoints = legs.flatMap((leg: IComputeRoutesLeg) => polyline.decode(leg.polyline.encodedPolyline, 5));
            const fullEncodedPolyline = polyline.encode(allPoints, 5);

            const totalDistanceMeters = Math.round(trip.summary.length * 1000);
            const totalDurationSeconds = this.applyFloorSpeed(totalDistanceMeters, Math.round(trip.summary.time));

            return success({
                routes: [
                    {
                        distanceMeters: totalDistanceMeters,
                        duration: `${totalDurationSeconds}s`,
                        polyline: { encodedPolyline: fullEncodedPolyline },
                        optimizedIntermediateWaypointIndex,
                        legs,
                    },
                ],
            });
        } catch (error: any) {
            console.error('[Valhalla] Error in computeRoutes:', error.message);
            if (error.response?.data) {
                console.error('[Valhalla] Error detail:', JSON.stringify(error.response.data));
            }
            if (error.response?.data?.error_code === VALHALLA_NO_PATH_ERROR_CODE) {
                return fail(new NoRouteFoundError(`[Valhalla] No path found: ${error.response.data.error}`));
            }
            return fail(error);
        }
    }

    async computeRoute(
        origin: Coordinates,
        destination: Coordinates,
        travelMode: TravelModes = TravelModes.drive
    ): Promise<Result<IComputeRouteResponse>> {
        try {
            const costing = travelMode === TravelModes.walk ? 'pedestrian' : 'auto';
            const locations = [
                { lat: origin[0], lon: origin[1], type: 'break' },
                { lat: destination[0], lon: destination[1], type: 'break' },
            ];

            const json = {
                locations,
                costing,
                units: 'km',
            };

            const response = await this.axios.post('/route', json);
            this.calls++;

            const trip = response.data.trip;
            const encodedPolyline = trip.legs[0].shape;
            const distanceMeters = Math.round(trip.summary.length * 1000);
            const rawDuration = Math.round(trip.summary.time);
            const durationSeconds = travelMode === TravelModes.walk
                ? rawDuration
                : this.applyFloorSpeed(distanceMeters, rawDuration);
            const duration = `${durationSeconds}s`;

            return success({
                routes: [
                    {
                        distanceMeters,
                        duration,
                        polyline: { encodedPolyline: this.normalizePolyline(encodedPolyline) },
                    },
                ],
            });
        } catch (error: any) {
            console.error('[Valhalla] Error in computeRoute:', error.message);
            if (error.response?.data?.error_code === VALHALLA_NO_PATH_ERROR_CODE) {
                return fail(new NoRouteFoundError(`[Valhalla] No path found: ${error.response.data.error}`));
            }
            return fail(error);
        }
    }

    async computeDistanceMatrix(
        origins: Coordinates[],
        destinations: Coordinates[]
    ): Promise<Result<IComputeDistanceMatrixResponse[]>> {
        try {
            const sources = origins.map((o) => ({ lat: o[0], lon: o[1] }));
            const targets = destinations.map((d) => ({ lat: d[0], lon: d[1] }));

            const json = {
                sources,
                targets,
                costing: 'auto',
                units: 'km',
            };

            const response = await this.axios.post('/sources_to_targets', json);
            this.calls++;

            // Valhalla returns:
            // { "sources_to_targets": [ [ { "distance": 1.2, "time": 100, "to_index": 0, "from_index": 0 } ... ] ... ] }
            // Matrix de Sources (linhas) para Targets (colunas)

            const matrix = response.data.sources_to_targets;
            const result: IComputeDistanceMatrixResponse[] = [];

            matrix.forEach((row: any[], originIndex: number) => {
                row.forEach((cell: any) => {
                    const isValid = cell.distance !== null && cell.distance !== undefined && cell.time !== null && cell.time !== undefined;
                    const distanceMeters = isValid ? Math.round(cell.distance * 1000) : 0;
                    const rawDuration = isValid ? Math.round(cell.time) : 0;
                    const durationSeconds = isValid ? this.applyFloorSpeed(distanceMeters, rawDuration) : 0;

                    result.push({
                        originIndex,
                        destinationIndex: cell.to_index,
                        status: { message: 'OK' },
                        condition: isValid ? 'ROUTE_EXISTS' : 'ROUTE_NOT_FOUND',
                        distanceMeters,
                        duration: `${durationSeconds}s`,
                    });
                });
            });

            await this.recoverMissingMatrixCells(result, origins, destinations);
            return success(result);

        } catch (error: any) {
            if (VALHALLA_MATRIX_CELL_ERROR_CODES.includes(error.response?.data?.error_code)) {
                const result: IComputeDistanceMatrixResponse[] = origins.flatMap((_, originIndex) =>
                    destinations.map((__, destinationIndex) => ({
                        originIndex,
                        destinationIndex,
                        status: { message: 'OK' },
                        condition: 'ROUTE_NOT_FOUND' as const,
                        distanceMeters: 0,
                        duration: '0s',
                    }))
                );

                await this.recoverMissingMatrixCells(result, origins, destinations);
                return success(result);
            }

            console.error('[Valhalla] Error computing matrix:', error.message);
            return fail(error);
        }
    }

    private async recoverMissingMatrixCells(
        cells: IComputeDistanceMatrixResponse[],
        origins: Coordinates[],
        destinations: Coordinates[]
    ): Promise<void> {
        const missingCells = cells.filter((cell) => cell.condition === 'ROUTE_NOT_FOUND');
        if (!missingCells.length) return;

        const limit = pLimit(3);
        let recovered = 0;

        await Promise.all(missingCells.map((cell) => limit(async () => {
            const routeResult = await this.computeRoute(origins[cell.originIndex], destinations[cell.destinationIndex]);
            if (routeResult.fail()) return;

            const route = routeResult.result.routes[0];
            if (!route?.distanceMeters) return;

            cell.condition = 'ROUTE_EXISTS';
            cell.distanceMeters = route.distanceMeters;
            cell.duration = route.duration;
            recovered++;
        })));

        console.log(`[Valhalla] Matrix fallback via /route: ${recovered} de ${missingCells.length} células sem rota recuperadas`);
    }

    /**
     * Valida se o veículo consegue passar pela rota chamando o Valhalla Route API
     * com os parâmetros físicos do veículo.
     */
    async validateRouteRestriction(
        origin: Coordinates,
        destination: Coordinates,
        intermediates: Coordinates[],
        vehicleProfile: IVehicleProfile
    ): Promise<Result<boolean>> {
        try {
            console.log('[Valhalla DEBUG] validateRouteRestriction called with:', {
                origin,
                destination,
                intermediatesCount: intermediates.length,
                vehicleProfile: {
                    type: vehicleProfile.type,
                    height: vehicleProfile.height,
                    width: vehicleProfile.width,
                    weight: vehicleProfile.weight,
                    length: vehicleProfile.length
                }
            });

            if (!origin || !destination || origin.length !== 2 || destination.length !== 2) {
                console.warn('[Valhalla] Invalid origin or destination coordinates, skipping validation');
                return success(true);
            }

            if (origin[0] === destination[0] && origin[1] === destination[1]) {
                console.warn('[Valhalla] Origin and destination are identical, skipping validation');
                return success(true);
            }

            const locations = [
                { lat: origin[0], lon: origin[1], type: 'break' },
                ...intermediates.map((i) => ({ lat: i[0], lon: i[1], type: 'break' })),
                { lat: destination[0], lon: destination[1], type: 'break' },
            ];

            if (locations.length < 2) {
                console.warn('[Valhalla] Insufficient locations for route validation');
                return success(true);
            }

            const costingMap: Record<string, string> = {
                'bus': 'bus',
                'truck': 'truck',
                'pedestrian': 'pedestrian',
                'bicycle': 'bicycle',
                'auto': 'auto',
                'taxi': 'auto'
            };
            const costing = costingMap[vehicleProfile.type] || 'auto';

            const json = {
                locations,
                costing,
                costing_options: {
                    [costing]: {
                        height: vehicleProfile.height,
                        width: vehicleProfile.width,
                        weight: vehicleProfile.weight,
                        length: vehicleProfile.length,
                    },
                },
                directions_options: {
                    units: 'km',
                }
            };

            const response = await this.axios.post('/route', json);
            this.calls++;

            if (response.data && response.data.trip && response.data.trip.status === 0) {
                return success(true);
            }

            return success(false);

        } catch (error: any) {
            if (error.response && (error.response.status === 400 || error.response.status === 404)) {
                console.warn('Valhalla rejected route:', error.response.data);
                return success(false);
            }

            console.error('Error calling Valhalla validation:', error.message);
            return fail(error);
        }
    }
}

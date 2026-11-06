import { Coordinates } from '@data/coordinates';
import { Result } from '@data/result';
import {
    IComputeDistanceMatrixResponse,
    IComputeRouteResponse,
    IComputeRoutesResponse,
    TravelModes,
} from './dtos';

export interface IRoutesProvider {
    /**
     * Calcula rotas complexas, possivelmente com múltiplos pontos intermediários.
     * Usado para a roteirização principal.
     */
    computeRoutes(
        origin: Coordinates,
        destination: Coordinates,
        intermediates: Coordinates[],
        departureTime: string,
    ): Promise<Result<IComputeRoutesResponse>>;

    /**
     * Calcula uma rota simples entre dois pontos.
     */
    computeRoute(
        origin: Coordinates,
        destination: Coordinates,
        travelMode: TravelModes,
    ): Promise<Result<IComputeRouteResponse>>;

    /**
     * Calcula matriz de distâncias (N x M).
     * Usado para validação massiva de endereços.
     */
    computeDistanceMatrix(
        origins: Coordinates[],
        destinations: Coordinates[],
    ): Promise<Result<IComputeDistanceMatrixResponse[]>>;

    /**
     * Valida se o trajeto entre os pontos é viável para um determinado perfil de veículo.
     * Geralmente tenta calcular a rota considerando as restrições físicas do veículo e verifica sucesso.
     */
    validateRouteRestriction?(
        origin: Coordinates,
        destination: Coordinates,
        intermediates: Coordinates[],
        vehicleProfile: IVehicleProfile
    ): Promise<Result<boolean>>;

    // Constantes de Limites
    readonly COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS: number;
    readonly COMPUTE_DISTANCE_MATRIX_MAX_ELEMENTS: number;

    // Telemetria e Custos
    calls: number;
    retries: number;
    cost: { routes: number; routesMatrix: number };
}

export interface IVehicleProfile {
    height?: number;
    width?: number;
    weight?: number; // em toneladas ou kg, dependendo do provider. Padronizar para Metros e Toneladas.
    length?: number;
    type: 'bus' | 'auto' | 'taxi' | 'truck' | 'bicycle' | 'pedestrian';
}

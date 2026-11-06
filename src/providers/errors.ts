/**
 * O provedor respondeu, mas não existe trajeto de carro entre os pontos
 * (ex.: endereço em estrada que o mapa do provedor não conecta à malha viária).
 */
export class NoRouteFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'NoRouteFoundError';
    }
}

export function isNoRouteFoundError(error: unknown): error is NoRouteFoundError {
    return error instanceof NoRouteFoundError;
}

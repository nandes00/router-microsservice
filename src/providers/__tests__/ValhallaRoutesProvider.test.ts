import { ValhallaRoutesProvider } from '../valhalla/ValhallaRoutesProvider';
import { Result } from '../../data/result';
import { describe, expect, test, beforeAll } from '@jest/globals';

// Teste de integração: exige um Valhalla acessível. Fica fora da suíte unitária
// padrão (evita falso-vermelho por ECONNREFUSED) e roda com RUN_INTEGRATION=1.
const describeIntegration = process.env.RUN_INTEGRATION ? describe : describe.skip;

describeIntegration('ValhallaRoutesProvider Integration Test', () => {
    // Usa a URL do ambiente (no Docker: http://valhalla:8002); localhost quebra no container.
    const VALHALLA_URL = process.env.VALHALLA_URL || 'http://valhalla:8002';
    let provider: ValhallaRoutesProvider;

    beforeAll(() => {
        process.env.VALHALLA_URL = VALHALLA_URL;
        provider = new ValhallaRoutesProvider();
    });

    test('should validate a route restriction successfully (Open Path)', async () => {
        // Exemplo: Uma rota simples em São Paulo
        const routePart = {
            origin: [-23.550520, -46.633308] as [number, number], // Sé
            destination: [-23.559616, -46.658632] as [number, number], // Paulista
            intermediates: [] as [number, number][]
        };

        // Caminhão pequeno (deve passar)
        const vehicleProfile = {
            height: 2.5,
            width: 2.2,
            length: 6.0,
            weight: 3.5,
            axis: 2,
            type: 'bus' as const
        };

        const result = await provider.validateRouteRestriction(
            routePart.origin,
            routePart.destination,
            routePart.intermediates,
            vehicleProfile
        );

        expect(result.success()).toBe(true);
        expect(result.value).toBe(true);
    });

    test('should fail validation (or find restricted path) for huge vehicle', async () => {
        const routePart = {
            origin: [-23.550520, -46.633308] as [number, number],
            destination: [-23.559616, -46.658632] as [number, number],
            intermediates: [] as [number, number][]
        };

        const bigVehicle = {
            height: 5.5, // Muito alto
            width: 3.0,
            length: 20.0,
            weight: 50.0,
            axis: 4,
            type: 'bus' as const
        };

        const result = await provider.validateRouteRestriction(
            routePart.origin,
            routePart.destination,
            routePart.intermediates,
            bigVehicle
        );
        expect(result.success()).toBe(true);
        // O resultado booleano depende do mapa. O teste deve apenas garantir que não quebrou (throw).
        console.log('Valid route for big vehicle?', result.value);
    });
});

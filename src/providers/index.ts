import { GoogleRoutesProvider } from './google/GoogleRoutesProvider';
import { IRoutesProvider } from './interfaces/IRoutesProvider';
import { ValhallaRoutesProvider } from './valhalla/ValhallaRoutesProvider';

export class RoutesProviderFactory {
    static getRoutingProvider(): IRoutesProvider {
        if (process.env.ROUTING_PROVIDER === 'valhalla') {
            console.log('[Factory] Using Valhalla for Routing');
            return new ValhallaRoutesProvider();
        }
        console.log('[Factory] Using Google Maps for Routing');
        return new GoogleRoutesProvider();
    }

    static getMatrixProvider(): IRoutesProvider {
        if (process.env.MATRIX_PROVIDER === 'valhalla') {
            console.log('[Factory] Using Valhalla for Distance Matrix');
            return new ValhallaRoutesProvider();
        }
        console.log('[Factory] Using Google Maps for Distance Matrix');
        return new GoogleRoutesProvider();
    }

    static getValidationProvider(): IRoutesProvider {
        return new ValhallaRoutesProvider();
    }
}

import { IVehicle } from '../services/calculateRoute/interfaces';
import { IVehicleProfile } from '../providers/interfaces/IRoutesProvider';

export function mapVehicleToProfile(vehicle: IVehicle): IVehicleProfile {
    const type = 'bus';

    let height = 3.2;
    let width = 2.5;
    let length = 10;
    let weight = 15;

    const kind = vehicle.kind.toLowerCase();

    if (kind.includes('micro') || vehicle.capacity < 20) {
        height = 2.8;
        width = 2.2;
        length = 7;
        weight = 5;
    } else if (kind.includes('pequeno') || vehicle.capacity < 30) {
        height = 3.0;
        width = 2.4;
        length = 9;
        weight = 8;
    } else if (kind.includes('médio') || kind.includes('medio') || vehicle.capacity < 45) {
        height = 3.2;
        width = 2.5;
        length = 11;
        weight = 12;
    } else if (kind.includes('articulado') || vehicle.capacity > 60) {
        height = 3.4;
        width = 2.6;
        length = 18;
        weight = 20;
    }

    return {
        type,
        height,
        width,
        length,
        weight,
    };
}

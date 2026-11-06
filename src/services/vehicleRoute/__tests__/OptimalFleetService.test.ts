import { describe, expect, it } from '@jest/globals';
import { OptimalFleetService } from '@services/vehicleRoute/OptimalFleetService';
import {
  ICalculateRouteConfig,
  IRouteData,
  IVehicle,
} from '@services/calculateRoute/interfaces';

const vehicle = (o: Partial<IVehicle>): IVehicle => ({
  capacity: 40,
  kind: 'vehicle',
  vehicleTypeId: 1,
  wheelchairSectionCapacity: 0,
  ...o,
});

const route = (o: Partial<IRouteData>): IRouteData =>
({
  studentsCapacity: 0,
  distancePercentage: 0,
  durationPercentage: 0,
  students: 0,
  wheelchairStudentsQuantity: 0,
  wheelchairStudentsCapacity: 0,
  route: {},
  ...o,
} as unknown as IRouteData);

const config = (vehicles: IVehicle[]): ICalculateRouteConfig =>
  ({ vehicles } as unknown as ICalculateRouteConfig);

describe('OptimalFleetService — priorização da frota própria', () => {
  it('usa o veículo próprio quando o tipo está barrier-allowed, mesmo sem terceirizados (regressão)', () => {
    const own = vehicle({ vehicleTypeId: 13, kind: 'V10', capacity: 77 });
    const r = route({ students: 7, allowedOwnTypeIds: new Set([13]), validVehicles: [] });

    const { lines, unusedVehicles } = new OptimalFleetService([r], [own], config([])).execute();

    expect(lines[0].vehicle).toBe(own);
    expect(unusedVehicles).toHaveLength(0);
  });

  it('permite o próprio quando não há restrição de barreira computada (allowedOwnTypeIds indefinido)', () => {
    const own = vehicle({ vehicleTypeId: 13, capacity: 77 });
    const r = route({ students: 5 });

    const { lines } = new OptimalFleetService([r], [own], config([])).execute();

    expect(lines[0].vehicle).toBe(own);
  });

  it('rejeita o próprio quando o tipo está barrado por barreira e cai para o terceirizado', () => {
    const own = vehicle({ vehicleTypeId: 13, kind: 'V10', capacity: 77 });
    const rented = vehicle({ vehicleTypeId: 1, kind: 'terceirizado', capacity: 44 });
    const r = route({ students: 7, allowedOwnTypeIds: new Set<number>() }); // tipo 13 barrado

    const { lines, unusedVehicles } = new OptimalFleetService([r], [own], config([rented])).execute();

    expect(lines[0].vehicle.vehicleTypeId).toBe(1);
    expect(unusedVehicles).toContain(own);
  });

  it('mantém o fallback terceirizado quando não há frota própria (sem regressão)', () => {
    const rented = vehicle({ vehicleTypeId: 1, kind: 'terceirizado', capacity: 44 });
    const r = route({ students: 10, validVehicles: [rented] });

    const { lines } = new OptimalFleetService([r], [], config([rented])).execute();

    expect(lines[0].vehicle.vehicleTypeId).toBe(1);
  });

  it('lança mensagem de frota própria insuficiente quando não há veículo nem terceirizado', () => {
    const own = vehicle({ vehicleTypeId: 13, capacity: 2 });
    const r = route({ students: 7, allowedOwnTypeIds: new Set([13]) });

    expect(() => new OptimalFleetService([r], [own], config([])).execute())
      .toThrow(/Frota própria insuficiente/);
  });

  it('não aloca veículo com capacidade menor que o número de alunos quando rota excede todos os veículos válidos', () => {
    const v3 = vehicle({ vehicleTypeId: 4, kind: 'V3', capacity: 15 });
    const v4 = vehicle({ vehicleTypeId: 5, kind: 'V4', capacity: 11 });
    const r = route({ students: 16, validVehicles: [v4, v3] });

    expect(() => new OptimalFleetService([r], [], config([v4, v3])).execute())
      .toThrow(/Não foi possível encontrar um veículo compatível para a rota 0/);
  });

  it('sincroniza o número real de alunos a partir dos stopPoints quando routeData.students está desatualizado', () => {
    const v1 = vehicle({ vehicleTypeId: 1, kind: 'V1', capacity: 44 });
    const v2 = vehicle({ vehicleTypeId: 3, kind: 'V2', capacity: 24 });

    const stopPointWithStudents = {
      coordinates: [0, 0] as [number, number],
      students: Array.from({ length: 34 }, (_, i) => ({ id: i + 1, usesWheelchair: false })),
    };

    const r = route({
      students: 20,
      validVehicles: [v2, v1],
      route: {
        forwardRoute: {
          stopPoints: [stopPointWithStudents],
        },
      } as any,
    });

    const { lines } = new OptimalFleetService([r], [], config([v2, v1])).execute();

    expect(lines[0].vehicle.vehicleTypeId).toBe(1);
    expect(lines[0].vehicle.capacity).toBe(44);
  });
});


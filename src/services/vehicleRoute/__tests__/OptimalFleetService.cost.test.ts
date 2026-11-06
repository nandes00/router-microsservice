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

describe('OptimalFleetService — Otimização de Custo e Acessibilidade', () => {
  it('aloca V7 em vez de V9 para rota com 1 cadeirante e 3 sentados quando V7 é mais barato', () => {
    // Cenário idêntico ao Relatório Geral 77
    const v6 = vehicle({
      vehicleTypeId: 7,
      kind: 'V6 - Van 2 sentados 1 cadeirante',
      capacity: 2,
      wheelchairSectionCapacity: 1,
      cost: 1390.95,
    });
    const v7 = vehicle({
      vehicleTypeId: 8,
      kind: 'V7 - Van 8 sentados 2 cadeirantes',
      capacity: 8,
      wheelchairSectionCapacity: 2,
      cost: 1931.52,
    });
    const v8 = vehicle({
      vehicleTypeId: 13,
      kind: 'V8 - Van 4 sentados 3 cadeirantes',
      capacity: 4,
      wheelchairSectionCapacity: 3,
      cost: 1954.14,
    });
    const v9 = vehicle({
      vehicleTypeId: 14,
      kind: 'V9 - Micro 4x4 14 sentados 1 cadeirante',
      capacity: 14,
      wheelchairSectionCapacity: 1,
      cost: 2532.83,
    });

    const configuredFleet = [v6, v7, v8, v9];
    // Rota com 4 alunos: 1 cadeirante + 3 sentados
    const r = route({
      students: 4,
      wheelchairStudentsQuantity: 1,
      validVehicles: configuredFleet,
    });

    const { lines } = new OptimalFleetService([r], [], config(configuredFleet)).execute();

    expect(lines).toHaveLength(1);
    // V6 é descartado porque capacity=2 não atende 4 alunos (3 sentados)
    // Entre V7 (R$ 1.931), V8 (R$ 1.954) e V9 (R$ 2.532), o algoritmo deve escolher V7 (mais barato)
    expect(lines[0].vehicle.vehicleTypeId).toBe(8);
    expect(lines[0].vehicle.cost).toBe(1931.52);
  });

  it('aloca V6 quando há apenas 1 cadeirante e 1 sentado (V6 atende e é o mais barato)', () => {
    const v6 = vehicle({
      vehicleTypeId: 7,
      kind: 'V6',
      capacity: 2,
      wheelchairSectionCapacity: 1,
      cost: 1390.95,
    });
    const v7 = vehicle({
      vehicleTypeId: 8,
      kind: 'V7',
      capacity: 8,
      wheelchairSectionCapacity: 2,
      cost: 1931.52,
    });

    const configuredFleet = [v6, v7];
    const r = route({
      students: 2,
      wheelchairStudentsQuantity: 1,
      validVehicles: configuredFleet,
    });

    const { lines } = new OptimalFleetService([r], [], config(configuredFleet)).execute();

    expect(lines).toHaveLength(1);
    expect(lines[0].vehicle.vehicleTypeId).toBe(7);
    expect(lines[0].vehicle.cost).toBe(1390.95);
  });

  it('em frotas sem custo cadastrado, desempata pelo menor sobredimensionamento de cadeirantes e assentos', () => {
    const vA = vehicle({
      vehicleTypeId: 101,
      kind: 'Van A',
      capacity: 8,
      wheelchairSectionCapacity: 1,
    });
    const vB = vehicle({
      vehicleTypeId: 102,
      kind: 'Van B',
      capacity: 15,
      wheelchairSectionCapacity: 1,
    });

    const configuredFleet = [vB, vA];
    const r = route({
      students: 5,
      wheelchairStudentsQuantity: 1,
      validVehicles: configuredFleet,
    });

    const { lines } = new OptimalFleetService([r], [], config(configuredFleet)).execute();

    expect(lines).toHaveLength(1);
    expect(lines[0].vehicle.vehicleTypeId).toBe(101);
  });

  it('para rota regular sem cadeirante, prioriza menor custo entre veículos convencionais', () => {
    const v5 = vehicle({
      vehicleTypeId: 6,
      kind: 'V5 - Minivan 7 sentados',
      capacity: 7,
      wheelchairSectionCapacity: 0,
      cost: 1120.70,
    });
    const v4 = vehicle({
      vehicleTypeId: 5,
      kind: 'V4 - Van 11 sentados',
      capacity: 11,
      wheelchairSectionCapacity: 0,
      cost: 1592.68,
    });
    const v7Adapted = vehicle({
      vehicleTypeId: 8,
      kind: 'V7 - Adaptada 8 sentados',
      capacity: 8,
      wheelchairSectionCapacity: 2,
      cost: 1931.52,
    });

    const configuredFleet = [v7Adapted, v4, v5];
    const r = route({
      students: 6,
      wheelchairStudentsQuantity: 0,
      validVehicles: configuredFleet,
    });

    const { lines } = new OptimalFleetService([r], [], config(configuredFleet)).execute();

    expect(lines).toHaveLength(1);
    // Deve escolher V5 por ser não-adaptado e mais barato
    expect(lines[0].vehicle.vehicleTypeId).toBe(6);
    expect(lines[0].vehicle.cost).toBe(1120.70);
  });

  it('aloca V8 como veículo único para rota com 3 cadeirantes e 3 sentados (total 6), sem dividir a rota indevidamente', () => {
    // Cenário real do Relatório 78/79 (Linha 3000):
    // 3 cadeirantes e 3 regulares (total 6).
    // V8 tem 4 sentados e 3 cadeirantes (total 7). Deve caber perfeitamente no V8 como linha única!
    const v6 = vehicle({
      vehicleTypeId: 7,
      kind: 'V6 - Van 2 sentados 1 cadeirante',
      capacity: 2,
      wheelchairSectionCapacity: 1,
      cost: 1390.95,
    });
    const v7 = vehicle({
      vehicleTypeId: 8,
      kind: 'V7 - Van 8 sentados 2 cadeirantes',
      capacity: 8,
      wheelchairSectionCapacity: 2,
      cost: 1931.52,
    });
    const v8 = vehicle({
      vehicleTypeId: 13,
      kind: 'V8 - Van 4 sentados 3 cadeirantes',
      capacity: 4,
      wheelchairSectionCapacity: 3,
      cost: 1954.14,
    });
    const v9 = vehicle({
      vehicleTypeId: 14,
      kind: 'V9 - Micro 4x4 14 sentados 1 cadeirante',
      capacity: 14,
      wheelchairSectionCapacity: 1,
      cost: 2532.83,
    });

    const configuredFleet = [v6, v7, v8, v9];
    const r = route({
      students: 6,
      wheelchairStudentsQuantity: 3,
      validVehicles: configuredFleet,
      route: {
        forwardRoute: {
          stopPoints: [
            { students: [{ id: 1, usesWheelchair: true }, { id: 2, usesWheelchair: false }] },
            { students: [{ id: 3, usesWheelchair: true }, { id: 4, usesWheelchair: false }] },
            { students: [{ id: 5, usesWheelchair: true }, { id: 6, usesWheelchair: false }] },
          ],
        },
      } as any,
    });

    const { lines } = new OptimalFleetService([r], [], config(configuredFleet)).execute();

    // Deve gerar APENAS 1 linha com V8, sem dividir a rota nem alocar V6 extra
    expect(lines).toHaveLength(1);
    expect(lines[0].vehicle.vehicleTypeId).toBe(13); // V8
    expect(lines[0].vehicle.capacity).toBe(4);
    expect(lines[0].vehicle.wheelchairSectionCapacity).toBe(3);
  });

  it('aloca V8 no limite nominal máximo (3 cadeirantes e 4 sentados = 7 alunos) como veículo único', () => {
    const v8 = vehicle({
      vehicleTypeId: 13,
      kind: 'V8',
      capacity: 4,
      wheelchairSectionCapacity: 3,
      cost: 1954.14,
    });

    const configuredFleet = [v8];
    const r = route({
      students: 7,
      wheelchairStudentsQuantity: 3,
      validVehicles: configuredFleet,
      route: {
        forwardRoute: {
          stopPoints: [
            { students: [{ id: 1, usesWheelchair: true }, { id: 2, usesWheelchair: true }, { id: 3, usesWheelchair: true }] },
            { students: [{ id: 4, usesWheelchair: false }, { id: 5, usesWheelchair: false }, { id: 6, usesWheelchair: false }, { id: 7, usesWheelchair: false }] },
          ],
        },
      } as any,
    });

    const { lines } = new OptimalFleetService([r], [], config(configuredFleet)).execute();

    expect(lines).toHaveLength(1);
    expect(lines[0].vehicle.vehicleTypeId).toBe(13);
  });

  it('quando rota realmente excede a capacidade do veículo adaptado (ex: 3 cadeirantes e 5 sentados = 8 alunos), preenche o V8 até 4 sentados e divide apenas o excedente', () => {
    const v6 = vehicle({
      vehicleTypeId: 7,
      kind: 'V6',
      capacity: 2,
      wheelchairSectionCapacity: 1,
      cost: 1390.95,
    });
    const v8 = vehicle({
      vehicleTypeId: 13,
      kind: 'V8',
      capacity: 4,
      wheelchairSectionCapacity: 3,
      cost: 1954.14,
    });

    const configuredFleet = [v6, v8];
    // 3 cadeirantes + 5 sentados = 8 alunos (V8 só cabe 7: 3 cadeirantes + 4 sentados)
    const r = route({
      students: 8,
      wheelchairStudentsQuantity: 3,
      validVehicles: configuredFleet,
      route: {
        forwardRoute: {
          stopPoints: [
            { students: [{ id: 1, usesWheelchair: true }, { id: 2, usesWheelchair: false }] },
            { students: [{ id: 3, usesWheelchair: true }, { id: 4, usesWheelchair: false }] },
            { students: [{ id: 5, usesWheelchair: true }, { id: 6, usesWheelchair: false }] },
            { students: [{ id: 7, usesWheelchair: false }, { id: 8, usesWheelchair: false }] },
          ],
        },
      } as any,
    });

    const { lines } = new OptimalFleetService([r], [], config(configuredFleet)).execute();

    // Deve dividir em 2 linhas:
    // Linha 1 (V8): 3 cadeirantes + 4 sentados (total 7 alunos)
    // Linha 2 (V6): 1 aluno sentado restante
    expect(lines).toHaveLength(2);
    expect(lines[0].vehicle.vehicleTypeId).toBe(13); // V8
    const wcLineStudents = (lines[0].forwardRoute?.stopPoints || []).flatMap((sp: any) => sp.students);
    expect(wcLineStudents).toHaveLength(7);
    expect(wcLineStudents.filter((s: any) => s.usesWheelchair)).toHaveLength(3);
    expect(wcLineStudents.filter((s: any) => !s.usesWheelchair)).toHaveLength(4);

    expect(lines[1].vehicle.vehicleTypeId).toBe(7); // V6
    const regLineStudents = (lines[1].forwardRoute?.stopPoints || []).flatMap((sp: any) => sp.students);
    expect(regLineStudents).toHaveLength(1);
    expect(regLineStudents[0].usesWheelchair).toBe(false);
  });
});


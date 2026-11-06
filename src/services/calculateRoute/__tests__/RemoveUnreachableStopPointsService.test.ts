import { describe, expect, it, jest } from '@jest/globals';
import { RemoveUnreachableStopPointsService } from '../removeUnreachableStopPointsService';
import { Coordinates } from '../../../data/coordinates';
import { fail, success } from '../../../data/result';
import { NoRouteFoundError } from '../../../providers/errors';
import { IRoutesProvider } from '../../../providers/interfaces/IRoutesProvider';
import { ExcludedReasonEnum, ISchoolLocation, IStopPoint, IStudentData } from '../interfaces';

const UNREACHABLE: Coordinates = [-22.78786597, -49.1145962];

const school: ISchoolLocation = { id: 1, coordinates: [-22.7567385, -49.1368652] };

const mockStudent = (id: number, coordinates: Coordinates): IStudentData => ({
  id,
  coordinates,
  schoolId: school.id,
  reason: 'countryside',
  usesWheelchair: false,
  specialNeed: false,
  arrivalTime: '2026-10-06T07:00:00Z',
  departureTime: '2026-10-06T12:00:00Z',
  distance: 1000,
  duration: 300,
  stopPointDistance: 50,
});

const isSame = (a: Coordinates, b: Coordinates) => a[0] === b[0] && a[1] === b[1];

const mockProvider = (unreachable: Coordinates[], error: Error = new NoRouteFoundError('no route')) => {
  const computeRoute = jest.fn(async (origin: Coordinates, destination: Coordinates) => {
    if (unreachable.some((point) => isSame(point, origin) || isSame(point, destination))) return fail(error);
    return success({ routes: [{ distanceMeters: 1000, duration: '60s', polyline: { encodedPolyline: '' } }] });
  });

  return { provider: { computeRoute } as unknown as IRoutesProvider, computeRoute };
};

describe('RemoveUnreachableStopPointsService', () => {
  it('mantém pontos de parada alcançáveis sem alterações', async () => {
    const stopPoint: IStopPoint = { coordinates: [-22.74, -49.13], students: [mockStudent(1, [-22.74, -49.13])] };
    const { provider, computeRoute } = mockProvider([]);

    const service = new RemoveUnreachableStopPointsService([stopPoint], [school], provider, ['forward', 'back']);

    expect(await service.execute()).toEqual([stopPoint]);
    expect(service.excludedStudents).toEqual([]);
    expect(computeRoute).toHaveBeenCalledTimes(2);
  });

  it('exclui como endereço inválido o aluno sem trajeto e separa os demais alunos do ponto', async () => {
    const reachableStudent = mockStudent(2, [-22.75, -49.12]);
    const stopPoint: IStopPoint = { coordinates: UNREACHABLE, students: [mockStudent(1, UNREACHABLE), reachableStudent] };
    const { provider } = mockProvider([UNREACHABLE]);

    const service = new RemoveUnreachableStopPointsService([stopPoint], [school], provider, ['forward', 'back']);
    const result = await service.execute();

    expect(result).toEqual([{ coordinates: reachableStudent.coordinates, students: [{ ...reachableStudent, stopPointDistance: 0 }] }]);
    expect(service.excludedStudents).toHaveLength(1);
    expect(service.excludedStudents[0]).toMatchObject({ id: 1, excludedReason: ExcludedReasonEnum.invalidAddress });
    expect(service.excludedStudents[0]).not.toHaveProperty('stopPointDistance');
  });

  it('desmembra ponto agrupado quando o ponto não tem trajeto mas ambos os alunos têm, sem excluir ninguém', async () => {
    const reachableStudent1 = mockStudent(1, [-22.75, -49.12]);
    const reachableStudent2 = mockStudent(2, [-22.76, -49.11]);
    const stopPoint: IStopPoint = { coordinates: UNREACHABLE, students: [reachableStudent1, reachableStudent2] };
    const { provider } = mockProvider([UNREACHABLE]);

    const service = new RemoveUnreachableStopPointsService([stopPoint], [school], provider, ['forward', 'back']);
    const result = await service.execute();

    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { coordinates: reachableStudent1.coordinates, students: [{ ...reachableStudent1, stopPointDistance: 0 }] },
      { coordinates: reachableStudent2.coordinates, students: [{ ...reachableStudent2, stopPointDistance: 0 }] },
    ]);
    expect(service.excludedStudents).toHaveLength(0);
  });

  it('não exclui alunos quando a falha não é ausência de trajeto', async () => {
    const stopPoint: IStopPoint = { coordinates: UNREACHABLE, students: [mockStudent(1, UNREACHABLE)] };
    const { provider } = mockProvider([UNREACHABLE], new Error('Request failed with status code 429'));

    const service = new RemoveUnreachableStopPointsService([stopPoint], [school], provider, ['forward', 'back']);

    expect(await service.execute()).toEqual([stopPoint]);
    expect(service.excludedStudents).toEqual([]);
  });

  it('testa só o sentido da roteirização', async () => {
    const stopPoint: IStopPoint = { coordinates: [-22.74, -49.13], students: [mockStudent(1, [-22.74, -49.13])] };
    const { provider, computeRoute } = mockProvider([]);

    await new RemoveUnreachableStopPointsService([stopPoint], [school], provider, ['back']).execute();

    expect(computeRoute).toHaveBeenCalledTimes(1);
    expect(computeRoute.mock.calls[0][0]).toEqual(school.coordinates);
  });
});

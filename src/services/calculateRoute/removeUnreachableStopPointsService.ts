import { Coordinates } from '@data/coordinates';
import { isNoRouteFoundError } from '@providers/errors';
import { IRoutesProvider } from '@providers/interfaces/IRoutesProvider';
import { TravelModes } from '@providers/interfaces/dtos';
import { pLimit } from '@utils/promiseHelper';
import { ExcludedReasonEnum, IExcludedStudent, ISchoolLocation, IStopPoint, IStudentData } from './interfaces';

/**
 * Executado quando o provedor de rotas não encontra trajeto para um grupo de pontos de parada.
 * A validação de distância (matriz) pode usar outro provedor e aceitar endereços que o provedor
 * de rotas não alcança; sem esse tratamento um único ponto derruba a roteirização inteira.
 *
 * Testa cada ponto de parada isoladamente até a(s) escola(s) dos seus alunos. Pontos sem trajeto
 * têm seus alunos testados um a um: quem não tem trajeto é excluído como endereço inválido e quem
 * tem vira um ponto de parada próprio, na sua coordenada.
 */
export class RemoveUnreachableStopPointsService {
  readonly excludedStudents: IExcludedStudent[] = [];
  private readonly limit = pLimit(3);

  constructor(
    private readonly stopPoints: IStopPoint[],
    private readonly schools: ISchoolLocation[],
    private readonly routingProvider: IRoutesProvider,
    private readonly directions: string[],
  ) { }

  async execute(): Promise<IStopPoint[]> {
    const checkedStopPoints = await Promise.all(this.stopPoints.map((stopPoint) => this.checkStopPoint(stopPoint)));

    return checkedStopPoints.flat();
  }

  private async checkStopPoint(stopPoint: IStopPoint): Promise<IStopPoint[]> {
    if (await this.isReachable(stopPoint.coordinates, stopPoint.students)) return [stopPoint];

    const checkedStudents = await Promise.all(stopPoint.students.map(async (student) => ({
      student,
      reachable: await this.isReachable(student.coordinates, [student]),
    })));

    return checkedStudents.flatMap(({ student, reachable }) => {
      if (reachable) return [{ coordinates: student.coordinates, students: [{ ...student, stopPointDistance: 0 }] }];

      console.warn(`[UnreachableStopPoints] Student ${student.id} excluded: no route between ${student.coordinates} and school ${student.schoolId}`);
      this.excludedStudents.push({ ...this.withoutStopPointData(student), excludedReason: ExcludedReasonEnum.invalidAddress });
      return [];
    });
  }

  private async isReachable(coordinates: Coordinates, students: IStudentData[]): Promise<boolean> {
    const schoolIds = new Set(students.map((student) => student.schoolId));
    const legs = this.schools
      .filter((school) => schoolIds.has(school.id))
      .flatMap((school) => [
        ...(this.directions.includes('forward') ? [[coordinates, school.coordinates]] : []),
        ...(this.directions.includes('back') ? [[school.coordinates, coordinates]] : []),
      ]);

    const results = await Promise.all(legs.map(([origin, destination]) => this.limit(
      () => this.routingProvider.computeRoute(origin, destination, TravelModes.drive),
    )));

    // Só um "sem trajeto" explícito torna o ponto inalcançável; falhas transitórias (rede, cota) não excluem alunos.
    return results.every((result) => result.success() || !isNoRouteFoundError(result.error));
  }

  private withoutStopPointData({ stopPointDistance, ...student }: IStudentData) {
    return student;
  }
}

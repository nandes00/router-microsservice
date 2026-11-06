import { IRoutesProvider } from '@providers/interfaces/IRoutesProvider';
import { RoutesProviderFactory } from '@providers/index';
import { chunks } from '@data/array';
import { success, SuccessResult } from '@data/result';
import { ICalculateRouteConfig, ISchoolLocation, IStudentData, IStudent, IExcludedStudent, ExcludedReasonEnum } from './calculateRoute/interfaces';
import { parseMapsDuration } from '@utils/calculateRouteHelpers';
import { pLimit } from '@utils/promiseHelper';

interface ICalculateDistanceServiceResponse {
  validAddresses: IStudentData[]
  invalidAddresses: IExcludedStudent[]
}

// ###################################################### MELHORIA ######################################################
// Os usuários muitas vezes roteirizam o mesmo grupo de alunos varias vezes, e cada vez que uma roteirização é feita, é
// calculada a distancia do aluno até a escola dele, e teoricamente enquanto o aluno não mudar de endereço ou escola,
// esse valor não muda. Um ponto é que esse calculo é uma das partes mais caras da roteirização.
// O que da pra fazer, na hora da criação do aluno (e posteriormente quando puder editar) fazer esse calculo da distância
// dele até a escola e guardar, que dai quando for roteirizar não precisa calcular isso toda vez.
//
// Obs: Isso deixaria a importação de alunos mais lenta, então seria interessante ela acontecer de forma assincrona
// ######################################################################################################################

export class CalculateDistanceService {
  private readonly studentsChunks: IStudent[][];
  private readonly validAddresses: IStudentData[] = [];
  private readonly invalidAddresses: IExcludedStudent[] = [];

  constructor(
    studentsLocations: IStudent[],
    private readonly schoolLocation: ISchoolLocation,
    private readonly config: ICalculateRouteConfig,
    private readonly googleRoutesAPI: IRoutesProvider = RoutesProviderFactory.getMatrixProvider(),
  ) {
    this.studentsChunks = chunks(studentsLocations, this.googleRoutesAPI.COMPUTE_DISTANCE_MATRIX_MAX_ELEMENTS);
  }

  async execute(): Promise<SuccessResult<ICalculateDistanceServiceResponse>> {
    const limit = pLimit(3);
    await Promise.all(
      this.studentsChunks.map((students) => limit(() => this.checkDistances(students))),
    );

    return success({
      validAddresses: this.validAddresses,
      invalidAddresses: this.invalidAddresses,
    });
  }

  private async checkDistances(students: IStudent[]) {
    const addresses = students.map(student => student.coordinates);
    const distanceMatrixResult = await this.googleRoutesAPI.computeDistanceMatrix(
      addresses,
      [this.schoolLocation.coordinates],
    );

    if (distanceMatrixResult.fail()) {
      this.invalidAddresses.push(...students.map(student => ({ ...student, excludedReason: ExcludedReasonEnum.invalidAddress })));
      return;
    }

    const data = distanceMatrixResult.result;

    data.forEach((distanceData) => {
      const distance = distanceData.distanceMeters;
      const student = students[distanceData.originIndex];

      if (!distance || distanceData.condition !== 'ROUTE_EXISTS') {
        return this.invalidAddresses.push({ ...student, excludedReason: ExcludedReasonEnum.invalidAddress });
      }

      const duration = parseMapsDuration(distanceData.duration!);

      const location: IStudentData = {
        ...student,
        distance,
        duration,
      };

      // if (student.disability) {
      //   return this.validAddresses.push(location);
      // }

      // if (distance < this.config.minDistance) {
      //   return this.nearAddresses.push(location);
      // }

      // ################################################## MELHORIA ##################################################
      // Parar de marcar esses alunos que ultrapassar 70% do tempo/distância como inválidos e marcar eles diferentes
      // para que pós a roteirização do jeito que é hoje, tentar encaixar eles no final de alguma linha gerada, e se
      // não for possível, gerar roteirizações somente para eles.
      // ##############################################################################################################

      if (distance > this.config.maxDistance * 0.7) {
        return this.invalidAddresses.push({ ...location, excludedReason: ExcludedReasonEnum.disntace });
      } else if (duration > this.config.maxDuration * 0.7) {
        return this.invalidAddresses.push({ ...location, excludedReason: ExcludedReasonEnum.duration });
      }

      this.validAddresses.push(location);
    });
  }
}

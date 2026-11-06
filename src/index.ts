import './setup/env';
import axios from 'axios';
import { NODE_ENV } from '@env';
import { IRoutesProvider } from '@providers/interfaces/IRoutesProvider';
import { RoutesProviderFactory } from '@providers/index';
import { Handlers } from '@sentry/node';
import { CalculateDistanceService } from '@services/calculateDistancesService';
import { CalculateRouterizationService } from '@services/calculateRoute/calculateRouterizationService';
import { ICalculateRouteConfig, IRouterizationResponse, IStopPoint, IVehicle } from '@services/calculateRoute/interfaces';
import { RemoveUnreachableStopPointsService } from '@services/calculateRoute/removeUnreachableStopPointsService';
import { isNoRouteFoundError } from '@providers/errors';
import { ChunkSchoolsService } from '@services/chunkSchoolsService';
import { FindStopPointsService } from '@services/findStopPointsService';
import { GenerateKmlService } from '@services/generateKmlService';
import { RecalculateLineService } from '@services/reclaculateRoute/recalculateLineService';
import { NextFunction, Request, Response } from 'express';
import asyncHandler from './middlewares/asyncHandler';
import withSchema from './middlewares/withSchema';
import { calculateRouteRequestSchema } from './schemas/calculateRouteSchema';
import { generateKmlSchema } from './schemas/generateKmlSchema';
import { recalculateRouteRequestSchema } from './schemas/recalculateRoutesSchema';
import app from './server';
import { validarLatLongAlunoSchema } from './schemas/validarLatLongAlunoSchema';
import { ValidateLatLongService, ValidateResult } from '@services/validarLatLongAluno/validateLatLongService';
import { pLimit } from '@utils/promiseHelper';

const routerizationQueue = pLimit(
  parseInt(process.env.MAX_CONCURRENT_ROUTERIZATIONS || '1', 10)
);

app.get('/health_check', (req, res) => {
  res.send('still alive');
});

const defaultConfig: ICalculateRouteConfig = {
  maxDistance: 100 * 1000,
  maxDuration: 2 * 60 * 60,
  minDistance: 2 * 1000,
  schoolMaxDistance: 10 * 1000,
  averageStopDuration: 1 * 60,
  averageStopDurationWheelchair: 1 * 300,
  stopPointMaxDistanceType: 'walk',
  stopPointMaxDistance: 2 * 1000,
  vehicles: [
    { capacity: 19, kind: 'Micro-ônibus', wheelchairSectionCapacity: 0, max_capacity: false },
    { capacity: 29, kind: 'Ônibus pequeno', wheelchairSectionCapacity: 0, max_capacity: false },
    { capacity: 44, kind: 'Ônibus médio', wheelchairSectionCapacity: 0, max_capacity: false },
    { capacity: 59, kind: 'Ônibus grande', wheelchairSectionCapacity: 0, max_capacity: false },
    { capacity: 100, kind: 'Ônibus articulado', wheelchairSectionCapacity: 0, max_capacity: false },
  ],
  onlySchoolsWithStudent: false,
  activateGroupingOfSchoolsByArrivalTimes: true,
  maxToleranceBetweenArrivalTimes: 30 * 60,
  activateGroupingOfSchoolsByDepartureTimes: true,
  maxToleranceBetweenDepartureTimes: 30 * 60,
};

app.post(
  '/validate_latlong_students',
  asyncHandler(
    withSchema(validarLatLongAlunoSchema, async (req, res) => {
      const startTime = Date.now();
      const { distanciaMaxima, alunos } = req.body;
      const validateLatLongService = new ValidateLatLongService();
      const MAX_PARALLEL = 100;
      const checkedStudents: ({ id: number } & ValidateResult)[] = [];

      console.log('Iniciando validação');
      console.log(`Total Alunos: ${alunos.length}`);
      console.log(`Máximo de chamadas paralelas: ${MAX_PARALLEL}`);

      for (let i = 0; i < alunos.length; i += MAX_PARALLEL) {
        const batch = alunos.slice(i, i + MAX_PARALLEL);

        const results = await Promise.all(
          batch.map(async (aluno) => {
            const coordinates: [string, string] = [aluno.lat, aluno.long];
            const result = await validateLatLongService.execute(coordinates, aluno.endereco, distanciaMaxima);
            return { id: aluno.id, ...result };
          })
        );

        checkedStudents.push(...results);

        if (i + MAX_PARALLEL < alunos.length) {
          await new Promise((r) => setTimeout(r, 100));
        }
      }

      const endTime = Date.now();
      const executionTime = ((endTime - startTime) / 1000).toFixed(2);

      console.log(`Validação concluída! Tempo total de execução: ${executionTime}s`);
      console.log('Todas as validações foram finalizadas com sucesso.');

      res.send({ message: 'Requisição recebida com sucesso!', results: checkedStudents });
    })
  )
);

app.post(
  '/calculate_route',
  asyncHandler(
    withSchema(calculateRouteRequestSchema, async (req, res) => {
      req.setTimeout(5000000);
      const { async, callbackUrl } = req.body;

      const performCalculation = async (body: any) => {
        const mapProvider: IRoutesProvider = RoutesProviderFactory.getMatrixProvider();
        const { schoolsData, fleetData, directions } = body;

        const config = { ...defaultConfig, ...body.config };
        config.vehicles.forEach((vehicle: any) => {
          if (vehicle.vehicleTypeId === null) {
            vehicle.vehicleTypeId = undefined;
          }

          if (vehicle.max_capacity) {
            vehicle.capacity = Math.floor(vehicle.capacity * 0.7);
            vehicle.wheelchairSectionCapacity = Math.floor(vehicle.wheelchairSectionCapacity * 0.7);
          }
        });

        console.log('comeco');
        const calculatedDistances = await Promise.all(schoolsData.map(async (schoolData: any) => {
          const res = new CalculateDistanceService(
            schoolData.students, schoolData, config, mapProvider,
          ).execute();
          console.log('fez uma escola');
          return res;
        }));
        console.log('distances_done');

        const startTime = Date.now();
        const totalStudentsCount = schoolsData.reduce((acc: number, school: any) => acc + school.students.length, 0);

        const response: IRouterizationResponse = {
          lines: [],
          unusedVehicles: [],
          excludedStudents: [],
          totalCosts: 0.0,
          matrixProvider: process.env.MATRIX_PROVIDER || 'google',
          routingProvider: process.env.ROUTING_PROVIDER || 'google',
          studentsCount: totalStudentsCount,
        };

        const schools = calculatedDistances.map((calculatedDistance, index) => {
          const schoolData = schoolsData[index];
          const validAddresses = calculatedDistance.result.validAddresses;

          response.excludedStudents.push(...calculatedDistance.result.invalidAddresses);

          return {
            ...schoolData,
            students: validAddresses.map((addressData: any) => ({
              ...addressData, schoolId: schoolData.id,
            })),
          };
        }).filter(school => school.students.length > 0);

        const schoolChunks = new ChunkSchoolsService(schools, config, directions).execute();
        const fails: Error[] = [];

        let availableVehicles = fleetData as IVehicle[];

        const routingProvider = RoutesProviderFactory.getRoutingProvider();
        const validationProvider = RoutesProviderFactory.getValidationProvider();

        for (const schools of schoolChunks) {
          const students = schools.flatMap((school) => school.students);

          console.log('config.onlySchoolsWithStudent:', config.onlySchoolsWithStudent);
          console.log('Total students:', students.length);
          console.log('Total schools:', schools.length);

          const stopPoints = await new FindStopPointsService(students, availableVehicles, config, mapProvider).execute();
          console.log('stop_points_done');

          const calculateRouterization = (chunkSchools: typeof schools, chunkStopPoints: IStopPoint[]) =>
            new CalculateRouterizationService(
              chunkSchools,
              chunkStopPoints,
              availableVehicles,
              config,
              routingProvider,
              validationProvider,
              directions
            ).execute();

          try {
            let result = await calculateRouterization(schools, stopPoints);

            if (result.fail() && result.error.some(isNoRouteFoundError)) {
              const unreachableService = new RemoveUnreachableStopPointsService(stopPoints, schools, routingProvider, directions);
              const reachableStopPoints = await unreachableService.execute();
              const { excludedStudents } = unreachableService;

              const stopPointsChanged =
                excludedStudents.length > 0 ||
                reachableStopPoints.length !== stopPoints.length ||
                reachableStopPoints.some((p, i) =>
                  !stopPoints[i] ||
                  p.coordinates[0] !== stopPoints[i].coordinates[0] ||
                  p.coordinates[1] !== stopPoints[i].coordinates[1]
                );

              if (stopPointsChanged) {
                if (excludedStudents.length > 0) {
                  console.warn(`[routerization] ${excludedStudents.length} student(s) without route excluded; recalculating`);
                  response.excludedStudents.push(...excludedStudents);
                } else {
                  console.warn(`[routerization] ${reachableStopPoints.length} stop point(s) reorganized/split after unreachable check; recalculating`);
                }

                const excludedIds = new Set(excludedStudents.map((student) => student.id));
                const reachableSchools = schools
                  .map((school) => ({ ...school, students: school.students.filter((student) => !excludedIds.has(student.id)) }))
                  .filter((school) => school.students.length > 0);

                if (reachableStopPoints.length === 0) {
                  console.log('routes_done');
                  continue;
                }

                result = await calculateRouterization(reachableSchools, reachableStopPoints);
              }
            }
            console.log('routes_done');
            if (result.success()) {
              availableVehicles = result.value.unusedVehicles;
              response.lines.push(...result.value.lines);
              response.unusedVehicles.push(...result.value.unusedVehicles);
            } else fails.push(...result.error);
          } catch (err) {
            fails.push(err instanceof Error ? err : new Error(String(err)));
          }
        }

        const totalCalls = mapProvider.calls + routingProvider.calls + validationProvider.calls;
        const totalRetries = mapProvider.retries + routingProvider.retries + validationProvider.retries;
        const totalCostRoutes = mapProvider.cost.routes + routingProvider.cost.routes + validationProvider.cost.routes;
        const totalCostMatrix = mapProvider.cost.routesMatrix + routingProvider.cost.routesMatrix + validationProvider.cost.routesMatrix;

        console.info({
          totalCalls,
          totalRetries,
          matrixCost: totalCostMatrix,
          routingCost: totalCostRoutes,
          routesGenerated: response.lines.length
        });

        console.log({ averageCostPerThousand: ((totalCostRoutes + totalCostMatrix) / totalStudentsCount) * 1000 });

        response.totalCosts = totalCostRoutes + totalCostMatrix;
        response.calculationTime = Date.now() - startTime;

        return { response, fails };
      };

      if (async && callbackUrl) {
        res.status(202).send({ status: 'processing' });
        routerizationQueue(async () => {
          try {
            console.log(`[Router] Starting queued async calculation for callback: ${callbackUrl}`);
            const { response, fails } = await performCalculation(req.body);
            if (fails.length > 0) {
              console.error('[Router] Async logic fails detected:', fails.length);
              const hasNoRouteError = fails.some(isNoRouteFoundError);
              const errorMessage = hasNoRouteError
                ? 'Falha no cálculo de rotas: Um ou mais pontos de parada não possuem acesso viário navegável para veículos.'
                : 'Falha lógica no cálculo de rotas';
              await axios.post(callbackUrl, {
                status: 'failed',
                error: errorMessage,
                error_log: fails.map(f => f.message || String(f)).join('\n')
              });
            } else {
              console.log('[Router] Async request completed successfully. Sending callback to:', callbackUrl);
              const callbackRes = await axios.post(
                callbackUrl,
                {
                  status: 'success',
                  result: response,
                },
                {
                  maxContentLength: Infinity,
                  maxBodyLength: Infinity,
                },
              );
              console.log('[Router] Callback delivered successfully, status:', callbackRes.status);
            }
          } catch (err) {
            console.error('[Router] Async execution error:', err instanceof Error ? err.message : String(err));
            await axios.post(
              callbackUrl,
              {
                status: 'failed',
                error: err instanceof Error ? err.message : String(err),
                error_log: err instanceof Error ? err.stack : String(err),
              },
              {
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
              },
            ).catch(e => console.error('[Router] Fail callback failed:', e instanceof Error ? e.message : String(e)));
          }
        });
        return;
      }

      try {
        const { response, fails } = await routerizationQueue(() => performCalculation(req.body));
        if (fails.length > 0) {
          console.error('[Router] Logic fails detected:', fails.length);
          const hasNoRouteError = fails.some(isNoRouteFoundError);
          const errorMessage = hasNoRouteError
            ? 'Falha no cálculo de rotas: Um ou mais pontos de parada não possuem acesso viário navegável para veículos.'
            : 'Falha lógica no cálculo de rotas';
          return res.status(400).send({ error: errorMessage, details: fails.map(f => f.message || String(f)) });
        }

        console.log('[Router] Request completed successfully');
        res.send(response);
      } catch (err) {
        console.error('[Router] Request error:', err);
        res.status(500).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }),
  ),
);

app.post(
  '/recalculate_route',
  asyncHandler(
    withSchema(recalculateRouteRequestSchema, async (req, res) => {
      const config = { ...defaultConfig, ...req.body.config };
      const result = new RecalculateLineService(req.body.line, config).execute();

      res.send(result);
    }),
  ),
);

app.post(
  '/generate_kml',
  asyncHandler(
    withSchema(generateKmlSchema, async (req, res) => {
      const lineData = req.body.line;

      const kml = new GenerateKmlService(lineData).execute();

      res.send(kml);
    }),
  ),
);
app.use(Handlers.errorHandler());

app.use((_err: Error, _req: Request, res: Response, next: NextFunction) => {
  let statusCode = 500;

  if (_err.message.includes("429")) statusCode = 429;
  else if (_err.message.includes("403")) statusCode = 403;

  console.error('=== [SYSTEM ERROR] ===');
  console.error('Message:', _err.message);
  console.error('Stack:', _err.stack);
  console.error('======================');

  res.status(statusCode).send({
    error: _err.message,
    stack: NODE_ENV === 'development' ? _err.stack : undefined,
    message: 'Ops, algo deu errado no processamento da rota'
  });
});

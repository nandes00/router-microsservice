import { IRoutesProvider, IVehicleProfile } from '@providers/interfaces/IRoutesProvider';
import { RoutesProviderFactory } from '@providers/index';
import { mapVehicleToProfile } from '@utils/vehicleHelper';
import { ChunkList } from '@data/chunks';
import {
  calculateAbsoluteDistance,
  Coordinates,
  findCentroid,
  orderPoints,
  clusterize,
} from '@data/coordinates';
import { pLimit } from '@utils/promiseHelper';
import { Result, fail, success } from '@data/result';
import { OptimalFleetService } from '@services/vehicleRoute/OptimalFleetService';
import { studentsFromStopPoins } from '@utils/calculateRouteHelpers';
import { routeIntersectsPolygon } from '@utils/geometryHelper';
import { CalculateLineService } from './calculateLineService';
import { RouteConsolidationService } from './routeConsolidationService';
import {
  ICalculateRouteConfig,
  ICalculateRouterizationResponse,
  ICalculatedLine,
  IRouteData,
  ISchool,
  IStopPoint,
  IVehicle,
} from './interfaces';

const delay = (time: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
};

export class CalculateRouterizationService {
  private readonly computedRoutesFails: Error[] = [];
  private readonly chunkList: ChunkList<IStopPoint>;
  private readonly chunkMaxSize: number;
  private routesData: IRouteData[] = [];
  private chunksToCalculate: number[] = [];
  private retryCount: number = 0;
  private iterationCount: number = 0;
  private readonly maxIterations: number = 50;

  constructor(
    private readonly schools: ISchool[],
    private stopPoints: IStopPoint[],
    private readonly vehicles: IVehicle[],
    private readonly config: ICalculateRouteConfig,
    private readonly routingProvider: IRoutesProvider = RoutesProviderFactory.getRoutingProvider(),
    private readonly validationProvider: IRoutesProvider = RoutesProviderFactory.getValidationProvider(),
    private readonly directions: string[],
  ) {
    this.schools = this.orderSchoolsByDistance(this.schools, this.stopPoints);
    const firstSchool = this.schools[0];
    this.stopPoints = orderPoints(this.stopPoints, firstSchool.coordinates);
    this.chunkMaxSize =
      this.routingProvider.COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS + 1;
    this.vehicles = this.vehicles.sort(
      (a, b) =>
        a.wheelchairSectionCapacity - b.wheelchairSectionCapacity ||
        a.capacity - b.capacity,
    );

    // Cluster stop points geographically using K-Means to ensure adjacent array elements are spatially close
    const initialChunksCount = Math.ceil(this.stopPoints.length / this.chunkMaxSize);
    if (initialChunksCount > 1) {
      try {
        const clusters = clusterize(this.stopPoints, initialChunksCount);
        const orderedClusters = orderPoints(clusters, firstSchool.coordinates);
        this.stopPoints = orderedClusters.flatMap((cluster) =>
          orderPoints(cluster.points, cluster.coordinates)
        );
      } catch (err) {
        console.warn('[Router] Failed to clusterize stop points with K-Means, falling back to basic ordering:', err);
      }
    }

    this.chunkList = new ChunkList(this.stopPoints, {
      maxPoints: this.chunkMaxSize,
    });
  }

  async execute(): Promise<Result<ICalculateRouterizationResponse, Error[]>> {
    this.chunksToCalculate = [];
    for (let i = 0; i < this.chunkList.length; i++) {
      this.chunksToCalculate.push(i);
    }

    do {
      const loopStart = Date.now();
      this.iterationCount++;
      const chunks = this.chunkList.getChunks();
      const chunkSizes = chunks.map((c) => c.length);
      console.info(`[routerization] iteration = ${this.iterationCount}, chunks = ${this.chunkList.length}, chunkSizes = ${JSON.stringify(chunkSizes)}, toCalc = ${JSON.stringify(this.chunksToCalculate)} `);

      await this.calculateRoutes();
      if (this.computedRoutesFails.length > 0) break;
      await this.assignVehicles();
      this.reorganizeRoutes();

      await delay(200); // Isso aqui ajudou a receber menos erros do google

      const loopEnd = Date.now();
      console.info(`[routerization] iteration_end = ${this.iterationCount}, duration_ms = ${loopEnd - loopStart} `);

      if (this.chunkList.length >= this.stopPoints.length) {
        console.info(`[routerization] Maximum chunk split reached (${this.chunkList.length} chunks for ${this.stopPoints.length} stop points). Ending division loop early at iteration ${this.iterationCount}.`);
        break;
      }

      if (this.iterationCount >= this.maxIterations) {
        console.warn(`[routerization] max_iterations_exceeded. Delivering best result found so far. students = ${studentsFromStopPoins(this.stopPoints).length}, chunks = ${this.chunkList.length} `);
        break;
      }

    } while (this.needToRecalculate() && this.computedRoutesFails.length === 0);

    if (this.computedRoutesFails.length > 0) { return fail(this.computedRoutesFails); }

    if (this.needToRecalculate()) {
      console.info(`[routerization] Recalculating ${this.chunksToCalculate.length} remaining chunks to ensure routes and student counts are synchronized before consolidation.`);
      await this.calculateRoutes();
      if (this.computedRoutesFails.length > 0) { return fail(this.computedRoutesFails); }
      await this.assignVehicles();
    }

    try {
      const consolidationService = new RouteConsolidationService(
        this.schools,
        this.vehicles,
        this.config,
        this.routingProvider,
        this.directions,
      );
      this.routesData = await consolidationService.execute(this.routesData);
    } catch (err) {
      console.warn('[routerization] Failed to consolidate sparse routes:', err);
    }

    await this.computeAllowedOwnTypeIds();

    const { lines, unusedVehicles } = new OptimalFleetService(
      this.routesData,
      this.vehicles,
      this.config,
    ).execute();

    return success({
      lines,
      unusedVehicles,
    });
  }

  private async assignVehicles() {
    const chunks = this.chunkList.getChunks();
    chunks.forEach((chunk, index) => {
      const students = studentsFromStopPoins(chunk);
      if (!this.routesData[index]) return;

      this.routesData[index].wheelchairStudentsQuantity = students.filter(
        (student) => student.usesWheelchair,
      ).length;
      this.routesData[index].students = students.filter(
        (student) =>
          !(student.usesWheelchair && student.reason === 'special_need'),
      ).length;
    });

    const routesWithWheelchairStudents = this.routesData
      .map((routeData, index) => {
        return { routeData, index };
      })
      .filter(({ routeData: { wheelchairStudentsQuantity } }) => {
        return wheelchairStudentsQuantity > 0;
      })
      .sort((a, b) => {
        return (
          a.routeData.wheelchairStudentsQuantity -
          b.routeData.wheelchairStudentsQuantity ||
          a.routeData.students - b.routeData.students
        );
      });

    const routesWithoutWheelchairStudents = this.routesData
      .map((routeData, index) => {
        return { routeData, index };
      })
      .filter(({ routeData: { wheelchairStudentsQuantity } }) => {
        return wheelchairStudentsQuantity <= 0;
      })
      .sort((a, b) => {
        return a.routeData.students - b.routeData.students;
      });

    let vehiclesWithWheelchairCapacity = this.vehicles
      .filter(({ wheelchairSectionCapacity }) => {
        return wheelchairSectionCapacity > 0;
      })
      .sort((a, b) => {
        return (
          a.wheelchairSectionCapacity - b.wheelchairSectionCapacity ||
          a.capacity - b.capacity
        );
      });

    let vehiclesWithoutWheelchairCapacity = this.vehicles
      .filter(({ wheelchairSectionCapacity }) => {
        return wheelchairSectionCapacity <= 0;
      })
      .sort((a, b) => {
        return a.capacity - b.capacity;
      });

    let ownVehiclesWithWheelchairIndex = 0;
    let ownVehiclesWithoutWheelchairIndex = 0;

    const usedWheelchairVehicles = vehiclesWithWheelchairCapacity.slice(
      0,
      routesWithWheelchairStudents.length,
    );
    const unusedWheelchairVehicles = vehiclesWithWheelchairCapacity.slice(
      routesWithWheelchairStudents.length,
    );

    vehiclesWithWheelchairCapacity = usedWheelchairVehicles;
    vehiclesWithoutWheelchairCapacity = [
      ...vehiclesWithoutWheelchairCapacity,
      ...unusedWheelchairVehicles,
    ].sort((a, b) => a.capacity - b.capacity);

    vehiclesWithoutWheelchairCapacity = vehiclesWithoutWheelchairCapacity.slice(
      0,
      routesWithoutWheelchairStudents.length,
    );

    for (const { index: routeIndex } of routesWithWheelchairStudents) {
      const { usedOwnVehicle } = await this.setMaxStudentsPerRoute(
        routeIndex,
        vehiclesWithWheelchairCapacity,
        ownVehiclesWithWheelchairIndex,
        true,
      );

      if (usedOwnVehicle) ownVehiclesWithWheelchairIndex++;
    }

    for (const { index: routeIndex } of routesWithoutWheelchairStudents) {
      const { usedOwnVehicle } = await this.setMaxStudentsPerRoute(
        routeIndex,
        vehiclesWithoutWheelchairCapacity,
        ownVehiclesWithoutWheelchairIndex,
        false,
      );

      if (usedOwnVehicle) ownVehiclesWithoutWheelchairIndex++;
    }
  }

  private async setMaxStudentsPerRoute(
    routeIndex: number,
    vehicles: IVehicle[],
    ownVehiclesIndex: number,
    hasWheelchairStudent: boolean,
  ): Promise<{ usedOwnVehicle: boolean }> {
    let usedOwnVehicle = false;

    const vehiclesFilteredForWheelchairStudent = hasWheelchairStudent
      ? this.config.vehicles.filter(
        (vehicle) => vehicle.wheelchairSectionCapacity > 0,
      )
      : this.config.vehicles.filter(
        (vehicle) => vehicle.wheelchairSectionCapacity <= 0,
      );

    if (ownVehiclesIndex < vehicles.length) {
      const stopPoints = this.routesData[routeIndex].route.backRoute.stopPoints;

      const nonWheelchairStops = stopPoints.filter(({ students }) =>
        students.every(
          ({ usesWheelchair, reason }) =>
            !(usesWheelchair && reason === 'special_need'),
        ),
      );
      const wheelchairStops = stopPoints.filter(({ students }) =>
        students.some(
          ({ usesWheelchair }) => usesWheelchair,
        ),
      );

      const maxStudentsInNonWheelchairStops = Math.max(
        ...nonWheelchairStops.map(({ students }) => students.length),
      );
      const maxStudentsInWheelchairStops = hasWheelchairStudent
        ? Math.max(...wheelchairStops.map(({ students }) => students.length))
        : 0;

      const ownVehicle = vehicles[ownVehiclesIndex];
      const ownVehicleValid = await this.checkVehicleRestriction(routeIndex, ownVehicle);

      if (
        ownVehicleValid &&
        ownVehicle.capacity >=
        maxStudentsInNonWheelchairStops &&
        ownVehicle.wheelchairSectionCapacity >=
        maxStudentsInWheelchairStops
      ) {
        this.routesData[routeIndex].studentsCapacity =
          ownVehicle.capacity;
        this.routesData[routeIndex].wheelchairStudentsCapacity =
          ownVehicle.wheelchairSectionCapacity;

        // PERSIST: Save valid vehicles for this route
        this.routesData[routeIndex].validVehicles = await this.filterValidVehicles(routeIndex, this.config.vehicles);

        usedOwnVehicle = true;
      } else {
        if (hasWheelchairStudent) {
          const validVehicles = await this.filterValidVehicles(routeIndex, vehiclesFilteredForWheelchairStudent);
          this.routesData[routeIndex].validVehicles = validVehicles;

          const vehicleToUse = validVehicles.sort(
            (a, b) =>
              b.wheelchairSectionCapacity - a.wheelchairSectionCapacity,
          )[0];

          if (vehicleToUse) {
            this.routesData[routeIndex].studentsCapacity = vehicleToUse.capacity;
            this.routesData[routeIndex].wheelchairStudentsCapacity =
              vehicleToUse.wheelchairSectionCapacity;
          } else {
            this.routesData[routeIndex].studentsCapacity = 0;
            this.routesData[routeIndex].wheelchairStudentsCapacity = 0;
          }

        } else {
          const validVehicles = await this.filterValidVehicles(routeIndex, this.config.vehicles);
          this.routesData[routeIndex].validVehicles = validVehicles;

          const maxCapacity = validVehicles.length > 0 ? Math.max(
            ...validVehicles.map((vehicle) => vehicle.capacity),
          ) : 0;

          this.routesData[routeIndex].studentsCapacity = maxCapacity;
        }
      }
    } else {
      if (hasWheelchairStudent) {
        const validVehicles = await this.filterValidVehicles(routeIndex, vehiclesFilteredForWheelchairStudent);
        this.routesData[routeIndex].validVehicles = validVehicles;

        const vehicleToUse = validVehicles.sort(
          (a, b) =>
            b.wheelchairSectionCapacity - a.wheelchairSectionCapacity,
        )[0];

        if (vehicleToUse) {
          this.routesData[routeIndex].studentsCapacity = vehicleToUse.capacity;
          this.routesData[routeIndex].wheelchairStudentsCapacity =
            vehicleToUse.wheelchairSectionCapacity;
        } else {
          this.routesData[routeIndex].studentsCapacity = 0;
          this.routesData[routeIndex].wheelchairStudentsCapacity = 0;
        }
      } else {
        const validVehicles = await this.filterValidVehicles(routeIndex, this.config.vehicles);
        this.routesData[routeIndex].validVehicles = validVehicles;

        const maxCapacity = validVehicles.length > 0 ? Math.max(
          ...validVehicles.map((vehicle) => vehicle.capacity),
        ) : 0;

        this.routesData[routeIndex].studentsCapacity = maxCapacity;
      }
    }

    return { usedOwnVehicle };
  }

  private validationCache: Map<string, boolean> = new Map();

  private async computeAllowedOwnTypeIds(): Promise<void> {
    for (let i = 0; i < this.routesData.length; i++) {
      const routeData = this.routesData[i];
      if (!routeData) continue;

      const validOwn = await this.filterValidVehicles(i, this.vehicles);
      routeData.allowedOwnTypeIds = new Set(
        validOwn
          .map((v) => Number(v.vehicleTypeId))
          .filter((id) => !Number.isNaN(id)),
      );
    }
  }

  private async filterValidVehicles(routeIndex: number, vehicles: IVehicle[]): Promise<IVehicle[]> {
    const validVehicles: IVehicle[] = [];

    // Key: "height|width|length|weight|type|vehicleTypeId"
    const profileMap = new Map<string, IVehicle[]>();

    for (const vehicle of vehicles) {
      const profile = mapVehicleToProfile(vehicle);
      const vehicleTypeId = vehicle.vehicleTypeId;
      const key = `${profile.height}|${profile.width}|${profile.length}|${profile.weight}|${profile.type}|${vehicleTypeId ?? 'none'}`;
      if (!profileMap.has(key)) {
        profileMap.set(key, []);
      }
      profileMap.get(key)!.push(vehicle);
    }

    for (const [key, vehiclesGroup] of profileMap.entries()) {
      const representativeVehicle = vehiclesGroup[0];
      const isValid = await this.checkVehicleRestriction(routeIndex, representativeVehicle);

      if (isValid) {
        validVehicles.push(...vehiclesGroup);
      }
    }

    return validVehicles;
  }

  private async checkVehicleRestriction(routeIndex: number, vehicle: IVehicle): Promise<boolean> {
    if (!this.validationProvider.validateRouteRestriction) return true;

    const route = this.routesData[routeIndex]?.route;
    if (!route || !route.forwardRoute || !route.backRoute) return true;

    const profile = mapVehicleToProfile(vehicle);
    const vehicleTypeId = vehicle.vehicleTypeId;
    const forwardPolyline = route.forwardRoute.studentRoute.encodedPolyline;
    const backPolyline = route.backRoute.studentRoute.encodedPolyline;
    const cacheKey = `${forwardPolyline}-${backPolyline}-${profile.height}-${profile.width}-${profile.length}-${profile.weight}-${profile.type}-${vehicleTypeId ?? 'none'}`;

    if (this.validationCache.has(cacheKey)) {
      return this.validationCache.get(cacheKey)!;
    }
    // Ensure we compare IDs with the same type (number)
    const vehicleTypeIdNum = vehicleTypeId ? Number(vehicleTypeId) : undefined;
    const relevantPolygons = (this.config.exclusionZones || [])
      .filter(zone => vehicleTypeIdNum && zone.vehicleTypeIds?.some(id => Number(id) === vehicleTypeIdNum))
      .map(zone => zone.polygon);

    console.log(`[Validation] Route ${routeIndex}: vehicleTypeId: ${vehicleTypeIdNum}, exclusionZones: ${this.config.exclusionZones?.length}, relevantPolygons: ${relevantPolygons.length}`);

    // Validate Forward Route (Physical/Valhalla)
    const forwardValid = await this.validateSingleRoute(route.forwardRoute, profile);
    if (!forwardValid) {
      this.validationCache.set(cacheKey, false);
      return false;
    }

    // CHECK EXCLUSION ZONES (GEOMETRY)
    if (relevantPolygons.length > 0) {
      const forwardPolyline = route.forwardRoute.studentRoute.encodedPolyline;
      if (forwardPolyline && routeIntersectsPolygon(forwardPolyline, relevantPolygons)) {
        console.log(`[Validation] Route ${routeIndex} rejected by Exclusion Zone (Forward) for vehicle type ${vehicleTypeId}`);
        this.validationCache.set(cacheKey, false);
        return false;
      }

      const backPolyline = route.backRoute.studentRoute.encodedPolyline;
      if (backPolyline && routeIntersectsPolygon(backPolyline, relevantPolygons)) {
        console.log(`[Validation] Route ${routeIndex} rejected by Exclusion Zone (Back) for vehicle type ${vehicleTypeIdNum}`);
        this.validationCache.set(cacheKey, false);
        return false;
      }

      // CHECK SCHOOL ROUTES (TRAJECTORY BETWEEN SCHOOLS)
      const forwardSchoolPolyline = route.forwardRoute.schoolRoute?.encodedPolyline;
      if (forwardSchoolPolyline && routeIntersectsPolygon(forwardSchoolPolyline, relevantPolygons)) {
        console.log(`[Validation] Route ${routeIndex} rejected by Exclusion Zone (Forward School) for vehicle type ${vehicleTypeIdNum}`);
        this.validationCache.set(cacheKey, false);
        return false;
      }

      const backSchoolPolyline = route.backRoute.schoolRoute?.encodedPolyline;
      if (backSchoolPolyline && routeIntersectsPolygon(backSchoolPolyline, relevantPolygons)) {
        console.log(`[Validation] Route ${routeIndex} rejected by Exclusion Zone (Back School) for vehicle type ${vehicleTypeIdNum}`);
        this.validationCache.set(cacheKey, false);
        return false;
      }
    }

    // Validate Back Route (Physical/Valhalla)
    const backValid = await this.validateSingleRoute(route.backRoute, profile);

    this.validationCache.set(cacheKey, backValid);
    return backValid;
  }

  private async validateSingleRoute(routePart: any, profile: IVehicleProfile): Promise<boolean> {
    const stopPoints = routePart.stopPoints;
    const schools = routePart.schools;

    if (!stopPoints || stopPoints.length === 0) return true;

    const waypoints: Coordinates[] = stopPoints.map((sp: IStopPoint) => sp.coordinates);

    if (schools && schools.length > 0) {
      waypoints.push(schools[0].coordinates);
    }

    if (waypoints.length < 2) {
      return true;
    }

    const origin = waypoints[0];
    const destination = waypoints[waypoints.length - 1];
    const intermediates = waypoints.slice(1, waypoints.length - 1);

    if (origin[0] === destination[0] && origin[1] === destination[1]) {
      return true;
    }

    if (!this.validationProvider.validateRouteRestriction) return true;

    const result = await this.validationProvider.validateRouteRestriction(
      origin,
      destination,
      intermediates,
      profile,
    );

    return result.success() ? result.result : true;
  }


  private reorganizeRoutes() {
    let needToIncrementChunks = false;
    this.chunksToCalculate = [];

    let chunkId = 0;

    const capacitiesSum = this.routesData
      .map(({ studentsCapacity }) => studentsCapacity)
      .reduce((acc, val) => acc + val, 0);
    const studentsSum = this.routesData
      .map(({ students }) => students)
      .reduce((acc, val) => acc + val, 0);

    const wheelchairStudentsCapacitiesSum = this.routesData
      .map(({ wheelchairStudentsCapacity }) => wheelchairStudentsCapacity)
      .reduce((acc, val) => acc + val, 0);
    const wheelchairStudentsQuantitiesSum = this.routesData
      .map(({ wheelchairStudentsQuantity }) => wheelchairStudentsQuantity)
      .reduce((acc, val) => acc + val, 0);

    const distancePercentageSum = this.routesData.reduce(
      (acc, val) => acc + val.distancePercentage,
      0,
    );
    const durationPercentageSum = this.routesData.reduce(
      (acc, val) => acc + val.durationPercentage,
      0,
    );

    if (
      studentsSum > capacitiesSum ||
      distancePercentageSum > this.stopPoints.length ||
      durationPercentageSum > this.stopPoints.length ||
      wheelchairStudentsQuantitiesSum > wheelchairStudentsCapacitiesSum
    ) {
      return this.incrementChunksNumber();
    }

    do {
      if (this.exceededWheelchairStudentsQuantity(this.routesData[chunkId])) {
        needToIncrementChunks = true;
      } else {
        if (this.needsToReduceChunk(this.routesData[chunkId])) {
          const lastChanged = this.realocateStopPoints(chunkId);

          if (this.chunkList.nextChunk(lastChanged) === chunkId) { needToIncrementChunks = true; }
        }

        chunkId = this.chunkList.nextChunk(chunkId);
        if (chunkId === 0) {
          this.retryCount++;
          if (
            this.retryCount > 20 ||
            this.routesData.every((routeData) =>
              this.needsToReduceChunk(routeData),
            )
          ) {
            needToIncrementChunks = true;
          }
        }
      }
    } while (
      !needToIncrementChunks &&
      this.routesData.some((routeData) => this.needsToReduceChunk(routeData) || this.exceededWheelchairStudentsQuantity(routeData))
    );

    if (needToIncrementChunks) this.incrementChunksNumber();
  }

  private incrementChunksNumber() {
    this.retryCount = 0;
    this.chunkList.increaseChunksNumber();
    this.chunksToCalculate = [];
    for (let i = 0; i < this.chunkList.length; i++) {
      this.chunksToCalculate.push(i);
    }
  }

  private realocateStopPoints(chunkId: number) {
    let destinationId = this.chunkList.nextChunk(chunkId);

    while (
      this.needsToReduceChunk(this.routesData[chunkId]) &&
      this.chunkList.nextChunk(destinationId) !== chunkId
    ) {
      destinationId = this.moveNext(chunkId, chunkId);
    }

    return destinationId;
  }

  private moveNext(chunkId: number, stopId: number): number {
    const destinationId = this.chunkList.nextChunk(chunkId);
    if (destinationId === stopId) return chunkId;

    this.chunksToCalculate.push(chunkId, destinationId);

    const freeSpace = this.chunkList.freeSpace(destinationId);
    const currentSpace = this.chunkList.getChunkSize(chunkId);

    let movedTo = destinationId;

    /*
      TODO: Solução temporária para evitar o seguinte cenário:
      Quando a linha possui apenas um ponto de parada, este não pode ser movido.
      Caso contrário, o método `circularSplice` acaba incluindo todos os pontos na linha,
      o que causa um comportamento indesejado.
    */
    if (currentSpace === 1) return this.chunkList.previousChunk(stopId);

    if (freeSpace === 0) {
      movedTo = this.moveNext(this.chunkList.nextChunk(chunkId), stopId);
      if (this.chunkList.nextChunk(movedTo) === stopId) return movedTo;
    }

    /*
      TODO: Implementar uma lógica para tratar a movimentação de pontos de parada
      que incluem alunos cadeirantes, garantindo que suas necessidades sejam consideradas.(capacidade e tempo de rota)
    */
    this.chunkList.moveNext(chunkId);

    const chunk = this.chunkList.getChunk(chunkId);
    const destinationChunk = this.chunkList.getChunk(destinationId);
    const distancePercentage =
      this.routesData[chunkId].distancePercentage / (chunk.length + 1);
    const durationPercentage =
      this.routesData[chunkId].durationPercentage / (chunk.length + 1);

    this.routesData[destinationId].distancePercentage += distancePercentage;
    this.routesData[destinationId].durationPercentage += durationPercentage;

    const destinationStudents = studentsFromStopPoins(destinationChunk);
    this.routesData[destinationId].students = destinationStudents.filter(
      (student) => !student.usesWheelchair,
    ).length;
    this.routesData[destinationId].wheelchairStudentsQuantity =
      destinationStudents.filter((student) => student.usesWheelchair).length;

    this.routesData[chunkId].distancePercentage -= distancePercentage;
    this.routesData[chunkId].durationPercentage -= durationPercentage;

    const currentStudents = studentsFromStopPoins(chunk);
    this.routesData[chunkId].students = currentStudents.filter(
      (student) => !student.usesWheelchair,
    ).length;
    this.routesData[chunkId].wheelchairStudentsQuantity =
      currentStudents.filter((student) => student.usesWheelchair).length;

    return movedTo;
  }

  private needsToReduceChunk(routeData: IRouteData) {
    return (
      routeData.distancePercentage >= 1 ||
      routeData.durationPercentage >= 1 ||
      routeData.students > routeData.studentsCapacity
    );
  }

  private exceededWheelchairStudentsQuantity(routeData: IRouteData) {
    return (
      routeData.wheelchairStudentsQuantity >
      routeData.wheelchairStudentsCapacity
    );
  }

  private async calculateRoutes() {
    const limit = pLimit(3);
    const chunks = [...new Set(this.chunksToCalculate)];
    await Promise.all(
      chunks.map(async (chunkId) => limit(async () => {
        const stopPoints = this.chunkList.getChunk(chunkId);
        let schools: ISchool[] = [];

        const {
          activateGroupingOfSchoolsByArrivalTimes,
          activateGroupingOfSchoolsByDepartureTimes,
        } = this.config;

        if (this.directions.length === 2) {
          schools = activateGroupingOfSchoolsByArrivalTimes
            ? this.orderSchoolsByArrivalTimes(this.schools, stopPoints)
            : this.orderSchoolsByDistance(this.schools, stopPoints);
        } else if (
          activateGroupingOfSchoolsByArrivalTimes &&
          this.directions.includes('forward')
        ) { schools = this.orderSchoolsByArrivalTimes(this.schools, stopPoints); } else if (
          activateGroupingOfSchoolsByDepartureTimes &&
          this.directions.includes('back')
        ) { schools = this.orderSchoolsByDepartureTimes(this.schools, stopPoints); } else schools = this.orderSchoolsByDistance(this.schools, stopPoints);

        const result = await new CalculateLineService(
          stopPoints,
          schools,
          this.config,
          this.routingProvider,
          this.directions,
        ).execute();

        if (result.success()) {
          this.routesData[chunkId] = {
            ...result.value,
            ...this.calculatePercentages(
              result.value.route,
              result.value.withinLimits,
            ),
            studentsCapacity: 0,
            students: 0,
            wheelchairStudentsCapacity: 0,
            wheelchairStudentsQuantity: 0,
          };
        } else {
          this.computedRoutesFails.push(...result.error);
        }
      }))
    );
  }

  private needToRecalculate(): boolean {
    return this.chunksToCalculate.length > 0;
  }

  private orderSchoolsByDistance(
    schools: ISchool[],
    stopPoints: IStopPoint[],
  ): ISchool[] {
    const centroid = findCentroid(stopPoints);

    return schools
      .map((schoolData) => ({
        distance: calculateAbsoluteDistance(
          { coordinates: centroid },
          schoolData,
        ),
        schoolData,
      }))
      .sort((distanceA, distanceB) => {
        return distanceA.distance - distanceB.distance;
      })
      .map(({ schoolData }) => schoolData);
  }

  private orderSchoolsByArrivalTimes(
    schools: ISchool[],
    stopPoints: IStopPoint[],
  ): ISchool[] {
    const centroid = findCentroid(stopPoints);

    return schools
      .map((schoolData) => ({
        distance: calculateAbsoluteDistance(
          { coordinates: centroid },
          schoolData,
        ),
        schoolData,
      }))
      .sort((distanceA, distanceB) => {
        const arrivalTimeA = Math.min(
          ...distanceA.schoolData.students.map((student) =>
            this.parseDateToTimestamp(student.arrivalTime),
          ),
        );

        const arrivalTimeB = Math.min(
          ...distanceB.schoolData.students.map((student) =>
            this.parseDateToTimestamp(student.arrivalTime),
          ),
        );

        return (
          arrivalTimeA - arrivalTimeB || distanceA.distance - distanceB.distance
        );
      })
      .map(({ schoolData }) => schoolData);
  }

  private orderSchoolsByDepartureTimes(
    schools: ISchool[],
    stopPoints: IStopPoint[],
  ) {
    const centroid = findCentroid(stopPoints);

    return schools
      .map((schoolData) => ({
        distance: calculateAbsoluteDistance(
          { coordinates: centroid },
          schoolData,
        ),
        schoolData,
      }))
      .sort((distanceA, distanceB) => {
        const departureTimeA = Math.min(
          ...distanceA.schoolData.students.map((student) =>
            this.parseDateToTimestamp(student.departureTime),
          ),
        );

        const departureTimeB = Math.min(
          ...distanceB.schoolData.students.map((student) =>
            this.parseDateToTimestamp(student.departureTime),
          ),
        );

        return (
          departureTimeA - departureTimeB ||
          distanceA.distance - distanceB.distance
        );
      })
      .map(({ schoolData }) => schoolData);
  }

  private calculatePercentages(route: ICalculatedLine, withinLimits: boolean) {
    const forwardDuration = route.forwardRoute?.duration ?? route.forwardRoute?.studentRoute?.duration ?? 0;
    const backDuration = route.backRoute?.duration ?? route.backRoute?.studentRoute?.duration ?? 0;
    const forwardDistance = route.forwardRoute?.distance ?? route.forwardRoute?.studentRoute?.distance ?? 0;
    const backDistance = route.backRoute?.distance ?? route.backRoute?.studentRoute?.distance ?? 0;

    const checkForward = !this.directions || this.directions.length === 0 || this.directions.includes('forward');
    const checkBack = !this.directions || this.directions.length === 0 || this.directions.includes('back');

    const forwardDurationPercentage = checkForward ? forwardDuration / this.config.maxDuration : 0;
    const backDurationPercentage = checkBack ? backDuration / this.config.maxDuration : 0;
    const forwardDistancePercentage = checkForward ? forwardDistance / this.config.maxDistance : 0;
    const backDistancePercentage = checkBack ? backDistance / this.config.maxDistance : 0;

    return {
      distancePercentage: Math.max(
        forwardDistancePercentage,
        backDistancePercentage,
        withinLimits ? 0 : 1,
      ),
      durationPercentage: Math.max(
        forwardDurationPercentage,
        backDurationPercentage,
        withinLimits ? 0 : 1,
      ),
    };
  }

  private parseDateToTimestamp(time: string): number {
    const date = new Date(time);
    return date.valueOf() / 1000;
  }
}

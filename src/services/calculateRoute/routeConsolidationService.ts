import { IRoutesProvider } from '@providers/interfaces/IRoutesProvider';
import { CalculateLineService } from './calculateLineService';
import {
  ICalculateRouteConfig,
  IRouteData,
  ISchool,
  IStopPoint,
  IVehicle,
} from './interfaces';

export class RouteConsolidationService {
  constructor(
    private readonly schools: ISchool[],
    private readonly vehicles: IVehicle[],
    private readonly config: ICalculateRouteConfig,
    private readonly routingProvider: IRoutesProvider,
    private readonly directions: string[],
  ) { }

  public async execute(routesData: IRouteData[]): Promise<IRouteData[]> {
    let currentRoutes = routesData;
    let pass = 0;
    const maxPasses = 5;

    while (pass < maxPasses && currentRoutes.length > 1) {
      pass++;
      const nextRoutes = await this.executePass(currentRoutes, pass);
      if (nextRoutes.length === currentRoutes.length) {
        break;
      }
      currentRoutes = nextRoutes;
    }

    return currentRoutes;
  }

  private async executePass(
    routesData: IRouteData[],
    passNumber: number,
  ): Promise<IRouteData[]> {
    if (!routesData || routesData.length <= 1) {
      return routesData;
    }

    // Combine own fleet and configured fleet to find true maximum capacities
    const allVehicles = [
      ...this.vehicles,
      ...(this.config.vehicles || []),
    ];

    const maxVehicleCapacity = Math.max(
      ...allVehicles.map((v) => v.capacity || 0),
      15,
    );
    const maxWheelchairCapacity = Math.max(
      ...allVehicles.map((v) => v.wheelchairSectionCapacity || 0),
      0,
    );

    // Identify sparse routes (under-utilized, <= 3 students or < 40% capacity) vs dense routes
    const sparseIndexes: number[] = [];
    const denseIndexes: number[] = [];

    routesData.forEach((routeData, index) => {
      const studentCount = routeData.students;
      if (studentCount <= 3 || studentCount < maxVehicleCapacity * 0.4) {
        sparseIndexes.push(index);
      } else {
        denseIndexes.push(index);
      }
    });

    if (sparseIndexes.length === 0) {
      return routesData;
    }

    // Sort sparseIndexes so smallest routes (e.g. 1-student routes) are evaluated first
    sparseIndexes.sort((a, b) => routesData[a].students - routesData[b].students);

    console.info(
      `[RouteConsolidation Pass ${passNumber}] Evaluating ${sparseIndexes.length} sparse routes for potential merges out of ${routesData.length} total routes.`,
    );

    const mergedRoutes: IRouteData[] = [];
    const processedIndexes = new Set<number>();

    for (let i = 0; i < sparseIndexes.length; i++) {
      const idxA = sparseIndexes[i];
      if (processedIndexes.has(idxA)) continue;

      const routeA = routesData[idxA];
      const stopsA = this.extractStopPoints(routeA);

      let bestPartnerIdx = -1;
      let maxKmSavings = -Infinity;
      let bestMergedRouteData: IRouteData | null = null;

      // Candidate partners: Evaluate other sparse routes first, then dense routes
      const candidateIndexes = [
        ...sparseIndexes.filter((idx) => idx !== idxA && !processedIndexes.has(idx)),
        ...denseIndexes.filter((idx) => !processedIndexes.has(idx)),
      ];

      for (const idxB of candidateIndexes) {
        const routeB = routesData[idxB];
        const stopsB = this.extractStopPoints(routeB);

        // Check 1: Wheelchair & Student combined vehicle capacity check
        const totalWheelchairs =
          routeA.wheelchairStudentsQuantity + routeB.wheelchairStudentsQuantity;
        const totalStudents = routeA.students + routeB.students;

        // Ensure there is at least one vehicle in fleet/config that supports BOTH totalStudents AND totalWheelchairs
        const hasVehicleForCombined = allVehicles.some(
          (v) =>
            (v.capacity || 0) >= totalStudents &&
            (totalWheelchairs === 0 || (v.wheelchairSectionCapacity || 0) >= totalWheelchairs),
        );
        if (!hasVehicleForCombined) continue;

        // Check 3: Waypoint / intermediate points count check
        const combinedStopPoints = this.deduplicateStopPoints([
          ...stopsA,
          ...stopsB,
        ]);
        if (
          combinedStopPoints.length >
          this.routingProvider.COMPUTE_ROUTES_MAX_INTERMEDIATE_POINTS + 1
        ) {
          continue;
        }

        // Check 4: Calculate candidate merged line
        try {
          const calculateLineService = new CalculateLineService(
            combinedStopPoints,
            this.schools,
            this.config,
            this.routingProvider,
            this.directions,
          );

          const result = await calculateLineService.execute();

          if (result.success() && result.result && result.result.withinLimits) {
            const calculatedLine = result.result.route;
            const forwardDur = calculatedLine.forwardRoute?.duration || 0;
            const backDur = calculatedLine.backRoute?.duration || 0;
            const forwardDist = calculatedLine.forwardRoute?.distance || 0;
            const backDist = calculatedLine.backRoute?.distance || 0;

            const maxDuration = Math.max(forwardDur, backDur);
            const maxDistance = Math.max(forwardDist, backDist);

            const distA = Math.max(
              routeA.route.forwardRoute?.distance || 0,
              routeA.route.backRoute?.distance || 0,
            );
            const distB = Math.max(
              routeB.route.forwardRoute?.distance || 0,
              routeB.route.backRoute?.distance || 0,
            );
            const originalDistance = distA + distB;
            const newDistance = maxDistance;
            const kmSavings = originalDistance - newDistance;

            const durationOk = maxDuration <= this.config.maxDuration;
            const distanceOk = maxDistance <= this.config.maxDistance;

            if (durationOk && distanceOk) {
              if (kmSavings > maxKmSavings) {
                const distancePercentage = newDistance / this.config.maxDistance;
                const durationPercentage = maxDuration / this.config.maxDuration;

                // Compute intersection of barrier restriction allowed types
                let mergedAllowedOwnTypeIds: Set<number> | undefined = undefined;
                if (routeA.allowedOwnTypeIds || routeB.allowedOwnTypeIds) {
                  if (routeA.allowedOwnTypeIds && routeB.allowedOwnTypeIds) {
                    mergedAllowedOwnTypeIds = new Set(
                      [...routeA.allowedOwnTypeIds].filter((id) => routeB.allowedOwnTypeIds!.has(id)),
                    );
                  } else {
                    mergedAllowedOwnTypeIds = new Set(routeA.allowedOwnTypeIds || routeB.allowedOwnTypeIds);
                  }
                }

                // Compute intersection of valid vehicles for configuration
                let mergedValidVehicles: IVehicle[] | undefined = undefined;
                if (routeA.validVehicles || routeB.validVehicles) {
                  if (routeA.validVehicles && routeB.validVehicles) {
                    const bSet = new Set(routeB.validVehicles.map((v) => v.id || v.vehicleTypeId || v.kind));
                    mergedValidVehicles = routeA.validVehicles.filter((v) =>
                      bSet.has(v.id || v.vehicleTypeId || v.kind),
                    );
                  } else {
                    mergedValidVehicles = routeA.validVehicles || routeB.validVehicles;
                  }
                }

                const candidateMergedRouteData: IRouteData = {
                  route: calculatedLine,
                  withinLimits: true,
                  studentsCapacity: maxVehicleCapacity,
                  distancePercentage,
                  durationPercentage,
                  students: totalStudents,
                  wheelchairStudentsQuantity: totalWheelchairs,
                  wheelchairStudentsCapacity: maxWheelchairCapacity,
                  allowedOwnTypeIds: mergedAllowedOwnTypeIds,
                  validVehicles: mergedValidVehicles,
                };

                const remainingRoutes = routesData.filter(
                  (_, idx) => idx !== idxA && idx !== idxB && !processedIndexes.has(idx),
                );
                const proposedRoutes = [
                  ...mergedRoutes,
                  candidateMergedRouteData,
                  ...remainingRoutes,
                ];

                if (this.canFleetAccommodate(proposedRoutes)) {
                  maxKmSavings = kmSavings;
                  bestPartnerIdx = idxB;
                  bestMergedRouteData = candidateMergedRouteData;
                }
              }
            }
          }
        } catch (err) {
          continue;
        }
      }

      if (bestMergedRouteData && bestPartnerIdx !== -1) {
        console.info(
          `[RouteConsolidation Pass ${passNumber}] Successfully merged route ${idxA} (${routeA.students} students) and route ${bestPartnerIdx} (${routesData[bestPartnerIdx].students} students). Km savings: ${Math.round(maxKmSavings / 1000)}km.`,
        );
        mergedRoutes.push(bestMergedRouteData);
        processedIndexes.add(idxA);
        processedIndexes.add(bestPartnerIdx);
      } else {
        mergedRoutes.push(routeA);
        processedIndexes.add(idxA);
      }
    }
    denseIndexes.forEach((idx) => {
      if (!processedIndexes.has(idx)) {
        mergedRoutes.push(routesData[idx]);
        processedIndexes.add(idx);
      }
    });

    console.info(
      `[RouteConsolidation Pass ${passNumber}] Reduced routes count from ${routesData.length} to ${mergedRoutes.length}.`,
    );

    return mergedRoutes;
  }

  public canFleetAccommodate(routes: IRouteData[]): boolean {
    const availableOwn = [...this.vehicles];
    const configVehicles = this.config.vehicles || [];

    const sortedRoutes = [...routes].sort((a, b) => {
      const aWc = a.wheelchairStudentsQuantity || 0;
      const bWc = b.wheelchairStudentsQuantity || 0;
      if (aWc !== bWc) return aWc - bWc;
      return a.students - b.students;
    });

    for (const route of sortedRoutes) {
      const students = route.students;
      const wcStudents = route.wheelchairStudentsQuantity || 0;
      const hasWheelchair = wcStudents > 0;

      const sortedFleet = [...availableOwn].sort((a, b) => {
        if (hasWheelchair) {
          const aValid = (a.wheelchairSectionCapacity || 0) >= wcStudents;
          const bValid = (b.wheelchairSectionCapacity || 0) >= wcStudents;
          if (aValid && !bValid) return -1;
          if (!aValid && bValid) return 1;
          if ((a.wheelchairSectionCapacity || 0) !== (b.wheelchairSectionCapacity || 0)) {
            return (a.wheelchairSectionCapacity || 0) - (b.wheelchairSectionCapacity || 0);
          }
        } else {
          const aHasW = (a.wheelchairSectionCapacity || 0) > 0 ? 1 : 0;
          const bHasW = (b.wheelchairSectionCapacity || 0) > 0 ? 1 : 0;
          if (aHasW !== bHasW) return aHasW - bHasW;
        }
        return (a.capacity || 0) - (b.capacity || 0);
      });

      const matchedOwn = sortedFleet.find((v) => {
        const regularStudents = Math.max(0, students - wcStudents);
        const wcCap = v.wheelchairSectionCapacity || 0;
        const regularCap = v.capacity || 0;
        const totalCap = regularCap + wcCap;

        const wheelchairMatch = !hasWheelchair || wcStudents <= wcCap;
        const capacityMatch = hasWheelchair
          ? regularStudents <= regularCap && students <= totalCap
          : students <= regularCap;

        if (!capacityMatch || !wheelchairMatch) return false;

        const allowedOwnTypeIds = route.allowedOwnTypeIds;
        if (allowedOwnTypeIds && v.vehicleTypeId != null && !allowedOwnTypeIds.has(Number(v.vehicleTypeId))) {
          return false;
        }

        return true;
      });

      if (matchedOwn) {
        const fleetIndex = availableOwn.indexOf(matchedOwn);
        availableOwn.splice(fleetIndex, 1);
        continue;
      }

      const matchedRented = configVehicles.find((v) => {
        const regularStudents = Math.max(0, students - wcStudents);
        const wcCap = v.wheelchairSectionCapacity || 0;
        const regularCap = v.capacity || 0;
        const totalCap = regularCap + wcCap;

        const wheelchairMatch = !hasWheelchair || wcStudents <= wcCap;
        const capacityMatch = hasWheelchair
          ? regularStudents <= regularCap && students <= totalCap
          : students <= regularCap;

        if (!capacityMatch || !wheelchairMatch) return false;

        if (route.validVehicles && !route.validVehicles.some((vv) => (vv.id || vv.vehicleTypeId || vv.kind) === (v.id || v.vehicleTypeId || v.kind))) {
          return false;
        }

        return true;
      });

      if (!matchedRented) {
        return false;
      }
    }

    return true;
  }

  private extractStopPoints(routeData: IRouteData): IStopPoint[] {
    const backStops = routeData.route.backRoute?.stopPoints || [];
    const forwardStops = routeData.route.forwardRoute?.stopPoints || [];

    return backStops.length > 0 ? backStops : forwardStops;
  }

  private deduplicateStopPoints(stops: IStopPoint[]): IStopPoint[] {
    const map = new Map<string, IStopPoint>();

    for (const stop of stops) {
      const key = `${stop.coordinates[0].toFixed(6)},${stop.coordinates[1].toFixed(6)}`;
      if (map.has(key)) {
        const existing = map.get(key)!;
        const existingStudentIds = new Set(existing.students.map((s) => s.id));
        for (const student of stop.students) {
          if (!existingStudentIds.has(student.id)) {
            existing.students.push({ ...student });
            existingStudentIds.add(student.id);
          }
        }
      } else {
        map.set(key, {
          coordinates: [stop.coordinates[0], stop.coordinates[1]],
          students: stop.students.map((s) => ({ ...s })),
        });
      }
    }

    return Array.from(map.values());
  }
}

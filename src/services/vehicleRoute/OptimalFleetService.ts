import { ICalculateRouteConfig, ILineWithVehicle, IRouteData, IVehicle } from '@services/calculateRoute/interfaces';

export class OptimalFleetService {
  private readonly unusedVehicles: IVehicle[] = [];

  constructor(
    private readonly routesData: IRouteData[],
    private readonly vehicles: IVehicle[],
    private readonly config: ICalculateRouteConfig,
  ) { }

  execute(): { lines: ILineWithVehicle[], unusedVehicles: IVehicle[] } {
    const lines: ILineWithVehicle[] = [];
    const availableFleet = [...this.vehicles];

    this.routesData.forEach((rd) => {
      rd.students = this.getStudentCountFromStopPoints(rd);
      rd.wheelchairStudentsQuantity = this.getWheelchairCountFromStopPoints(rd);
    });

    const sortedRoutes = this.sortStudents(this.routesData.map((routeData, index) => ({ routeData, index })), true);

    for (const { routeData, index } of sortedRoutes) {
      const hasWheelchair = routeData.wheelchairStudentsQuantity > 0;
      let selectedVehicle: IVehicle | undefined;

      const sortedFleet = [...availableFleet].sort((a, b) => {
        if (hasWheelchair) {
          const aValid = a.wheelchairSectionCapacity >= routeData.wheelchairStudentsQuantity;
          const bValid = b.wheelchairSectionCapacity >= routeData.wheelchairStudentsQuantity;
          if (aValid && !bValid) return -1;
          if (!aValid && bValid) return 1;
          if (a.wheelchairSectionCapacity !== b.wheelchairSectionCapacity) {
            return a.wheelchairSectionCapacity - b.wheelchairSectionCapacity;
          }
        } else {
          const aHasW = a.wheelchairSectionCapacity > 0 ? 1 : 0;
          const bHasW = b.wheelchairSectionCapacity > 0 ? 1 : 0;
          if (aHasW !== bHasW) return aHasW - bHasW;
        }
        return a.capacity - b.capacity;
      });

      const matchedVehicle = sortedFleet.find(v => {
        const regularStudents = Math.max(0, routeData.students - (routeData.wheelchairStudentsQuantity || 0));
        const wcCap = v.wheelchairSectionCapacity || 0;
        const regularCap = v.capacity || 0;
        const totalCap = regularCap + wcCap;

        const wheelchairMatch = !hasWheelchair || routeData.wheelchairStudentsQuantity <= wcCap;
        const capacityMatch = hasWheelchair
          ? regularStudents <= regularCap && routeData.students <= totalCap
          : routeData.students <= regularCap;

        if (!capacityMatch || !wheelchairMatch) return false;

        const allowedOwnTypeIds = routeData.allowedOwnTypeIds;
        if (allowedOwnTypeIds && v.vehicleTypeId != null && !allowedOwnTypeIds.has(Number(v.vehicleTypeId))) {
          console.log(`[OptimalFleet] Vehicle ${v.vehicleTypeId} (${v.kind}) rejected for route ${index} due to barrier restrictions`);
          return false;
        }

        return true;
      });

      if (matchedVehicle) {
        const fleetIndex = availableFleet.indexOf(matchedVehicle);
        selectedVehicle = availableFleet.splice(fleetIndex, 1)[0];
        console.log(`[OptimalFleet] Route ${index} assigned to OWN vehicle ${selectedVehicle.vehicleTypeId} (${selectedVehicle.kind})`);
      } else {
        console.log(`[OptimalFleet] Route ${index} NO SUITABLE OWN VEHICLE FOUND. Falling back to rented fleet...`);
        if (hasWheelchair) {
          selectedVehicle = this.recommendedVehicleByWheelchairCapacity(routeData.students, routeData.wheelchairStudentsQuantity, routeData.validVehicles);
        } else {
          selectedVehicle = this.recommendedVehicleByCapacity(routeData.students, routeData.validVehicles);
        }
      }

      if (!selectedVehicle) {
        if (hasWheelchair) {
          const wheelchairVehicle = this.recommendedVehicleByWheelchairCapacity(
            routeData.wheelchairStudentsQuantity,
            routeData.wheelchairStudentsQuantity,
            routeData.validVehicles,
          );

          if (wheelchairVehicle) {
            console.log(`[OptimalFleet] Adaptativamente dividindo rota ${index} em Linha Acessível (${wheelchairVehicle.kind}) e Linha Regular...`);
            const splitLines = this.splitAndAssignRoute(routeData, wheelchairVehicle);
            lines.push(...splitLines);
            continue;
          }
        }

        const message = hasWheelchair
          ? `Não foi possível encontrar nenhum veículo adaptado cadastrado na frota/configuração para atender o(s) ${routeData.wheelchairStudentsQuantity} aluno(s) cadeirante(s). Por favor, cadastre pelo menos um veículo com rampa/elevador.`
          : (this.config.vehicles.length === 0
            ? `Frota própria insuficiente para atender todas as rotas: não há veículo disponível para uma rota com ${routeData.students} aluno(s). Adicione veículos à frota própria ou inclua veículos terceirizados.`
            : `Não foi possível encontrar um veículo compatível para a rota ${index}. Verifique se as restrições físicas ou zonas de exclusão estão bloqueando todos os veículos da frota/configuração.`);
        throw new Error(message);
      }

      lines.push({
        vehicle: selectedVehicle,
        ...routeData.route,
      });
    }

    return { lines, unusedVehicles: availableFleet };
  }

  private splitAndAssignRoute(
    routeData: IRouteData,
    wheelchairVehicle: IVehicle,
  ): ILineWithVehicle[] {
    const lines: ILineWithVehicle[] = [];
    const mainRoute = routeData.route;

    const forwardStops = mainRoute.forwardRoute?.stopPoints || [];
    const backStops = mainRoute.backRoute?.stopPoints || [];
    const refStops = backStops.length > 0 ? backStops : forwardStops;

    const wheelchairStops: typeof refStops = [];
    const regularStops: typeof refStops = [];
    let currentRegular = 0;
    let currentWheelchair = 0;

    const maxWc = wheelchairVehicle.wheelchairSectionCapacity || 0;
    const maxSeats = wheelchairVehicle.capacity || 0;

    for (const sp of refStops) {
      const students = sp.students || [];
      const wheelchairStudents = students.filter((s) => s.usesWheelchair);
      const regularStudents = students.filter((s) => !s.usesWheelchair);

      const availableWc = Math.max(0, maxWc - currentWheelchair);
      const availableSeats = Math.max(0, maxSeats - currentRegular);

      const wcOnWheelchairLine = wheelchairStudents.slice(0, availableWc);
      const wcOnRegularLine = wheelchairStudents.slice(availableWc);

      const takeRegularOnWcLine = availableSeats > 0 && (wheelchairStudents.length > 0 || wheelchairStops.length < 15);
      const regularSeatsToTake = takeRegularOnWcLine ? availableSeats : 0;

      const regularOnWheelchairLine = regularStudents.slice(0, regularSeatsToTake);
      const regularOnRegularLine = regularStudents.slice(regularSeatsToTake);

      if (wcOnWheelchairLine.length > 0 || regularOnWheelchairLine.length > 0) {
        wheelchairStops.push({
          ...sp,
          students: [...wcOnWheelchairLine, ...regularOnWheelchairLine],
        });
        currentWheelchair += wcOnWheelchairLine.length;
        currentRegular += regularOnWheelchairLine.length;
      }

      if (wcOnRegularLine.length > 0 || regularOnRegularLine.length > 0) {
        regularStops.push({
          ...sp,
          students: [...wcOnRegularLine, ...regularOnRegularLine],
        });
      }
    }

    if (wheelchairStops.length > 0) {
      lines.push({
        vehicle: wheelchairVehicle,
        ...mainRoute,
        ...(mainRoute.backRoute && {
          backRoute: {
            ...mainRoute.backRoute,
            stopPoints: wheelchairStops,
          },
        }),
        ...(mainRoute.forwardRoute && {
          forwardRoute: {
            ...mainRoute.forwardRoute,
            stopPoints: wheelchairStops,
          },
        }),
      });
    }

    if (regularStops.length > 0) {
      const regularStudentsCount = regularStops.reduce(
        (acc, sp) => acc + (sp.students ? sp.students.length : 0),
        0,
      );
      const regularVehicle =
        this.recommendedVehicleByCapacity(regularStudentsCount, routeData.validVehicles) ||
        this.recommendedVehicleByCapacity(regularStudentsCount);

      if (!regularVehicle) {
        throw new Error(
          `Não foi possível encontrar um veículo com capacidade suficiente para atender os ${regularStudentsCount} alunos da linha regular resultante da divisão da rota.`,
        );
      }

      lines.push({
        vehicle: regularVehicle,
        ...mainRoute,
        ...(mainRoute.backRoute && {
          backRoute: {
            ...mainRoute.backRoute,
            stopPoints: regularStops,
          },
        }),
        ...(mainRoute.forwardRoute && {
          forwardRoute: {
            ...mainRoute.forwardRoute,
            stopPoints: regularStops,
          },
        }),
      });
    }

    return lines;
  }

  private sortStudents(routesData: { routeData: IRouteData, index: number }[], withWheelchairStudents: boolean) {
    if (withWheelchairStudents) {
      return routesData.sort((a, b) => {
        const aRegular = a.routeData.wheelchairStudentsQuantity > 0 ? 0 : 1;
        const bRegular = b.routeData.wheelchairStudentsQuantity > 0 ? 0 : 1;
        return aRegular - bRegular ||
          a.routeData.wheelchairStudentsQuantity - b.routeData.wheelchairStudentsQuantity ||
          a.routeData.students - b.routeData.students;
      });
    }

    return routesData.sort((a, b) => a.routeData.students - b.routeData.students);
  }

  private recommendedVehicleByCapacity(capacity: number, validVehicles?: IVehicle[]): IVehicle | undefined {
    const vehiclesToUse = validVehicles !== undefined ? validVehicles : this.config.vehicles;

    if (!vehiclesToUse || vehiclesToUse.length === 0) return undefined;

    const eligible = vehiclesToUse.filter(v => capacity <= v.capacity);
    if (eligible.length === 0) return undefined;

    return [...eligible].sort((a, b) => {
      const aHasW = (a.wheelchairSectionCapacity || 0) > 0 ? 1 : 0;
      const bHasW = (b.wheelchairSectionCapacity || 0) > 0 ? 1 : 0;
      if (aHasW !== bHasW) return aHasW - bHasW;

      const aCost = a.cost != null && a.cost > 0 ? a.cost : undefined;
      const bCost = b.cost != null && b.cost > 0 ? b.cost : undefined;
      if (aCost != null && bCost != null && Math.abs(aCost - bCost) > 0.001) {
        return aCost - bCost;
      }

      return a.capacity - b.capacity;
    })[0];
  }

  private recommendedVehicleByWheelchairCapacity(capacity: number, wheelchairCapacity: number, validVehicles?: IVehicle[]): IVehicle | undefined {
    const vehiclesToUse = validVehicles !== undefined ? validVehicles : this.config.vehicles;

    if (!vehiclesToUse || vehiclesToUse.length === 0) return undefined;

    const regularStudents = Math.max(0, capacity - wheelchairCapacity);

    // Filter candidate vehicles that satisfy wheelchair capacity, seated capacity, and total capacity
    const candidates = [...vehiclesToUse].filter(v => {
      const wcCap = v.wheelchairSectionCapacity || 0;
      const regularCap = v.capacity || 0;
      const totalCap = regularCap + wcCap;

      return (
        wheelchairCapacity <= wcCap &&
        regularStudents <= regularCap &&
        capacity <= totalCap
      );
    });

    if (candidates.length === 0) return undefined;

    return [...candidates].sort((a, b) => {
      const aCost = a.cost != null && a.cost > 0 ? a.cost : undefined;
      const bCost = b.cost != null && b.cost > 0 ? b.cost : undefined;
      if (aCost != null && bCost != null && Math.abs(aCost - bCost) > 0.001) {
        return aCost - bCost;
      }

      const aWcExcess = (a.wheelchairSectionCapacity || 0) - wheelchairCapacity;
      const bWcExcess = (b.wheelchairSectionCapacity || 0) - wheelchairCapacity;
      if (aWcExcess !== bWcExcess) {
        return aWcExcess - bWcExcess;
      }
      return a.capacity - b.capacity;
    })[0];
  }

  private getStudentCountFromStopPoints(routeData: IRouteData): number {
    const forwardStops = routeData.route?.forwardRoute?.stopPoints || [];
    const backStops = routeData.route?.backRoute?.stopPoints || [];
    const stops = forwardStops.length > 0 ? forwardStops : backStops;

    const counted = stops.reduce((total, sp) => total + (sp.students?.length || 0), 0);
    return Math.max(routeData.students || 0, counted);
  }

  private getWheelchairCountFromStopPoints(routeData: IRouteData): number {
    const forwardStops = routeData.route?.forwardRoute?.stopPoints || [];
    const backStops = routeData.route?.backRoute?.stopPoints || [];
    const stops = forwardStops.length > 0 ? forwardStops : backStops;

    const counted = stops.reduce((total, sp) => {
      const wcStudents = (sp.students || []).filter((s) => s.usesWheelchair);
      return total + wcStudents.length;
    }, 0);
    return Math.max(routeData.wheelchairStudentsQuantity || 0, counted);
  }
}

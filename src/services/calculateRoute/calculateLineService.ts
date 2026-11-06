import { IRoutesProvider } from '@providers/interfaces/IRoutesProvider';
import { RoutesProviderFactory } from '@providers/index';
import { Result, fail, success } from '@data/result';
import { studentsFromStopPoins } from '@utils/calculateRouteHelpers';
import { CalculateSchoolRouteService } from './calculateSchoolRouteService';
import { CalculateStudentRouteService } from './calculateStudentRouteService';
import { ICalculateRouteConfig, ICalculatedLine, ISchool, ISchoolTravelLocation, IStopPoint, IStudentData, IStudentsRoute } from './interfaces';
import moment from 'moment';

export interface CalculateLineServiceResult {
  route: ICalculatedLine
  withinLimits: boolean
}

export class CalculateLineService {
  private computedRoute: ICalculatedLine | undefined;
  private withinLimits: boolean = true;
  private readonly computedRoutesFails: Error[] = [];
  impossibleAddresses: IStudentData[] = [];

  constructor(
    private readonly stopPoints: IStopPoint[],
    private readonly schools: ISchool[],
    private readonly config: ICalculateRouteConfig,
    private readonly googleRoutesAPI: IRoutesProvider = RoutesProviderFactory.getRoutingProvider(),
    private readonly directions: string[],
  ) { }

  async execute(): Promise<Result<CalculateLineServiceResult, Error[]>> {
    try {
      await this.computeRoute();
    } catch (error: any) {
      this.computedRoutesFails.push(error);
    }

    if (this.computedRoutesFails.length > 0) return fail(this.computedRoutesFails);

    return success({
      route: this.computedRoute!,
      withinLimits: this.withinLimits,
    });
  }

  private schoolsFromStudents() {
    const schoolsIds = [...new Set(this.stopPoints.flatMap(stopPoint => stopPoint.students.flatMap(student => student.schoolId)))];
    const orderedSchools: ISchool[] = [];
    this.schools.forEach(school => {
      schoolsIds.includes(school.id) && orderedSchools.push(school);
    });

    return orderedSchools;
  }

  private async computeRoute() {
    const filteredSchools = this.config.onlySchoolsWithStudent ? this.schoolsFromStudents() : this.schools;

    const currentDate = moment();

    // Pegar o aluno com horário de entrada na escola mais cedo
    const studentArrivalTimes = filteredSchools.flatMap((school) => school.students).map((student) => student.arrivalTime);
    const earliestStudentArrivalTime = this.findEarliestStudent(studentArrivalTimes);
    const forwardDepartureTime = moment(earliestStudentArrivalTime)
      .year(currentDate.year())
      .month(currentDate.month())
      .date(currentDate.date())
      .add(1, 'days')
      .toISOString();

    // Pegar o aluno com horário de saída mais cedo
    const studentDepartureTimes = this.schools.flatMap((school) => school.students).map((student) => student.departureTime);
    const earliestStudentDepartureTime = this.findEarliestStudent(studentDepartureTimes);
    const backDepartureTime = moment(earliestStudentDepartureTime)
      .year(currentDate.year())
      .month(currentDate.month())
      .date(currentDate.date())
      .add(1, 'days')
      .toISOString();

    const service = await new CalculateStudentRouteService(
      this.stopPoints,
      filteredSchools,
      forwardDepartureTime,
      backDepartureTime,
      this.googleRoutesAPI,
      this.config,
    ).execute();

    if (service.fail()) return this.computedRoutesFails.push(...service.error);

    const { forwardRoute, backRoute, furthestStopPoint } = service.result;

    this.computedRoute = { furthestStopPoint, forwardRoute, backRoute };
    var stopPointsDefault = 0;
    var stopPointsWheelchair = 0;

    this.stopPoints.forEach((stopPoint) => {
      const hasWheelchairUser = stopPoint.students.some(student => student.usesWheelchair);

      if (hasWheelchairUser) {
        stopPointsWheelchair++;
      } else {
        stopPointsDefault++;
      }
    });
    const standByTime = stopPointsDefault * this.config.averageStopDuration + stopPointsWheelchair * this.config.averageStopDurationWheelchair;

    this.computedRoute.backRoute.duration += standByTime;
    this.computedRoute.forwardRoute.duration += standByTime;

    if (!this.routeWithinLimits(this.computedRoute)) {
      this.withinLimits = false;
      return this.computedRoute;
    };

    if (filteredSchools.length > 1) {
      const service = await new CalculateSchoolRouteService(
        filteredSchools,
        forwardDepartureTime,
        backDepartureTime,
        this.googleRoutesAPI,
        this.directions,
      ).execute();

      if (service.fail()) return this.computedRoutesFails.push(...service.error);

      const schoolsRoute = service.result;

      this.computedRoute.forwardRoute.schoolRoute = schoolsRoute.forwardRoute.route;
      this.computedRoute.forwardRoute.distance += schoolsRoute.forwardRoute.route.distance;
      this.computedRoute.forwardRoute.duration += schoolsRoute.forwardRoute.route.duration;

      let forwardRouteSchools: ISchoolTravelLocation[] = [];

      forwardRouteSchools = schoolsRoute.forwardRoute.schools;

      this.computedRoute.forwardRoute.schools = forwardRouteSchools;

      this.computedRoute.backRoute.schoolRoute = schoolsRoute.backRoute.route;
      this.computedRoute.backRoute.distance += schoolsRoute.backRoute.route.distance;
      this.computedRoute.backRoute.duration += schoolsRoute.backRoute.route.duration;

      let backRouteSchools: ISchoolTravelLocation[] = [];

      backRouteSchools = schoolsRoute.backRoute.schools;

      this.computedRoute.backRoute.schools = backRouteSchools;
    }

    if (
      !this.routeWithinLimits(this.computedRoute) ||
      !this.studentsWithinLimits(forwardRoute) ||
      !this.studentsWithinLimits(backRoute)
    ) {
      this.withinLimits = false;
    }

    return this.computedRoute;
  }

  private findEarliestStudent(studentTimes: string[]): string {
    if (studentTimes.length === 0) return moment().toISOString();

    return studentTimes.reduce((earliest, current) => {
      const earliestTime = moment(earliest).format('HH:mm:ss');
      const currentTime = moment(current).format('HH:mm:ss');

      return currentTime < earliestTime ? current : earliest;
    });
  }

  private routeWithinLimits(route: ICalculatedLine) {
    const { forwardRoute, backRoute } = route;

    const checkForward = !this.directions || this.directions.length === 0 || this.directions.includes('forward');
    const checkBack = !this.directions || this.directions.length === 0 || this.directions.includes('back');

    const forwardOk = !checkForward ||
      (forwardRoute.distance <= this.config.maxDistance && forwardRoute.duration <= this.config.maxDuration);

    const backOk = !checkBack ||
      (backRoute.distance <= this.config.maxDistance && backRoute.duration <= this.config.maxDuration);

    return forwardOk && backOk;
  }

  private studentsWithinLimits(route: IStudentsRoute) {
    return route.stopPoints.every((stopPoint) => {
      return stopPoint.students.every((student) => {
        const schoolTravel = route.schools.find((school) => school?.id === student.schoolId);
        const travelDistance = stopPoint.traveledDistance + (schoolTravel?.distance ? schoolTravel.distance : 0);
        const travelDuration = stopPoint.traveledDuration + (schoolTravel?.duration ? schoolTravel.duration : 0);

        return travelDistance < this.config.maxDistance && travelDuration < this.config.maxDuration;
      });
    });
  }
}

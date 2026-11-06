import { ICalculateRouteConfig } from '@services/calculateRoute/interfaces';
import { IUpdateLineData } from './interfaces';
import { IRecalculateRoutePolylineServiceResponse, RecalculateRoutePolylineService } from './recalculateRoutePolylineService';

export interface IRecalculateLineServiceResponse {
  distance: number
  duration: number
  routes: IRecalculateRoutePolylineServiceResponse[]
}

export class RecalculateLineService {
  private recalculatedRoutes: IRecalculateRoutePolylineServiceResponse[] = [];
  private updatedDistance: number | undefined;
  private updatedDuration: number | undefined;

  constructor(
    private readonly line: IUpdateLineData,
    private readonly config: ICalculateRouteConfig,
  ) {}

  execute(): IRecalculateLineServiceResponse {
    this.recalculateRoutes();
    this.recalcuateDurationAndDistance();

    if (this.updatedDuration === undefined) throw new Error('`updatedDuration` was not defined');
    if (!this.updatedDistance) throw new Error('`updatedDistance` was not defined');

    return {
      distance: this.updatedDistance,
      duration: this.updatedDuration,
      routes: this.recalculatedRoutes,
    };
  }

  private recalculateRoutes() {
    this.recalculatedRoutes = this.line.routes.map(
      (route) => new RecalculateRoutePolylineService(route, this.config).execute(),
    );
  }

  private recalcuateDurationAndDistance() {
    this.updatedDistance = this.recalculatedRoutes.reduce((total, route) => total + route.distance, 0);
    const standByTime = this.line.normal_stop_points_count * this.config.averageStopDuration + this.line.wheelchair_stop_points_count * this.config.averageStopDurationWheelchair;
    this.updatedDuration = this.recalculatedRoutes.reduce((total, route) => total + route.duration, standByTime);
  }
}

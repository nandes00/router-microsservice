import { lineDistance, Polyline, polylineDiff } from '@data/polyline';
import { decode } from '@mapbox/polyline';
import { ICalculateRouteConfig } from '@services/calculateRoute/interfaces';
import { IUpdateRouteData } from './interfaces';

export interface IRecalculateRoutePolylineServiceResponse {
  kind: string
  distance: number
  duration: number
  polyline: string
}

export class RecalculateRoutePolylineService {
  private readonly originalPolyline: Polyline;
  private readonly updatedPolyline: Polyline;

  private updatedDistance: number | undefined;
  private updatedDuration: number | undefined;
  private remotions: Polyline[] = [];
  private aditions: Polyline[] = [];

  constructor(
    private readonly route: IUpdateRouteData,
    private readonly config: ICalculateRouteConfig,
  ) {
    this.originalPolyline = decode(this.route.originalPolyline);
    this.updatedPolyline = decode(this.route.updatedPolyline);
  }

  execute(): IRecalculateRoutePolylineServiceResponse {
    this.calculateModifications();
    this.recalculateDistance();
    this.recalculateDuration();

    if (this.updatedDuration === undefined) throw new Error('`updatedDuration` was not defined');
    if (this.updatedDistance === undefined) throw new Error('`updatedDistance` was not defined');

    return {
      kind: this.route.kind,
      distance: this.updatedDistance,
      duration: this.updatedDuration,
      polyline: this.route.updatedPolyline,
    };
  }

  private calculateModifications() {
    const diff = polylineDiff(this.originalPolyline, this.updatedPolyline);
    this.remotions = diff.remotions;
    this.aditions = diff.aditions;
  }

  private recalculateDistance() {
    const addedDistance = this.aditions.reduce((acc, polyline) => acc + lineDistance(polyline), 0);
    const removedDistance = this.remotions.reduce((acc, polyline) => acc + lineDistance(polyline), 0);
    this.updatedDistance = this.route.distance + addedDistance - removedDistance;
  }

  private recalculateDuration() {
    if (this.updatedDistance === undefined) throw new Error('`updatedDistance` was not defined');

    const averageSpeed = this.route.distance / this.route.duration;
    this.updatedDuration = this.updatedDistance / averageSpeed || 0;
  }
}

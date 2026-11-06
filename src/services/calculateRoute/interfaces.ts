import { Coordinates } from '@data/coordinates';
import { CalculateLineServiceResult } from './calculateLineService';

interface IBaseRoute {
  encodedPolyline: string
  distance: number
  duration: number
}

interface IRouteLeg extends IBaseRoute {
  startLocation: Coordinates
  endLocation: Coordinates
}

export interface IRoute extends IBaseRoute {
  legs: IRouteLeg[]
}

export interface IStudentsRoute {
  stopPoints: IRouteStopPoint[]
  schools: ISchoolTravelLocation[]
  studentRoute: IRoute
  schoolRoute?: IRoute
  garageRoute?: IRoute
  duration: number
  distance: number
}

export interface ISchoolTravelLocation extends ISchool {
  distance?: number
  duration?: number
}

export interface IStudent {
  id: number
  coordinates: Coordinates
  schoolId: number
  reason: 'distance' | 'countryside' | 'barrier' | 'special_need' | 'not_informed' | 'indigenous' | 'judicial_decision'
  usesWheelchair: boolean
  specialNeed: boolean
  arrivalTime: string
  departureTime: string
}

export interface IStudentData extends IStudent {
  distance: number
  duration: number
  stopPointDistance?: number
}

export enum ExcludedReasonEnum {
  disntace = 'distance_exceeded',
  duration = 'duration_exceeded',
  invalidAddress = 'invalid_address',
}

export interface IExcludedStudent extends IStudent {
  distance?: number
  duration?: number
  excludedReason: ExcludedReasonEnum
}

export interface ISchoolLocation {
  id: number
  coordinates: Coordinates
}

export interface ISchool extends ISchoolLocation {
  students: IStudentData[]
}

export interface IStopPoint {
  coordinates: Coordinates
  students: IStudentData[]
}

export interface IRouteStopPoint extends IStopPoint {
  traveledDistance: number
  traveledDuration: number
}

export interface IExclusionZone {
  id?: number
  name?: string
  polygon: Coordinates[]
  vehicleTypeIds: number[]
}

export interface ICalculateRouteConfig {
  minDistance: number
  maxDistance: number
  maxDuration: number
  averageStopDuration: number
  averageStopDurationWheelchair: number
  schoolMaxDistance: number
  stopPointMaxDistance: number
  stopPointMaxDistanceType: 'walk' | 'absolute'
  vehicles: IVehicle[]
  onlySchoolsWithStudent: boolean
  activateGroupingOfSchoolsByArrivalTimes: boolean
  maxToleranceBetweenArrivalTimes: number
  activateGroupingOfSchoolsByDepartureTimes: boolean
  maxToleranceBetweenDepartureTimes: number
  exclusionZones?: IExclusionZone[]
}

export interface ICalculatedLine {
  forwardRoute: IStudentsRoute
  backRoute: IStudentsRoute
  furthestStopPoint: IStopPoint
}

export interface ILineWithVehicle extends ICalculatedLine {
  vehicle: IVehicle
}

export interface IVehicle {
  id?: number
  capacity: number
  kind: string
  vehicleTypeId?: number
  wheelchairSectionCapacity: number
  max_capacity?: boolean
  cost?: number
  costPerKm?: number
}

export interface ICalculateRouterizationResponse {
  lines: ILineWithVehicle[]
  unusedVehicles: IVehicle[]
}

export interface IRouterizationResponse extends ICalculateRouterizationResponse {
  excludedStudents: IExcludedStudent[]
  totalCosts: number
  matrixProvider?: string
  routingProvider?: string
  calculationTime?: number
  studentsCount?: number
}

export interface IRouteData extends CalculateLineServiceResult {
  studentsCapacity: number
  distancePercentage: number
  durationPercentage: number
  students: number
  wheelchairStudentsQuantity: number
  wheelchairStudentsCapacity: number
  validVehicles?: IVehicle[]
  // Tipos da frota própria (vehicleTypeId) aprovados nas restrições de barreira
  // desta rota. Separado de validVehicles (que é o pool de fallback terceirizado).
  allowedOwnTypeIds?: Set<number>
}

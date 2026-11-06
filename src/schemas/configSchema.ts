import { z } from 'zod';

export const configSchema = z.object({
  maxDistance: z.number(),
  maxDuration: z.number(),
  minDistance: z.number(),
  schoolMaxDistance: z.number().optional(),
  averageStopDuration: z.number(),
  averageStopDurationWheelchair: z.number().optional(),
  stopPointMaxDistance: z.number(),
  stopPointMaxDistanceType: z.enum(['walk', 'absolute']).optional(),
  onlySchoolsWithStudent: z.boolean(),
  activateGroupingOfSchoolsByArrivalTimes: z.boolean(),
  maxToleranceBetweenArrivalTimes: z.number(),
  activateGroupingOfSchoolsByDepartureTimes: z.boolean(),
  maxToleranceBetweenDepartureTimes: z.number(),
  vehicles: z.array(z.object({
    capacity: z.number(),
    kind: z.string(),
    vehicleTypeId: z.number().optional(),
    wheelchairSectionCapacity: z.number(),
    max_capacity: z.boolean().optional(),
    cost: z.number().optional(),
    costPerKm: z.number().optional(),
  })),
  exclusionZones: z.array(z.object({
    id: z.number().optional(),
    name: z.string().optional(),
    polygon: z.array(z.tuple([z.number(), z.number()])),
    vehicleTypeIds: z.array(z.number()),
  })).optional(),
});

import { z } from 'zod';
import { configSchema } from './configSchema';

export const coordinatesSchema = z.tuple([z.number(), z.number()]);

export const calculateRouteRequestSchema = z.object({
  schoolsData: z.object({
    id: z.number(),
    coordinates: coordinatesSchema,
    students: z.array(z.object({
      id: z.number(),
      coordinates: coordinatesSchema,
      schoolId: z.number(),
      reason: z.enum(['distance', 'countryside', 'barrier', 'special_need', 'not_informed', 'indigenous', 'judicial_decision']),
      usesWheelchair: z.boolean(),
      specialNeed: z.boolean(),
      arrivalTime: z.string(),
      departureTime: z.string(),
    })),
  }).array(),
  fleetData: z.object({
    id: z.number(),
    capacity: z.number(),
    kind: z.string(),
    vehicleTypeId: z.number().optional(),
    wheelchairSectionCapacity: z.number(),
    max_capacity: z.boolean(),
    cost: z.number().optional(),
    costPerKm: z.number().optional(),
  }).array(),
  config: configSchema.optional(),
  directions: z.array(z.string()),
  async: z.boolean().optional(),
  callbackUrl: z.string().optional()
});

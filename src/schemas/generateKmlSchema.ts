import { z } from 'zod';
import { configSchema } from './configSchema';
import { coordinatesSchema } from './calculateRouteSchema';

export const generateKmlSchema = z.object({
  line: z.object({
    stopPoints: z.array(z.object({
      id: z.number(),
      coordinates: coordinatesSchema,
      name: z.string().nullable().optional(),
    })),
    schools: z.array(z.object({
      id: z.number(),
      coordinates: coordinatesSchema,
      name: z.string().nullable().optional(),
    })),
    studentsRoute: z.string(),
    schoolsRoute: z.string().nullable().optional(),
  }),
  config: configSchema.optional(),
});

import { z } from 'zod';
import { configSchema } from './configSchema';

export const recalculateRouteRequestSchema = z.object({
  line: z.object({
    duration: z.number(),
    distance: z.number(),
    studentsCount: z.number(),
    normal_stop_points_count: z.number(),
    wheelchair_stop_points_count: z.number(),
    routes: z.array(z.object({
      kind: z.string(),
      originalPolyline: z.string(),
      updatedPolyline: z.string(),
      distance: z.number(),
      duration: z.number(),
    })),
  }),
  config: configSchema.optional(),
});

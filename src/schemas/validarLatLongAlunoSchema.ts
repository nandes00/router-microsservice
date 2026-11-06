import { z } from 'zod';

export const alunoSchema = z.object({
  id: z.number(),
  lat: z.string(),
  long: z.string(),
  endereco: z.string().min(1),
});

export const validarLatLongAlunoSchema = z.object({
  distanciaMaxima: z.number().positive(),
  alunos: z.array(alunoSchema).min(1),
});

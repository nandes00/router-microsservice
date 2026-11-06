import { Coordinates } from '@data/coordinates';
import { featureCollection } from '@turf/helpers';
import { Feature } from '../data/coordinates';
// @ts-expect-error: not typed library
import toKml from '@maphubs/tokml';
import { coordinatesToGeoJSON, encodedPolylineToGeoJSON } from '@data/geoJSON';

interface ILineData {
  stopPoints: {
    id: number
    coordinates: Coordinates
    name?: string | null
  }[]
  schools: {
    id: number
    coordinates: Coordinates
    name?: string | null
  }[]
  studentsRoute: string
  schoolsRoute?: string | null
}

export class GenerateKmlService {
  constructor(
    private readonly lineData: ILineData,
  ) { }

  execute(): string {
    const data: Feature[] = [];

    const studentsLine = encodedPolylineToGeoJSON(this.lineData.studentsRoute, { tipo: 'Rota entre alunos' });
    if (studentsLine) data.push(studentsLine);

    if (this.lineData.schoolsRoute) {
      const schoolsLine = encodedPolylineToGeoJSON(this.lineData.schoolsRoute, { tipo: 'Rota entre escolas' });
      if (schoolsLine) data.push(schoolsLine);
    }

    this.lineData.stopPoints.forEach(stopPoint => {
      data.push(coordinatesToGeoJSON(stopPoint.coordinates, {
        id: stopPoint.id,
        tipo: 'Ponto de parada',
        nome: stopPoint.name,
        coordenadas: stopPoint.coordinates,
      }));
    });

    this.lineData.schools.forEach(school => {
      data.push(coordinatesToGeoJSON(school.coordinates, {
        id: school.id,
        tipo: 'Escola',
        nome: school.name,
        coordenadas: school.coordinates,
      }));
    });

    const geoJSON = featureCollection(data as any);

    const kml = toKml(geoJSON);
    return kml;
  }
}

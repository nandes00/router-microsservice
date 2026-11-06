import { calculateAbsoluteDistance, clusterize } from '@data/coordinates';
import { ICalculateRouteConfig, ISchool } from './calculateRoute/interfaces';

type SchoolChunks = ISchool[][];

export class ChunkSchoolsService {
  private readonly chunks: SchoolChunks = [];
  private clustersNumber: number = 2;
  private remainingSchools: ISchool[];

  constructor(
    private readonly schools: ISchool[],
    private readonly config: ICalculateRouteConfig,
    private readonly directions: string[]
  ) {
    this.remainingSchools = this.schools;
  }

  execute(): SchoolChunks {
    let groupOfSchools: ISchool[][] = [];
    const {activateGroupingOfSchoolsByArrivalTimes, activateGroupingOfSchoolsByDepartureTimes} = this.config

    if (this.directions.length == 2) {
      groupOfSchools = activateGroupingOfSchoolsByArrivalTimes ?
        this.groupSchoolsByArrivalTime(this.schools) :
        [this.schools]

      groupOfSchools = activateGroupingOfSchoolsByDepartureTimes ?
        groupOfSchools.flatMap(group => this.groupSchoolsByDepartureTime(group)) :
        groupOfSchools
    }
    else if (activateGroupingOfSchoolsByArrivalTimes && this.directions.includes('forward')) groupOfSchools = this.groupSchoolsByArrivalTime(this.schools)
    else if (activateGroupingOfSchoolsByDepartureTimes && this.directions.includes('back')) groupOfSchools = this.groupSchoolsByDepartureTime(this.schools)
    else groupOfSchools = [this.schools]

    groupOfSchools.forEach((schools) => this.groupSchoolsByDistance(schools))

    return this.chunks;
  }

  private groupSchoolsByArrivalTime(schools: ISchool[]) {
    const groupOfSchools: ISchool[][] = [];

    schools.forEach((school) => {
      school.students.forEach((student) => {
        const studentArrivalTime = this.parseDateToTimestamp(student.arrivalTime);
        let groupFound = false;

        for (let schools of groupOfSchools) {
          if (schools.every(({ students }) => this.respectsArrivalTimeParameters(studentArrivalTime, this.parseDateToTimestamp(students[0].arrivalTime)))) {
            const schoolId = schools.findIndex(({ id }) => id === school.id)

            if (schoolId >= 0) schools[schoolId].students.push(student);
            else schools.push({ ...school, students: [student]});

            groupFound = true;
            break;
          }
        }

        if (!groupFound) {
          groupOfSchools.push([{ ...school, students: [student]}]);
        }
      })
    })

    return groupOfSchools;
  }

  private groupSchoolsByDepartureTime(schools: ISchool[]) {
    const groupOfSchools: ISchool[][] = [];

    schools.forEach((school) => {
      school.students.forEach((student) => {
        const studentDepartureTime = this.parseDateToTimestamp(student.departureTime);
        let groupFound = false;

        for (let schools of groupOfSchools) {
          if (schools.every(({ students }) => this.respectsDepartureTimeParameters(studentDepartureTime, this.parseDateToTimestamp(students[0].departureTime)))) {
            const schoolId = schools.findIndex(({ id }) => id === school.id)

            if (schoolId >= 0) schools[schoolId].students.push(student);
            else schools.push({ ...school, students: [student]});

            groupFound = true;
            break;
          }
        }

        if (!groupFound) {
          groupOfSchools.push([{ ...school, students: [student]}]);
        }
      })
    })

    return groupOfSchools;
  }

  private groupSchoolsByDistance(schools: ISchool[]) {
    if (this.areSchoolsInChunkCloseBy(schools)) return this.chunks.push(schools);

    this.remainingSchools = schools
    this.clustersNumber = 2

    do {
      const mappedClusters = clusterize(this.remainingSchools, this.clustersNumber);
      this.remainingSchools = [];
      const doneClusters: SchoolChunks = [];

      mappedClusters.forEach(cluster => {
        const chunkCandidate = cluster.points;

        if (this.areSchoolsInChunkCloseBy(chunkCandidate)) doneClusters.push(chunkCandidate);
        else this.remainingSchools.push(...chunkCandidate);
      });

      this.clustersNumber = this.clustersNumber - doneClusters.length + 1;
      this.chunks.push(...doneClusters);
    } while (this.remainingSchools.length > 0);
  }

  private parseDateToTimestamp(time: string): number {
    const date = new Date(time);
    return date.valueOf() / 1000;
  }

  private areSchoolsInChunkCloseBy(chunkCandidate: ISchool[]) {
    return chunkCandidate.every((currentSchool) => {
      return chunkCandidate.every((chunkSchool) => {
        const distance = calculateAbsoluteDistance(chunkSchool, currentSchool);
        // TODO: validar se é possivel chegar no tempo
        return distance < this.config.schoolMaxDistance;
      });
    });
  }

  private respectsArrivalTimeParameters(studentArrivalTime: number, schoolArrivalTime: number) {
    return Math.abs(studentArrivalTime - schoolArrivalTime) <= this.config.maxToleranceBetweenArrivalTimes
  }

  private respectsDepartureTimeParameters(studentDepartureTime: number, schoolDepartureTime: number) {
    return Math.abs(studentDepartureTime - schoolDepartureTime) <= this.config.maxToleranceBetweenDepartureTimes
  }
}

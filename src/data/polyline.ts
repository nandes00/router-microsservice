import { calculateAbsoluteDistance, coordinateIsEqual, Coordinates } from './coordinates';

export type Polyline = Coordinates[];

interface IPolylineDiff {
  remotions: Polyline[]
  aditions: Polyline[]
}

export function polylineDiff(original: Polyline, updated: Polyline): IPolylineDiff {
  let originalIndex = 0;
  let updatedIndex = 0;
  let aditionsIndex = 0;
  let remotionsIndex = 0;
  const aditions: Polyline[] = [];
  const remotions: Polyline[] = [];

  const insertPrevAdition = () => {
    aditions[aditionsIndex] = [];
    if (updatedIndex - 1 >= 0) aditions[aditionsIndex]!.push(updated[updatedIndex - 1]);
  };
  const insertCurrentAdition = () => {
    aditions[aditionsIndex]!.push(updated[updatedIndex]);
  };
  const insertNextAdition = () => {
    if (updatedIndex + 1 < updated.length) aditions[aditionsIndex]!.push(updated[updatedIndex + 1]);
  };
  const insertPrevRemotion = () => {
    remotions[remotionsIndex] = [];
    if (originalIndex - 1 >= 0) remotions[remotionsIndex]!.push(original[originalIndex - 1]);
  };
  const insertCurrentRemotion = () => {
    remotions[remotionsIndex]!.push(original[originalIndex]);
  };
  const insertNextRemotion = () => {
    if (originalIndex + 1 < original.length) remotions[remotionsIndex]!.push(original[originalIndex + 1]);
  };

  while (originalIndex < original.length || updatedIndex < updated.length) {
    const originalCurrent = original[originalIndex];
    const originalNext = original[originalIndex + 1];
    const updatedCurrent = updated[updatedIndex];
    const updatedNext = updated[updatedIndex + 1];

    if (coordinateIsEqual(originalCurrent, updatedCurrent)) {
      originalIndex++;
      updatedIndex++;
    } else if (!coordinateIsEqual(originalCurrent, updatedCurrent) && coordinateIsEqual(originalNext, updatedNext)) {
      if (!aditions[aditionsIndex]) insertPrevAdition();
      insertCurrentAdition();
      insertNextAdition();

      if (!remotions[remotionsIndex]) insertPrevRemotion();
      insertCurrentRemotion();
      insertNextRemotion();

      originalIndex++;
      updatedIndex++;

      aditionsIndex++;
      remotionsIndex++;
    } else if (coordinateIsEqual(originalCurrent, updatedNext)) {
      if (!aditions[aditionsIndex]) insertPrevAdition();
      insertCurrentAdition();
      insertNextAdition();

      updatedIndex++;

      aditionsIndex++;
    } else if (coordinateIsEqual(originalNext, updatedCurrent)) {
      if (!remotions[remotionsIndex]) insertPrevRemotion();
      insertCurrentRemotion();
      insertNextRemotion();

      originalIndex++;

      remotionsIndex++;
    } else {
      if (updatedIndex < updated.length) {
        if (!aditions[aditionsIndex]) insertPrevAdition();
        insertCurrentAdition();
        updatedIndex++;
      }
      if (originalIndex < original.length) {
        if (!remotions[remotionsIndex]) insertPrevRemotion();
        insertCurrentRemotion();
        originalIndex++;
      }
    }
  }

  return {
    aditions: aditions.filter((v) => !!v),
    remotions: remotions.filter((v) => !!v),
  };
}

export function lineDistance(polyline: Polyline) {
  let totalDistance = 0;

  for (let index = 0; index < polyline.length - 1; index++) {
    totalDistance += calculateAbsoluteDistance({ coordinates: polyline[index] }, { coordinates: polyline[index + 1] });
  }

  return totalDistance;
}

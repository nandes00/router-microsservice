interface IChunkConfig {
  maxPoints: number
}

const DEFAULT_CONFIG: IChunkConfig = {
  maxPoints: 26,
};

export class ChunkList<ListType> {
  private readonly config: IChunkConfig;
  chunks: { start: number }[] = [];
  private chunksNumber: number = 0;

  constructor(
    private readonly points: ListType[],
    config: Partial<IChunkConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.chunksNumber = Math.ceil(this.points.length / this.config.maxPoints);
    this.createChunks();
  }

  get length() {
    return this.chunksNumber;
  }

  private createChunks() {
    this.chunks = [];
    let startIndex = 0;
    const chunkSize = Math.floor(this.points.length / this.chunksNumber);
    const remaining = this.points.length % this.chunksNumber;

    for (let index = 0; index < this.chunksNumber; index++) {
      this.chunks.push({ start: startIndex });
      startIndex = startIndex + chunkSize + (index < remaining ? 1 : 0);
    }
  }

  increaseChunksNumber() {
    const chunkSize = this.points.length / this.chunksNumber;
    const newChunkSize = Math.max(chunkSize - 1, chunkSize * 0.8);
    const newChunksNumber = Math.ceil(this.points.length / newChunkSize);

    this.chunksNumber = Math.min(newChunksNumber, this.points.length);
    this.createChunks();
  }

  getChunk(index: number) {
    if (index >= this.chunks.length) throw new Error('Out of list bounds!');
    const start = this.chunks[index].start;
    const end = this.chunks[this.nextChunk(index)].start;

    return this.circularSplice(start, end);
  }

  getChunks() {
    const chunks: ListType[][] = [];

    for (let i = 0; i < this.chunks.length; i++) {
      chunks.push(this.getChunk(i));
    }

    return chunks;
  }

  getChunkSize(index: number) {
    const start = this.chunks[index].start;
    const end = this.chunks[this.nextChunk(index)].start;

    if (end < start) {
      return this.points.length - start + end;
    }

    if (start === end) return this.points.length;

    return end - start;
  }

  move(origin: number, direction: 'next' | 'prev', amount: number = 1) {
    if (amount >= this.getChunkSize(origin)) throw new Error('Tried to move too many elements');

    if (direction === 'next') {
      return this.moveNext(origin, amount);
    } else {
      return this.movePrevious(origin, amount);
    }
  }

  moveRight(origin: number, destination: number, amount: number = 1) {
    if (amount >= this.getChunkSize(origin)) throw new Error('Tried to move too many elements');
    if (amount > this.freeSpace(destination)) throw new Error('Chunk cannot exceed max points limit');
    let current = origin;

    const changes = [origin];

    while (current !== destination) {
      current = this.nextChunk(current);
      changes.push(current);
      this.chunks[current].start = this.circularIndex(this.chunks[current].start, -amount);
    }

    return changes;
  }

  freeSpace(index: number) {
    return this.config.maxPoints - this.getChunkSize(index);
  }

  moveNext(origin: number, amount: number = 1) {
    const nextChunk = this.nextChunk(origin);
    // TODO: Não pode remover todos, então: amount >= this.getChunkSize(origin)
    if (amount > this.getChunkSize(origin)) throw new Error('Tried to move too many elements');
    if (amount > this.freeSpace(nextChunk)) throw new Error('Chunk cannot exceed max points limit');

    this.chunks[nextChunk].start = this.circularIndex(this.chunks[nextChunk].start, -amount);

    return nextChunk;
  }

  private movePrevious(origin: number, amount: number) {
    const previousChunk = this.previousChunk(origin);
    if (this.freeSpace(previousChunk) < amount) throw new Error('Chunk cannot exceed max points limit');

    this.chunks[origin].start = this.circularIndex(this.chunks[origin].start, amount);

    return previousChunk;
  }

  private circularSplice(start: number, end: number) {
    if (end < start) {
      return [
        ...this.points.slice(start, this.points.length),
        ...this.points.slice(0, end),
      ];
    }
    if (start === end) {
      return this.points;
    }
    return this.points.slice(start, end < start ? this.points.length : end);
  }

  private circularIndex(currentIndex: number, amount: number) {
    return (((currentIndex + amount) % this.points.length) + this.points.length) % this.points.length;
  }

  nextChunk(index: number) {
    return (index + 1) % this.chunks.length;
  }

  previousChunk(index: number) {
    return ((index - 1) + this.chunks.length) % this.chunks.length;
  }
}

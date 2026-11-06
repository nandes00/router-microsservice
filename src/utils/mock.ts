import { isDeepStrictEqual } from 'util';
import fs from 'fs';
import { success, Result } from '@data/result';

export class RequestMocker {
  private readonly mockDirPath: string = 'fixtures/requests';
  private readonly lockDirPath: string = 'tmp/mock';
  private readonly lockFilePath: string;
  private readonly mockFilePath: string;

  constructor(name: string) {
    this.mockFilePath = `${this.mockDirPath}/${name}.json`;
    this.lockFilePath = `${this.lockDirPath}/mockLock_${name}`;
  }

  async fetchData<Body, Response>(body: Body, fallbackRequest: () => Promise<Result<Response>>) {
    try {
      await this.waitForUnlock();
      const mocks = this.readMock<typeof body, Response>();
      const mockData = mocks.find((mock) => isDeepStrictEqual(mock.body, body));

      if (!mockData) {
        this.lockMock();

        const data = await fallbackRequest();
        const newMock = {
          body, response: data.result,
        };

        if (data.success()) this.writeMock([...mocks, newMock]);

        this.unlockMock();

        return data;
      }

      return success(mockData.response);
    } catch (e) {
      this.unlockMock();
      throw e;
    }
  }

  private readMock<Body, Response>() {
    if (!fs.existsSync(this.mockFilePath)) return [];

    const content = fs.readFileSync(this.mockFilePath, 'utf-8');
    return JSON.parse(content) as { body: Body, response: Response }[];
  }

  private writeMock(data: object) {
    this.createFile(this.mockDirPath, this.mockFilePath, JSON.stringify(data));
  }

  private lockMock() {
    this.createFile(this.lockDirPath, this.lockFilePath, 'mock');
  }

  private unlockMock() {
    if (fs.existsSync(this.lockFilePath)) {
      fs.unlinkSync(this.lockFilePath);
    }
  }

  private createFile(dirPath: string, filePath: string, data: string) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath);
    }
    fs.writeFileSync(filePath, data);
  }

  private async waitForUnlock() {
    await new Promise((resolve) => {
      const interval = setInterval(() => {
        if (!fs.existsSync(this.lockFilePath)) {
          clearInterval(interval);
          resolve(undefined);
        }
      }, 50);
    });
  }
}

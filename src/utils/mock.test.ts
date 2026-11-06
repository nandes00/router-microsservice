import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RequestMocker } from './mock';
import fs from 'fs';
import { success } from '@data/result';

describe('#fetchData', () => {
  describe('there is no mock', () => {
    const mockName = 'testMock';
    const mockPath = `fixtures/requests/${mockName}.json`;
    afterEach(() => {
      if (fs.existsSync(mockPath)) {
        fs.unlinkSync(mockPath);
      }
    });

    describe('fetchData is called', () => {
      const mockBody = { mock: 'body' };
      const mockResponse = { mock: 'result' };
      const fallback = async () => success(mockResponse);
      const fallbackSpy = jest.fn(fallback);

      it('should write a new mock', async () => {
        const result = await new RequestMocker(mockName).fetchData(mockBody, fallbackSpy);

        expect(result.success()).toBe(true);

        if (result.success()) {
          expect(result.result).toEqual(mockResponse);

          const mocks = JSON.parse(fs.readFileSync(mockPath, 'utf-8'));

          expect(mocks).toContainEqual({ body: mockBody, response: mockResponse });
          expect(fallbackSpy).toBeCalledTimes(1);
        }
      });
    });

    describe('fetchData is called twice concurrently with different data', () => {
      const mockBodyA = { mock: 'body A' };
      const mockResponseA = { mock: 'result A' };
      const mockBodyB = { mock: 'body B' };
      const mockResponseB = { mock: 'result B' };
      const fallbackSpyA = jest.fn(async () => success(mockResponseA));
      const fallbackSpyB = jest.fn(async () => success(mockResponseB));

      it('should write a new mock', async () => {
        const requestMocker = new RequestMocker(mockName);

        const [resultA, resultB] = await Promise.all([
          requestMocker.fetchData(mockBodyA, fallbackSpyA), requestMocker.fetchData(mockBodyB, fallbackSpyB),
        ]);

        expect(resultA.success()).toBe(true);
        expect(resultB.success()).toBe(true);

        if (resultA.success() && resultB.success()) {
          expect(resultA.result).toEqual(mockResponseA);
          expect(resultB.result).toEqual(mockResponseB);

          const mocks = JSON.parse(fs.readFileSync(mockPath, 'utf-8'));

          expect(mocks.length).toEqual(2);
          expect(mocks).toContainEqual({ body: mockBodyA, response: mockResponseA });
          expect(mocks).toContainEqual({ body: mockBodyB, response: mockResponseB });
          expect(fallbackSpyA).toBeCalledTimes(1);
          expect(fallbackSpyB).toBeCalledTimes(1);
        }
      });
    });
  });
  describe('a mock already exists', () => {
    const mockName = 'testMock';
    const mockPath = `fixtures/requests/${mockName}.json`;
    const existingMock = {
      body: {
        mock: 'existing body',
      },
      response: {
        mock: 'existing response',
      },
    };
    beforeEach(() => {
      fs.writeFileSync(mockPath, JSON.stringify([existingMock]));
    });

    afterEach(() => {
      if (fs.existsSync(mockPath)) {
        fs.unlinkSync(mockPath);
      }
    });

    describe('fetchData is called for the existing mock', () => {
      const mockBody = existingMock.body;
      const mockResponse = existingMock.response;
      const fallback = async () => success(mockResponse);
      const fallbackSpy = jest.fn(fallback);

      it('should return the existing mock', async () => {
        const result = await new RequestMocker(mockName).fetchData(mockBody, fallbackSpy);

        expect(result.success()).toBe(true);

        if (result.success()) {
          expect(result.result).toEqual(mockResponse);

          const mocks = JSON.parse(fs.readFileSync(mockPath, 'utf-8'));

          expect(mocks).toContainEqual({ body: mockBody, response: mockResponse });
          expect(fallbackSpy).not.toBeCalled();
        }
      });
    });

    describe('fetchData is called for a new mock', () => {
      const mockBody = { mock: 'body' };
      const mockResponse = { mock: 'result' };
      const fallback = async () => success(mockResponse);
      const fallbackSpy = jest.fn(fallback);

      it('should create a new mock and mantain the old one', async () => {
        const result = await new RequestMocker(mockName).fetchData(mockBody, fallbackSpy);

        expect(result.success()).toBe(true);

        if (result.success()) {
          expect(result.result).toEqual(mockResponse);

          const mocks = JSON.parse(fs.readFileSync(mockPath, 'utf-8'));

          expect(mocks.length).toBe(2);
          expect(mocks).toContainEqual(existingMock);
          expect(mocks).toContainEqual({ body: mockBody, response: mockResponse });
          expect(fallbackSpy).toBeCalledTimes(1);
        }
      });
    });
  });
});

import { pLimit } from '../promiseHelper';
import { describe, expect, test } from '@jest/globals';

describe('pLimit Utility Unit Tests', () => {
    test('should execute tasks up to specified concurrency limit', async () => {
        const limit = pLimit(2);
        let activeTasks = 0;
        let maxObservedActiveTasks = 0;

        const createTask = (delayMs: number) => {
            return limit(async () => {
                activeTasks++;
                if (activeTasks > maxObservedActiveTasks) {
                    maxObservedActiveTasks = activeTasks;
                }
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                activeTasks--;
                return true;
            });
        };

        const tasks = [
            createTask(50),
            createTask(50),
            createTask(50),
            createTask(50),
            createTask(50),
        ];

        const results = await Promise.all(tasks);

        expect(results).toEqual([true, true, true, true, true]);
        expect(maxObservedActiveTasks).toBeLessThanOrEqual(2);
    });

    test('should process queued tasks in FIFO order and handle rejections cleanly', async () => {
        const limit = pLimit(1);
        const executionOrder: number[] = [];

        const task1 = limit(async () => {
            executionOrder.push(1);
            return 't1';
        });

        const task2 = limit(async () => {
            executionOrder.push(2);
            throw new Error('Task 2 failed');
        });

        const task3 = limit(async () => {
            executionOrder.push(3);
            return 't3';
        });

        const res1 = await task1;
        await expect(task2).rejects.toThrow('Task 2 failed');
        const res3 = await task3;

        expect(res1).toBe('t1');
        expect(res3).toBe('t3');
        expect(executionOrder).toEqual([1, 2, 3]);
    });
});

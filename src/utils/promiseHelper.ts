/**
 * Utilitário simples para limitar a concorrência de promessas.
 * Semelhante ao p-limit, mas mantendo a simplicidade e eliminando dependências externas.
 */
export function pLimit(concurrency: number) {
    const queue: Array<() => void> = [];
    let activeCount = 0;

    const next = () => {
        activeCount--;
        if (queue.length > 0) {
            queue.shift()!();
        }
    };

    const run = async <T>(fn: () => Promise<T>): Promise<T> => {
        activeCount++;
        try {
            return await fn();
        } finally {
            next();
        }
    };

    const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
            const task = () => run(fn).then(resolve).catch(reject);

            if (activeCount < concurrency) {
                task();
            } else {
                queue.push(task);
            }
        });
    };

    return enqueue;
}

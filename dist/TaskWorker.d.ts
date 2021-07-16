/// <reference types="node" />
import { Worker, WorkerOptions } from 'worker_threads';
import { Task } from './Task';
export declare class TaskWorker extends Worker {
    busy: boolean;
    task: Task;
    rejectCallback: Function;
    resolveCallback: Function;
    id: number;
    constructor(fileName: string, options: WorkerOptions);
    isBusy(): boolean;
    initListeners(): void;
    processTask(task: Task): Promise<any>;
    clenUp(): void;
}
//# sourceMappingURL=TaskWorker.d.ts.map
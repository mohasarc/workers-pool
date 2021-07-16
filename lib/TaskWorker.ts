import { Worker, WorkerOptions } from 'worker_threads';
import { Task } from './Task';

export class TaskWorker extends Worker {
    busy: boolean;
    task: Task;
    rejectCallback: Function;
    resolveCallback: Function;
    id: number;

    constructor(fileName: string, options: WorkerOptions) {
        super(fileName, options);
        this.busy = false;
        this.task;
        this.rejectCallback;
        this.resolveCallback;
        this.initListeners();
    }

    isBusy(): boolean {
        return this.busy;
    }

    initListeners(): void {
        super.on("error", (error) => { // TODO rejectCallback can be undefined
            this.rejectCallback({task: this.task, worker: this, error});
            this.clenUp();
        });

        super.on("messageerror", (error) => {
            this.rejectCallback({task: this.task, worker: this, error});
            this.clenUp();
        });

        super.on("online", () => {
            // console.log("TaskWorker is online");
        });

        super.on("message", (response) => {
            if (response.type == 'success')
                this.resolveCallback({task: this.task, worker: this, result: response.value});
            else if (response.type == 'error')
                this.rejectCallback({task: this.task, worker: this, result: response.value});

            this.clenUp();
        });
    }

    async processTask(task: Task): Promise<any> {
        // Build the message object
        this.busy = true;
        this.task = task;
        var message = {
            filePath : task.filePath,
            functionName : task.functionName,
            params : task.params,
        }

        let promise = new Promise((resolve, reject) => {
            this.resolveCallback = resolve;
            this.rejectCallback = reject;
            super.postMessage(message);
        });

        return promise;
    }

    clenUp(): void {
        this.task = null;
        this.rejectCallback = null;
        this.resolveCallback = null;
        this.busy = false;
    }
}

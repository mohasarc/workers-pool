let counter = 0;

export class Task {
    taskRunnerName: string;
    filePath: string;
    functionName: string;
    params: Array<any>;
    resolveCallback: Function;
    rejectCallback: Function;
    key: number;

    constructor(taskRunnerName: string, 
                params: Array<any>, 
                resolveCallback: Function, 
                rejectCallback: Function, 
                functionName?: string,
                filePath?: string ){

        this.taskRunnerName = taskRunnerName;
        this.filePath = filePath;
        this.functionName = functionName;
        this.params = params;
        this.resolveCallback = resolveCallback;
        this.rejectCallback = rejectCallback;
        this.key = counter++;
    }
}
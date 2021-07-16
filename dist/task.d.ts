export declare class Task {
    taskRunnerName: string;
    filePath: string;
    functionName: string;
    params: Array<any>;
    resolveCallback: Function;
    rejectCallback: Function;
    key: number;
    constructor(taskRunnerName: string, params: Array<any>, resolveCallback: Function, rejectCallback: Function, functionName?: string, filePath?: string);
}
//# sourceMappingURL=task.d.ts.map
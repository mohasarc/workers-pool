module.exports = class Task {
    constructor(taskRunnerName, params, resolveCallback, rejectCallback, filePath, functionName){
        this.taskRunnerName = taskRunnerName;
        this.filePath = filePath;
        this.functionName = functionName;
        this.params = params;
        this.resolveCallback = resolveCallback;
        this.rejectCallback = rejectCallback;
        this.key = Task.counter?Task.counter++:0;
    }
}
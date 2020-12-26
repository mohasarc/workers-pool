module.exports = class Task {
    constructor(filePath, functionName, params, resolveCallback, rejectCallback){
        this.filePath = filePath;
        this.functionName = functionName;
        this.params = params;
        this.resolveCallback = resolveCallback;
        this.rejectCallback = rejectCallback;
        this.key = Task.counter?Task.counter++:0;
    }
}
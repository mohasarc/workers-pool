module.exports = class Task {
    constructor(filePath, functionName, params, callBack){
        this.filePath = filePath;
        this.functionName = functionName;
        this.params = params;
        this.callBack = callBack;
        this.key = Task.counter?Task.counter++:0;
    }
}
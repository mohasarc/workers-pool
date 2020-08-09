module.exports = class TaskHandler {
    constructor(filePath, functionName, pool){
        this.filePath = filePath;
        this.functionName = functionName;
        this.pool = pool;
        this.params = [];
        this.callBack = null;
    }

    run(params, callBack){
        this.pool.enqueueTask(this.filePath, this.functionName, params, callBack);
    }
}
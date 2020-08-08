module.exports = class TaskHandler {
    constructor(filePath, functionName, pool){
        this.filePath = filePath;
        this.functionName = functionName;
        this.pool = pool;
        this.params = [];
        this.callBack = null;
    }

    run(params, callBack){
        if (typeof params != 'undefined')
            this.params = params;
        else
            this.params = [];
        
        if (typeof callBack != 'undefined')
            this.callBack = callBack;
        else
            this.callBack = null;

        this.pool.enqueueTask(this);
    }
}
module.exports = class TaskHandler {
    /**
     * 
     * @param {String} filePath The path of the file containing the function to be run
     * @param {String} functionName The name of function to be run
     * @param {Pool} pool The pool instance that generated this TaskHandler
     */
    constructor(filePath, functionName, pool){
        this.filePath = filePath;
        this.functionName = functionName;
        this.pool = pool;
        this.params = [];
        this.callBack = null;
    }

    /**
     * Runs the task with the given parameter list, The call back function
     * is called whenever the function finishes executing.
     * @param {Array} params The parameters to be passed to the function
     * @param {Function} resolveCallback A callback function that is called when the task has finished executing successfully
     * @param {Function} rejectCallback A callback function that is called when the task has been rejected for some reason
     */
    run(params, resolveCallback, rejectCallback){
        this.pool.enqueueTask(this.filePath, this.functionName, params, resolveCallback, rejectCallback);
    }
}
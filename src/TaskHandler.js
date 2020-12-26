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
     * @param {Function} callBack A callback function that is called when the task has finished executing
     */
    run(params, callBack){
        this.pool.enqueueTask(this.filePath, this.functionName, params, callBack);
    }
}
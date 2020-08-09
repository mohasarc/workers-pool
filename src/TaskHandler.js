module.exports = class TaskHandler {
    /**
     * 
     * @param {The path of the file containing the function to be run} filePath 
     * @param {The name of function to be run} functionName 
     * @param {The pool instance that generated this TaskHandler} pool 
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
     * @param {The parameters to be passed to the function} params 
     * @param {A callback function that is called when the task has finished executing} callBack 
     */
    run(params, callBack){
        this.pool.enqueueTask(this.filePath, this.functionName, params, callBack);
    }
}
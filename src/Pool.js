const TaskHandler = require('./TaskHandler');
const {Worker} = require('worker_threads');
const path = require('path');
const {MESSAGE_CHANNEL} = require('./constants');
const Task = require('./task');

module.exports = class Pool{
    /**
     * The constructor of Pool class
     * @param {Number} n The number of threads (default is the number of cpu cores - 1)
     * @param {Object} options The optional options used in creating workers
     */
    constructor(n, options){
        this.workersPool = []; // contains the workers
        this.taskQueue   = []; // contains the tasks to be processed
        this.activeTasks = []; // contains the tasks being processed
        this.processed = {};   // {taskKey:boolean} whether a task has been processed yet

        this._initWorkerPool(n, options);
    }

    /**
     * @private
     * Initiates the workers pool by creating the worker threads
     * @param {Number} n The number of threads (default is the number of cpu cores - 1) 
     * @param {Object} options The optional options used in creating workers
     */
    _initWorkerPool(n, optionas){
        // Create n number of workers and set them to be not busy
        for (var i = 0; i < n; i++){
            var _worker = new Worker(path.join(__dirname, 'worker.js'), optionas);
            _worker.busy = false;
            this._initMessageListener(_worker);
            this.workersPool.push(_worker);
        }
    }

    /**
     * Generates and returns a task handler to be used to run the task frequently
     * without the overhead of rewriting the file path, function name, and calling 
     * pool.enqueue task each time the function is called
     * @param {String} filePath The path of the file containing the function to be run
     * @param {String} functionName The name of function to be run
     * @return a TaskHandler object that stores the task information
     */
    getTaskHandler(filePath, functionName){
        return new TaskHandler(filePath, functionName, this);
    }

    /**
     * Generates an asynchronous promise based function out of a synchronous one
     * @param {String} filePath 
     * @param {String} functionName 
     */
    getAsyncFunc(filePath, functionName){
        var self = this;

        return async function (...params) {
            return new Promise((resolve, reject) => {
                self.enqueueTask(filePath, functionName, params, (result) => {
                    resolve(result);
                });
            });
        }
    }

    /**
     * Enqueues a task to be processed when an idle worker thread is available
     * @param {String} filePath The path of the file containing the function to be run
     * @param {String} functionName The name of function to be run
     * @param {Array} params The parameters to be passed to the function
     * @param {Function} callBack A callback function that is called when the task has finished executing
     */
    enqueueTask(filePath, functionName, params, callBack){
        let task = new Task(filePath, functionName, params, callBack);
        this.taskQueue.push(task);
        this._processTasks();
    }

    /**
     * @private
     * Checks if there are any pending tasks and if there are any idle
     * workers to process them, prepares them for processing, and processes
     * them.
     */
    _processTasks(){
        while (this.taskQueue.length > 0 && this.workersPool.length > 0){
            // remove a free worker from the beginings of the array
            var worker = this.workersPool.shift();
            worker.busy = true;

            // remove the first item in the tasks queue
            var task = this.taskQueue.shift();
            this.activeTasks.push(task);

            // set its key as not processed
            this.processed[task.key] = false;

            // Build the message object
            var message = {
                filePath : task.filePath,
                functionName : task.functionName,
                params : task.params,
                key : task.key,
            }

            // send the task to the worker to be processed
            worker.postMessage(message);
        }
    }

    /**
     * @private
     * Initializes the parent's listener to the child thread's messages
     */
    _initMessageListener(worker){
        worker.on(MESSAGE_CHANNEL, (returnMessage) => {
            if (!this.processed[returnMessage.key]){
                this.processed[returnMessage.key] = true;
                
                // get the callBack
                var callBack;
                this.activeTasks.map( (task, i) => {
                    if (task.key == returnMessage.key){
                        callBack = task.callBack;
                        this.activeTasks.splice(i, 1);
                    }
                });

                // call the callback
                callBack(returnMessage.result);
            
                // mark the worker as not busy and add it back to the pool
                worker.busy = false;
                this.workersPool.unshift(worker);

                // a worker is freed, check if there is any task to be processed
                this._processTasks();
            }
        });
    }

    /**
     * Terminates all the tasks. If forced is true it will not wait for the
     * active tasks to finish.
     * @param {boolean} forced To terminate immediately
     */
    terminate(forced){
        // TODO to be implemented
    }

    /**
     * The current status of the pool
     * @param {boolean} detailed If true the information will be detailed
     */
    status(detailed){
        // TODO to be implemented
    }
}
const TaskHandler = require('./TaskHandler');
// const {Worker} = require('worker_threads');
const path = require('path');
const {MESSAGE_CHANNEL} = require('./constants');
const Task = require('./task');
const os = require('os');
const TaskWorker = require('./TaskWorker');
const {isMainThread} = require('worker_threads');
const getCallerFile = require('get-caller-file');
const CPU_CORES_NO = os.cpus().length;
var instantiatedPools = [];

module.exports = class Pool{
    /**
     * The constructor of Pool class
     * @param {Number} n The number of threads (default is the number of cpu cores - 1)
     * @param {Object} options The optional options used in creating workers
     */
    constructor(n = CPU_CORES_NO - 1, options){
        this.workersPool = []; // contains the idle workers
        this.busyWorkers = []; // contains the busy workers (processing code)
        this.taskQueue   = []; // contains the tasks to be processed
        this.activeTasks = []; // contains the tasks being processed
        this.processed = {};   // {taskKey:boolean} whether a task has been processed yet
        this.workersNo = n;

        instantiatedPools.push(this);
        this.poolNo = instantiatedPools.length - 1;

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
            var _worker = new TaskWorker(path.join(__dirname, 'worker.js'), optionas);
            _worker.busy = false;
            // this._initMessageListener(_worker);
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
    getAsyncFunc({func, filePath, functionName}){
        if (isMainThread){
            var self = this;
    
            if (!filePath && !functionName){
                filePath = getCallerFile();
                functionName = func.name;
            }
    
            return async function (...params) {
                return new Promise((resolve, reject) => {
                    self.enqueueTask(filePath, functionName, params, 
                        (result) => {
                            resolve(result);
                        }, 
                        (error) => {
                            reject(error);
                        }
                    );
                });
            }
        }
    }

    /**
     * Enqueues a task to be processed when an idle worker thread is available
     * @param {String} filePath The path of the file containing the function to be run
     * @param {String} functionName The name of function to be run
     * @param {Array} params The parameters to be passed to the function
     * @param {Function} resolveCallback A callback function that is called when the task has finished executing successfully
     * @param {Function} rejectCallback A callback function that is called when the task has been rejected for some reason
     */
    enqueueTask(filePath, functionName, params, resolveCallback, rejectCallback){
        let task = new Task(filePath, functionName, params, resolveCallback, rejectCallback);
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
            this.busyWorkers.push(worker);
            worker.busy = true;

            // remove the first item in the tasks queue
            var task = this.taskQueue.shift();
            this.activeTasks.push(task);

            // set its key as not processed
            this.processed[task.key] = false;

            worker.processTask(task).then((result) => {
                task.resolveCallback(result);
            }).catch((error) => {
                task.rejectCallback(error);
            }).finally(() => {
                worker.busy = false;
                this.workersPool.unshift(worker);
                this.busyWorkers = this.busyWorkers.filter(busyWorker => busyWorker !== worker);

                // a worker is freed, check if there is any task to be processed
                this._processTasks();
            });
        }
    }

    /**
     * Terminates all the tasks. If forced is true it will not wait for the
     * active tasks to finish.
     * @param {boolean} forced To terminate immediately
     */
    terminate(forced){
        this.taskQueue = [];

        this.workersPool.map(worker => {
            worker.terminate();
        });

        if (forced){
            this.busyWorkers.map(worker => {
                worker.terminate();
            });
        }
    }

    /**
     * The current status of the pool
     * @param {boolean} detailed If true the information will be detailed
     */
    static status(detailed){
        console.log('Number of pools: ', instantiatedPools.length);

        instantiatedPools.map( pool => {
            console.log(`---------- POOL ${pool.poolNo} ----------`)
            console.log('Number of idle workers: ', pool.workersPool.length);
            console.log('Number of busy workers: ', pool.workersNo - pool.workersPool.length);
            console.log('Number of active tasks: ', pool.activeTasks.length);
            console.log('Number of Waiting tasks: ', pool.taskQueue.length); 
            
            if (detailed) {
                console.log('\nActive tasks: \n');
                pool.activeTasks.map((task, i) => {
                    console.log(i,' : ', JSON.stringify(task), '\n');
                });
        
                console.log('Waiting tasks: \n');
                pool.taskQueue.map((task, i) => {
                    console.log(i,' : ', JSON.stringify(task), '\n');
                });
            }
        });
    }
}
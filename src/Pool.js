const path = require('path');
const os = require('os');
const { isMainThread } = require('worker_threads');
const getCallerFile = require('get-caller-file');
const Mutex = require('async-mutex').Mutex;
const Task = require('./task');
const TaskHandler = require('./TaskHandler');
const TaskWorker = require('./TaskWorker');

const CPU_CORES_NO = os.cpus().length;
const wp_mutex = new Mutex();
const bw_mutex = new Mutex();
const tq_mutex = new Mutex();
const at_mutex = new Mutex();
const pc_mutex = new Mutex();
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
        this.processingInterval = null;
        this.intervalLength = 5;
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
            _worker.id = i;
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
    
            // Identifying the filePath and functionName in case they're undefined
            if (!filePath && !functionName){
                filePath = getCallerFile();
                functionName = func.name;
            }
    
            return async function (...params) {
                return new Promise((resolve, reject) => {
                    self.enqueueTask({func, filePath, functionName, params, 
                        resolveCallback: (result) => {
                            resolve(result);
                        }, 
                        rejectCallback: (error) => {
                            reject(error);
                        }
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
    async enqueueTask({func, filePath, functionName, params, resolveCallback, rejectCallback}){
        // Identifying the filePath and functionName in case they're undefined
        if (!filePath && !functionName){
            filePath = getCallerFile();
            functionName = func.name;
        }

        let task = new Task(filePath, functionName, params, resolveCallback, rejectCallback);
        // let tq_release = await tq_mutex.acquire();
        this.taskQueue.push(task);
        // tq_release();

        if (!this.processingInterval) {
            this._startTaskProcessing();
        }
    }

    /**
     * @private
     * Checks if there are any pending tasks and if there are any idle
     * workers to process them, prepares them for processing, and processes
     * them.
     */
    async _startTaskProcessing(){
        var worker;
        if (this.processingInterval != null) {
            return;
        }
        this.processingInterval = setInterval(async () => {
            // let wp_release = await wp_mutex.acquire();
            // let tq_release = await tq_mutex.acquire();
            
            if (this.taskQueue.length < 1) {
                this.stopProcessing();
                // tq_release();
                // wp_release();
            } else {
                for (let task of this.taskQueue) {
                    if (this.workersPool.length > 0) {
                        // let bw_release = await bw_mutex.acquire();
                        // let at_release = await at_mutex.acquire();
                        // let pc_release = await pc_mutex.acquire();

                        // remove a free worker from the beginings of the array
                        worker = this.workersPool.shift();
                        this.busyWorkers.push(worker);
                        task = this.taskQueue.shift();
                        this.activeTasks.push(task);
                        this.processed[task.key] = false;
    
                        worker.processTask(task).then((answer) => {
                            answer.task.resolveCallback(answer.result);
                            this.updateWorkersQueue(answer);
                        }).catch((answer) => {
                            answer.task.rejectCallback(answer.error);
                            this.updateWorkersQueue(answer);
                        });
                        
                        // at_release();
                        // bw_release();
                        // pc_release();
                    } else {
                        break;
                    }
                }
                
                // tq_release();
                // wp_release();
            }
        }, this.intervalLength);
    }

    /**
     * 
     */
    stopProcessing(){
        if (this.processingInterval){
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
    }

    /**
     * 
     * @param {*} answer 
     */
    async updateWorkersQueue (answer) {
        // let wpi_release = await wp_mutex.acquire()
        // let bwi_release = await bw_mutex.acquire()
        this.workersPool.unshift(answer.worker);
        this.busyWorkers = this.busyWorkers.filter(busyWorker => busyWorker.id !== answer.worker.id);
        
        // bwi_release();
        // wpi_release();
    }

    /**
     * Terminates all the tasks. If forced is true it will not wait for the
     * active tasks to finish.
     * @param {boolean} forced To terminate immediately
     */
    terminate(forced){
        // tq_mutex.acquire().then((tq_release) => {
            this.taskQueue = [];
            // tq_release();

            // wp_mutex.acquire().then((wp_release) => {
                this.workersPool.map(worker => {
                    worker.terminate();
                });
                this.workersPool = [];
                // wp_release();

                if (forced){
                    // bw_mutex.acquire().then((bw_release) => {
                        this.busyWorkers.map(worker => {
                            worker.terminate();
                        });
                        this.busyWorkers = [];
                        // bw_release();
                    // });
                }
            // });
        // });
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
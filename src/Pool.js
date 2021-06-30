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
var Mutex = require('async-mutex').Mutex;
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
        console.log("CONSTRUCTOR IS CALLED!!");
        this.workersPool = []; // contains the idle workers
        this.busyWorkers = []; // contains the busy workers (processing code)
        this.taskQueue   = []; // contains the tasks to be processed
        this.activeTasks = []; // contains the tasks being processed
        this.processed = {};   // {taskKey:boolean} whether a task has been processed yet
        this.workersNo = n;
        this.processingInterval = null;
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
        console.log("_initWorkerPool is called!!!")
        // Create n number of workers and set them to be not busy
        for (var i = 0; i < n; i++){
            var _worker = new TaskWorker(path.join(__dirname, 'worker.js'), optionas);
            _worker.busy = false;
            console.log("setting the worker's ID: ", i);
            _worker.id = i;
            // this._initMessageListener(_worker);
            this.workersPool.push(_worker);
        }
        console.log("THE WORKERS WERE INITIALIZED!!");
        // console.log("the workers list: ", this.workersPool);
        // Heeee
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
                // console.log("THE RETURNED FUNCTION IS CALLED!!!!!!!")
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
        let tq_release = await tq_mutex.acquire();
        this.taskQueue.push(task);
        tq_release();

        // console.log("A task has been enqueued");
        // console.log(this.taskQueue.length);
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
        // console.log("calling startProcessing");
        var worker;
        if (this.processingInterval != null){
            // console.log("THE PROCESSING INTERVAL IS NOT NULL");
            return;
        } else {
            // console.log("THE PROCESSING INTERVAL IS NULL");
        }

        // console.log("SETTNIG INTERVAL");
        this.processingInterval = setInterval(async () => {
            let wp_release = await wp_mutex.acquire();
            let tq_release = await tq_mutex.acquire();
            
            if (this.taskQueue.length < 1) {
                this.stopProcessing();
                // console.log("processing stopped");
                tq_release();
                wp_release();
            } else {
                for (let task of this.taskQueue) {
                    if (this.workersPool.length > 0) {
                        // remove a free worker from the beginings of the array
                        worker = this.workersPool.shift();
                        // console.log("using worker with id : ", worker.id);
                        // console.log("THE WORKERS ARRAY: ", this.workersPool);
                        worker.busy = true;
                        let bw_release = await bw_mutex.acquire();
                        this.busyWorkers.push(worker);
                        task = this.taskQueue.shift();
                        let at_release = await at_mutex.acquire();
                        this.activeTasks.push(task);
                        let pc_release = await pc_mutex.acquire();
                        this.processed[task.key] = false;
    
                        at_release();
                        bw_release();
                        pc_release();
                        
                        worker.processTask(task).then((answer) => {
                            answer.task.resolveCallback(answer.result);
                            // console.log("~~~~~~~~ try did set answer~~");
                            this.updateWorkersQueue(answer);
                        }).catch((answer) => {
                            answer.task.rejectCallback(answer.error);
                            // console.log("~~~~~~~~ catch did set answer~~");
                            this.updateWorkersQueue(answer);
                        });
                    } else {
                        break;
                    }
                }
                
                tq_release();
                wp_release();
            }
        }, 50);
    }

    stopProcessing(){
        if (this.processingInterval){
            // console.log("INTERVAL CLEANED");
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        } else {
            // console.log("THERE IS NO INTERVAL")
        }
    }

    async updateWorkersQueue (answer) {
        answer.worker.busy = false;
        let wpi_release = await wp_mutex.acquire()
        let bwi_release = await bw_mutex.acquire()
        this.workersPool.unshift(answer.worker);
        this.busyWorkers = this.busyWorkers.filter(busyWorker => busyWorker.id !== answer.worker.id);
        
        // console.log("removing worker with id ", answer.worker.id, " from busy workers");
        // console.log("busy workers now no: ", this.busyWorkers.length);
        
        bwi_release();
        wpi_release();
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
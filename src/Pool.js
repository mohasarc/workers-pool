const path = require('path');
const os = require('os');
const { isMainThread } = require('worker_threads');
const getCallerFile = require('get-caller-file');
const Mutex = require('async-mutex').Mutex;
const Task = require('./task');
const TaskWorker = require('./TaskWorker');
const { genetateScript } = require('./scriptGenerator');

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
     * @param {number} n The number of threads (default is the number of cpu cores - 1)
     * @param {Object} options The optional options used in creating workers
     * @param {Task[]} options.taskRunners An array of all the taskRunners for the pool
     * @param {number} options.totThreadCount The total number of threads wanted
     * @param {boolean} options.lockTaskRunnersToThreads Whether or not to have dedicated threads for the taskRunners
     * @param {boolean} options.AllowDynamicTaskRunnerAddition Whether or not to allow adding more task runners
     */
    constructor(options){
        if (isMainThread) {
            this.workersPool = new Map(); // contains the idle workers
            this.busyWorkers = new Map(); // contains the busy workers (processing code)
            this.taskQueue   = new Array(); // contains the tasks to be processed
            this.activeTasks = new Array(); // contains the tasks being processed
            this.processed = new Map();   // {taskKey:boolean} whether a task has been processed yet
            this.dynamicTaskRunnerList = new Array();
            
            this.options = options;
            this.processingInterval = null;
            this.intervalLength = 5;
            this.staticTaskRunnerThreadCount = 0;
            this.options.callerPath = getCallerFile();
            
            this._validateOptions();
            this._initWorkerPool();
            
            instantiatedPools.push(this);
            this.poolNo = instantiatedPools.length - 1;
        }
    }

    /**
     * @private
     * Initiates the workers pool by creating the worker threads
     */
    _initWorkerPool(){
        let taskRunnersCount = this.options.taskRunners?this.options.taskRunners.length:0;
        let filePath = this.options.callerPath;

        for (var i = 0; i < taskRunnersCount; i++){
            let functionName = this.options.taskRunners[i].job.name;
            let name = this.options.taskRunner[i].name;
            let threadCount = this.options.taskRunners[i].threadCount;
            let lockToThreads = this.options.lockTaskRunnersToThreads;
            this._addTaskRunner({name, threadCount, lockToThreads, filePath, functionName});
        }

        // Make all others dynamic
        for (let k = 0; k < (this.options.totThreadCount - taskRunnersCount); k++) {
            let _worker = new TaskWorker(genetateScript('dynamic'), {eval: true});
            _worker.busy = false;
            _worker.id = i;
            
            if (!this.workersPool['dynamic']) {
                this.workersPool['dynamic'] = [];
            }
            
            this.workersPool['dynamic'].push(_worker);
        }
    }

    /**
     * @private
     */
    _validateOptions() {
        let threadCountOfTaskRunners = 0;

        if (this.options.taskRunners) {
            this.options.taskRunners.map((taskRunner) => {
                if (!taskRunner.name) {
                    throw new Error("Every task runner should have a name");
                }

                if (!taskRunner.threadCount) {
                    taskRunner.threadCount = Math.floor(this.options.totThreadCount/this.options.taskRunners.length);
                    console.warn(`The task ${taskRunner.name} has no thread count specified; 
                                  therefore, ${taskRunner.threadCount} is assigned to it`)
                }

                threadCountOfTaskRunners += taskRunner.threadCount;
            });  
        }

        if (threadCountOfTaskRunners > this.options.threadCount) {
            console.warn(`The total number of threads requested by task runners (${threadCountOfTaskRunners})
                          exceeds the total number of threads specified (${this.options.threadCount}). The total 
                          number of threads is updated to match the number of threads 
                          requested by task runners`);
            this.options.threadCount = threadCountOfTaskRunners;
        }

        if (this.options.threadCount < 1) {
            throw new Error('threadCount cannot be less than 1');
        }

        if (!this.options.threadCount) {
            this.options.threadCount = CPU_CORES_NO - 1;
        }

        if (!this.options.lockTaskRunnersToThreads) {
            this.options.lockTaskRunnersToThreads = true;
        }

        if (!this.options.AllowDynamicTaskRunnerAddition) {
            this.options.AllowDynamicTaskRunnerAddition = true;
        }
    }

    _addTaskRunner({name, threadCount, lockToThreads, filePath, functionName}) {
        if (lockToThreads) {
            if (!threadCount || threadCount > this.options.totThreadCount - this.staticTaskRunnerThreadCount) {
                if (this.dynamicTaskRunnerList.length > 0) {
                    threadCount = this.options.totThreadCount - this.staticTaskRunnerThreadCount - 1;
    
                    if (threadCount === 0)
                        throw new Error('There are no enough free threads');
                } else {
                    threadCount = this.options.totThreadCount - this.staticTaskRunnerThreadCount;
                }

                this.staticTaskRunnerThreadCount += threadCount;
            }

            // Create the new worker
            for (let i = 0; i < threadCount; i++) {
                let _worker = new TaskWorker(genetateScript('static', filePath, functionName), {eval: true});
                _worker.busy = false;
                _worker.id = i;
                this.workersPool[name].push(_worker);
            }
        } else {
            if (this.staticTaskRunnerThreadCount === this.options.totThreadCount) {
                throw new Error('There are no enough free threads');
            }

            this.dynamicTaskRunnerList.push({name, functionName, filePath});
        }
    }

    addTaskRunner({name, job, threadCount, lockToThreads}) {
        filePath = getCallerFile();
        functionName = job.name;

        this._addTaskRunner({name, threadCount, lockToThreads, filePath, functionName});
    }

    /**
     * Generates an asynchronous promise based function out of a synchronous one
     * @param {String} filePath 
     * @param {String} functionName 
     */
    getAsyncFunc(taskRunnerName){
        if (isMainThread){
            var self = this;
            
            if (!this.workersPool[taskRunnerName] && !this.workersPool['dynamic'])
                throw new Error(`There is no task runner with the name ${taskRunnerName}`)

            return async function (...params) {
                return new Promise((resolve, reject) => {
                    let resolveCallback = (result) => {
                        resolve(result);
                    };

                    let rejectCallback = (error) => {
                        reject(error);
                    };

                    self.enqueueTask( new Task(taskRunnerName, params, resolveCallback, rejectCallback));
                });
            }
        }
    }

    /**
     * Enqueues a task to be processed when an idle worker thread is available
     * @param {Task} task The task to be run 
     */
    async enqueueTask(task){
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
                    if (this.busyWorkersCount !== this.totThreadCount) {
                        // let bw_release = await bw_mutex.acquire();
                        // let at_release = await at_mutex.acquire();
                        // let pc_release = await pc_mutex.acquire();

                        // remove a free worker from the beginings of the array
                        if (!this.workersPool[task.taskRunnerName]) {
                            let taskRunnerInfo = this.dynamicTaskRunnerList.find(dynamicTaskRunner => dynamicTaskRunner.name === task.taskRunnerName);
                            let filePath = taskRunnerInfo.filePath;
                            let functionName = taskRunnerInfo.functionName;
                            
                            task.taskRunnerName = 'dynamic';
                            task.filePath = filePath;
                            task.functionName = functionName;
                        }

                        worker = this.workersPool[task.taskRunnerName].shift();
                        this.busyWorkers[task.taskRunnerName].push(worker);
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
        this.workersPool[answer.task.taskRunnerName].unshift(answer.worker);
        this.busyWorkers[answer.task.taskRunnerName] = this.busyWorkers[answer.task.taskRunnerName]
                                                            .filter(busyWorker => busyWorker.id !== answer.worker.id);
        
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
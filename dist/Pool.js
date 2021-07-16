"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Pool = void 0;
const task_1 = require("./task");
const TaskWorker_1 = require("./TaskWorker");
const path = require('path');
const os = require('os');
const { isMainThread } = require('worker_threads');
const getCallerFile = require('get-caller-file');
const { genetateScript } = require('./ScriptGenerator');
const DYNAMIC = 'dynamic';
const STATIC = 'static';
const CPU_CORES_NO = os.cpus().length;
var instantiatedPools = [];
let counter = 0;
class Pool {
    /**
     * The constructor of Pool class
     * @param {number} n The number of threads (default is the number of cpu cores - 1)
     * @param {WorkersPoolOptions} options The optional options used in creating workers
     */
    constructor(options) {
        if (isMainThread) {
            this.workersPool = new Map(); // contains the idle workers
            this.busyWorkers = new Map(); // contains the busy workers (processing code)
            this.taskQueue = new Array(); // contains the tasks to be processed
            this.activeTasks = new Array(); // contains the tasks being processed
            this.processed = new Map(); // {taskKey:boolean} whether a task has been processed yet
            this.dynamicTaskRunnerList = new Array();
            this.busyWorkersCount = 0;
            this.options = options;
            this.processingInterval = null;
            this.intervalLength = 1;
            this.staticTaskRunnerThreadCount = 0;
            this.validateOptions();
            this.initWorkerPool(getCallerFile());
            instantiatedPools.push(this);
            this.poolNo = instantiatedPools.length - 1;
        }
    }
    /**
     * Initiates the workers pool by creating the worker threads
     */
    initWorkerPool(callerPath) {
        let taskRunnersCount = this.options.taskRunners ? this.options.taskRunners.length : 0;
        let filePath = callerPath;
        let totalStaticThreads = 0;
        for (var i = 0; i < taskRunnersCount; i++) {
            let functionName = this.options.taskRunners[i].job.name;
            let name = this.options.taskRunners[i].name;
            let threadCount = this.options.taskRunners[i].threadCount;
            let lockToThreads = this.options.lockTaskRunnersToThreads;
            totalStaticThreads += threadCount;
            this._addTaskRunner({ name, threadCount, lockToThreads, filePath, functionName });
        }
        // Make all others dynamic
        for (let k = 0; k < (this.options.totalThreadCount - totalStaticThreads); k++) {
            let _worker = new TaskWorker_1.TaskWorker(genetateScript(DYNAMIC), { eval: true });
            _worker.busy = false;
            _worker.id = i;
            if (!this.workersPool.has(DYNAMIC)) {
                this.workersPool.set(DYNAMIC, new Array());
            }
            this.workersPool.get(DYNAMIC).push(_worker);
        }
    }
    /**
     */
    validateOptions() {
        let threadCountOfTaskRunners = 0;
        if (this.options.taskRunners) {
            this.options.taskRunners.map((taskRunner) => {
                if (!taskRunner.name) {
                    throw new Error("Every task runner should have a name");
                }
                if (!taskRunner.threadCount) {
                    taskRunner.threadCount = Math.floor(this.options.totalThreadCount / this.options.taskRunners.length);
                    console.warn(`The task ${taskRunner.name} has no thread count specified; 
                                  therefore, ${taskRunner.threadCount} is assigned to it`);
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
        if (!this.options.allowDynamicTaskRunnerAddition) {
            this.options.allowDynamicTaskRunnerAddition = true;
        }
    }
    /**
     *
     * @param param0
     */
    _addTaskRunner({ name, threadCount, lockToThreads, filePath, functionName }) {
        if (lockToThreads) {
            if (!threadCount || threadCount > this.options.totalThreadCount - this.staticTaskRunnerThreadCount) {
                if (this.dynamicTaskRunnerList.length > 0) {
                    threadCount = this.options.totalThreadCount - this.staticTaskRunnerThreadCount - 1;
                    if (threadCount === 0)
                        throw new Error('There are no enough free threads');
                }
                else {
                    threadCount = this.options.totalThreadCount - this.staticTaskRunnerThreadCount;
                }
                this.staticTaskRunnerThreadCount += threadCount;
            }
            // Create the new worker
            for (let i = 0; i < threadCount; i++) {
                let pathArr = path.normalize(filePath).split(path.sep);
                filePath = '';
                pathArr.map((seg, i) => {
                    filePath += seg;
                    if (i != pathArr.length - 1)
                        filePath += '\\\\';
                });
                let _worker = new TaskWorker_1.TaskWorker(genetateScript(STATIC, filePath, functionName), { eval: true });
                _worker.busy = false;
                _worker.id = i;
                if (!this.workersPool.has(name)) {
                    this.workersPool.set(name, new Array());
                }
                this.workersPool.get(name).push(_worker);
            }
        }
        else {
            if (this.staticTaskRunnerThreadCount === this.options.totalThreadCount) {
                throw new Error('There are no enough free threads');
            }
            this.dynamicTaskRunnerList.push({ name, functionName, filePath });
        }
    }
    /**
     *
     * @param taskRunner
     */
    addTaskRunner(taskRunner) {
        let { name, job, threadCount, lockToThreads } = taskRunner;
        let filePath = getCallerFile();
        let functionName = job.name;
        this._addTaskRunner({ name, threadCount, lockToThreads, filePath, functionName });
    }
    /**
     * Generates an asynchronous promise based function out of a synchronous one
     * @param {string} taskRunnerName
     */
    getAsyncFunc(taskRunnerName) {
        if (isMainThread) {
            var self = this;
            if (!this.workersPool.get(taskRunnerName) && !this.workersPool.get(DYNAMIC))
                throw new Error(`There is no task runner with the name ${taskRunnerName}`);
            return async function (...params) {
                counter++;
                return new Promise((resolve, reject) => {
                    let resolveCallback = (result) => {
                        resolve(result);
                    };
                    let rejectCallback = (error) => {
                        reject(error);
                    };
                    let task = new task_1.Task(taskRunnerName, params, resolveCallback, rejectCallback);
                    self.enqueueTask(task);
                });
            };
        }
    }
    /**
     * Enqueues a task to be processed when an idle worker thread is available
     * @param {Task} task The task to be run
     */
    async enqueueTask(task) {
        this.taskQueue.push(task);
        if (!this.processingInterval) {
            this.startTaskProcessing();
        }
    }
    /**
     * Checks if there are any pending tasks and if there are any idle
     * workers to process them, prepares them for processing, and processes
     * them.
     */
    async startTaskProcessing() {
        var worker;
        if (this.processingInterval != null) {
            return;
        }
        this.processingInterval = setInterval(async () => {
            if (this.taskQueue.length < 1) {
                this.stopProcessing();
            }
            else {
                for (let task of this.taskQueue) {
                    if (this.busyWorkersCount !== this.options.totalThreadCount) {
                        // remove a free worker from the beginings of the array
                        if (!this.workersPool.get(task.taskRunnerName)) {
                            let taskRunnerInfo = this.dynamicTaskRunnerList.find(dynamicTaskRunner => dynamicTaskRunner.name === task.taskRunnerName);
                            let filePath = taskRunnerInfo.filePath;
                            let functionName = taskRunnerInfo.functionName;
                            task.taskRunnerName = DYNAMIC;
                            task.filePath = filePath;
                            task.functionName = functionName;
                        }
                        worker = this.workersPool.get(task.taskRunnerName).shift();
                        if (worker) {
                            if (!this.busyWorkers.has(task.taskRunnerName))
                                this.busyWorkers.set(task.taskRunnerName, new Array());
                            this.busyWorkers.get(task.taskRunnerName).push(worker);
                            task = this.taskQueue.shift();
                            this.activeTasks.push(task);
                            this.processed.set(task.key, false);
                            this.busyWorkersCount++;
                            worker.processTask(task).then((answer) => {
                                answer.task.resolveCallback(answer.result);
                                this.updateWorkersQueue(answer);
                            }).catch((answer) => {
                                answer.task.rejectCallback(answer.error);
                                this.updateWorkersQueue(answer);
                            });
                        }
                    }
                    else {
                        break;
                    }
                }
            }
        }, this.intervalLength);
    }
    /**
     *
     */
    stopProcessing() {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
    }
    /**
     *
     * @param {*} answer
     */
    async updateWorkersQueue(answer) {
        this.busyWorkersCount--;
        this.activeTasks = this.activeTasks.filter(task => task.key !== answer.task.key);
        this.workersPool.get(answer.task.taskRunnerName).unshift(answer.worker);
        this.busyWorkers.set(answer.task.taskRunnerName, this.busyWorkers.get(answer.task.taskRunnerName)
            .filter(busyWorker => busyWorker.id !== answer.worker.id));
    }
    /**
     * Terminates all the tasks. If forced is true it will not wait for the
     * active tasks to finish.
     * @param {boolean} forced To terminate immediately
     */
    terminate(forced) {
        this.taskQueue = [];
        this.stopProcessing();
        Array.from(this.workersPool.values()).map(workerArr => {
            workerArr.map(worker => {
                worker.terminate();
            });
        });
        this.workersPool = new Map();
        if (forced) {
            Array.from(this.busyWorkers.values()).map(workerArr => {
                workerArr.map(worker => {
                    worker.terminate();
                });
            });
            this.busyWorkers = new Map();
        }
    }
    /**
     * The current status of the pool
     * @param {boolean} detailed If true the information will be detailed
     */
    static status(detailed = false) {
        console.log('-------------------');
        console.log('\nNumber of pools: ', instantiatedPools.length);
        instantiatedPools.map((pool) => {
            let idleWorkers = new Array();
            let busyWorkers = new Array();
            let idleWorkersCount = 0;
            let busyWorkersCount = 0;
            let activeTasksCount = 0;
            let waitingTasksCount = 0;
            idleWorkers = Array.from(pool.workersPool.values());
            busyWorkers = Array.from(pool.busyWorkers.values());
            idleWorkers.map((workersList) => {
                idleWorkersCount += workersList.length;
            });
            busyWorkers.map((workersList) => {
                busyWorkersCount += workersList.length;
            });
            activeTasksCount = pool.activeTasks.length;
            waitingTasksCount = pool.taskQueue.length;
            console.log(`---------- POOL ${pool.poolNo} ----------`);
            console.log('Number of idle workers: ', idleWorkersCount);
            console.log('Number of busy workers: ', busyWorkersCount);
            console.log('Number of active tasks: ', activeTasksCount);
            console.log('Number of Waiting tasks: ', waitingTasksCount);
            if (detailed) {
                console.log('\nActive tasks: \n');
                pool.activeTasks.map((task, i) => {
                    console.log(i, ' : ', JSON.stringify(task), '\n');
                });
                console.log('Waiting tasks: \n');
                pool.taskQueue.map((task, i) => {
                    console.log(i, ' : ', JSON.stringify(task), '\n');
                });
            }
        });
    }
}
exports.Pool = Pool;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUG9vbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL2xpYi9Qb29sLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLGlDQUE4QjtBQUM5Qiw2Q0FBMEM7QUFDMUMsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQzdCLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUN6QixNQUFNLEVBQUUsWUFBWSxFQUFFLEdBQUcsT0FBTyxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFDbkQsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLGlCQUFpQixDQUFDLENBQUM7QUFDakQsTUFBTSxFQUFFLGNBQWMsRUFBRSxHQUFHLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO0FBRXhELE1BQU0sT0FBTyxHQUFHLFNBQVMsQ0FBQztBQUMxQixNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUM7QUFDeEIsTUFBTSxZQUFZLEdBQUcsRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQztBQUN0QyxJQUFJLGlCQUFpQixHQUFHLEVBQUUsQ0FBQztBQUMzQixJQUFJLE9BQU8sR0FBRyxDQUFDLENBQUM7QUFtQmhCLE1BQWEsSUFBSTtJQWNiOzs7O09BSUc7SUFDSCxZQUFZLE9BQTJCO1FBQ25DLElBQUksWUFBWSxFQUFFO1lBQ2QsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsNEJBQTRCO1lBQzFELElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFDLDhDQUE4QztZQUM1RSxJQUFJLENBQUMsU0FBUyxHQUFLLElBQUksS0FBSyxFQUFFLENBQUMsQ0FBQyxxQ0FBcUM7WUFDckUsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFDLENBQUMscUNBQXFDO1lBQ3JFLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFHLDBEQUEwRDtZQUN4RixJQUFJLENBQUMscUJBQXFCLEdBQUcsSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUN6QyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsQ0FBQyxDQUFDO1lBRTFCLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1lBQ3ZCLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUM7WUFDL0IsSUFBSSxDQUFDLGNBQWMsR0FBRyxDQUFDLENBQUM7WUFDeEIsSUFBSSxDQUFDLDJCQUEyQixHQUFHLENBQUMsQ0FBQztZQUVyQyxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDLGNBQWMsQ0FBQyxhQUFhLEVBQUUsQ0FBQyxDQUFDO1lBRXJDLGlCQUFpQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztZQUM3QixJQUFJLENBQUMsTUFBTSxHQUFHLGlCQUFpQixDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7U0FDOUM7SUFDTCxDQUFDO0lBRUQ7O09BRUc7SUFDSyxjQUFjLENBQUMsVUFBa0I7UUFDckMsSUFBSSxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQSxDQUFDLENBQUEsSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFBLENBQUMsQ0FBQSxDQUFDLENBQUM7UUFDbEYsSUFBSSxRQUFRLEdBQUcsVUFBVSxDQUFDO1FBQzFCLElBQUksa0JBQWtCLEdBQUcsQ0FBQyxDQUFDO1FBRTNCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxnQkFBZ0IsRUFBRSxDQUFDLEVBQUUsRUFBQztZQUN0QyxJQUFJLFlBQVksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDO1lBQ3hELElBQUksSUFBSSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLENBQUMsQ0FBQyxDQUFDLElBQUksQ0FBQztZQUM1QyxJQUFJLFdBQVcsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxXQUFXLENBQUM7WUFDMUQsSUFBSSxhQUFhLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyx3QkFBd0IsQ0FBQztZQUMxRCxrQkFBa0IsSUFBSSxXQUFXLENBQUM7WUFDbEMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFDLElBQUksRUFBRSxXQUFXLEVBQUUsYUFBYSxFQUFFLFFBQVEsRUFBRSxZQUFZLEVBQUMsQ0FBQyxDQUFDO1NBQ25GO1FBRUQsMEJBQTBCO1FBQzFCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLEdBQUcsa0JBQWtCLENBQUMsRUFBRSxDQUFDLEVBQUUsRUFBRTtZQUMzRSxJQUFJLE9BQU8sR0FBRyxJQUFJLHVCQUFVLENBQUMsY0FBYyxDQUFDLE9BQU8sQ0FBQyxFQUFFLEVBQUMsSUFBSSxFQUFFLElBQUksRUFBQyxDQUFDLENBQUM7WUFDcEUsT0FBTyxDQUFDLElBQUksR0FBRyxLQUFLLENBQUM7WUFDckIsT0FBTyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUM7WUFFZixJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUU7Z0JBQ2hDLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxJQUFJLEtBQUssRUFBYyxDQUFDLENBQUM7YUFDMUQ7WUFFRCxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7U0FDL0M7SUFDTCxDQUFDO0lBRUQ7T0FDRztJQUNLLGVBQWU7UUFDbkIsSUFBSSx3QkFBd0IsR0FBRyxDQUFDLENBQUM7UUFFakMsSUFBSSxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRTtZQUMxQixJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxVQUFVLEVBQUUsRUFBRTtnQkFDeEMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUU7b0JBQ2xCLE1BQU0sSUFBSSxLQUFLLENBQUMsc0NBQXNDLENBQUMsQ0FBQztpQkFDM0Q7Z0JBRUQsSUFBSSxDQUFDLFVBQVUsQ0FBQyxXQUFXLEVBQUU7b0JBQ3pCLFVBQVUsQ0FBQyxXQUFXLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLGdCQUFnQixHQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUNuRyxPQUFPLENBQUMsSUFBSSxDQUFDLFlBQVksVUFBVSxDQUFDLElBQUk7K0NBQ2IsVUFBVSxDQUFDLFdBQVcsb0JBQW9CLENBQUMsQ0FBQTtpQkFDekU7Z0JBRUQsd0JBQXdCLElBQUksVUFBVSxDQUFDLFdBQVcsQ0FBQztZQUN2RCxDQUFDLENBQUMsQ0FBQztTQUNOO1FBRUQsSUFBSSx3QkFBd0IsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRTtZQUNyRCxPQUFPLENBQUMsSUFBSSxDQUFDLDBEQUEwRCx3QkFBd0I7MkVBQ2hDLElBQUksQ0FBQyxPQUFPLENBQUMsV0FBVzs7b0RBRS9DLENBQUMsQ0FBQztZQUMxQyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsR0FBRyx3QkFBd0IsQ0FBQztTQUN2RDtRQUVELElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxXQUFXLEdBQUcsQ0FBQyxFQUFFO1lBQzlCLE1BQU0sSUFBSSxLQUFLLENBQUMsbUNBQW1DLENBQUMsQ0FBQztTQUN4RDtRQUVELElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRTtZQUMzQixJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsR0FBRyxZQUFZLEdBQUcsQ0FBQyxDQUFDO1NBQy9DO1FBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsd0JBQXdCLEVBQUU7WUFDeEMsSUFBSSxDQUFDLE9BQU8sQ0FBQyx3QkFBd0IsR0FBRyxJQUFJLENBQUM7U0FDaEQ7UUFFRCxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyw4QkFBOEIsRUFBRTtZQUM5QyxJQUFJLENBQUMsT0FBTyxDQUFDLDhCQUE4QixHQUFHLElBQUksQ0FBQztTQUN0RDtJQUNMLENBQUM7SUFFRDs7O09BR0c7SUFDSyxjQUFjLENBQUMsRUFBQyxJQUFJLEVBQUUsV0FBVyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUUsWUFBWSxFQUFDO1FBQzdFLElBQUksYUFBYSxFQUFFO1lBQ2YsSUFBSSxDQUFDLFdBQVcsSUFBSSxXQUFXLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsMkJBQTJCLEVBQUU7Z0JBQ2hHLElBQUksSUFBSSxDQUFDLHFCQUFxQixDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUU7b0JBQ3ZDLFdBQVcsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLGdCQUFnQixHQUFHLElBQUksQ0FBQywyQkFBMkIsR0FBRyxDQUFDLENBQUM7b0JBRW5GLElBQUksV0FBVyxLQUFLLENBQUM7d0JBQ2pCLE1BQU0sSUFBSSxLQUFLLENBQUMsa0NBQWtDLENBQUMsQ0FBQztpQkFDM0Q7cUJBQU07b0JBQ0gsV0FBVyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLDJCQUEyQixDQUFDO2lCQUNsRjtnQkFFRCxJQUFJLENBQUMsMkJBQTJCLElBQUksV0FBVyxDQUFDO2FBQ25EO1lBRUQsd0JBQXdCO1lBQ3hCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxXQUFXLEVBQUUsQ0FBQyxFQUFFLEVBQUU7Z0JBQ2xDLElBQUksT0FBTyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsUUFBUSxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQztnQkFDdkQsUUFBUSxHQUFHLEVBQUUsQ0FBQztnQkFDZCxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBVyxFQUFFLENBQVMsRUFBRSxFQUFFO29CQUNuQyxRQUFRLElBQUksR0FBRyxDQUFDO29CQUVoQixJQUFJLENBQUMsSUFBSSxPQUFPLENBQUMsTUFBTSxHQUFHLENBQUM7d0JBQ3ZCLFFBQVEsSUFBSSxNQUFNLENBQUM7Z0JBQzNCLENBQUMsQ0FBQyxDQUFDO2dCQUVILElBQUksT0FBTyxHQUFHLElBQUksdUJBQVUsQ0FBQyxjQUFjLENBQUMsTUFBTSxFQUFFLFFBQVEsRUFBRSxZQUFZLENBQUMsRUFBRSxFQUFDLElBQUksRUFBRSxJQUFJLEVBQUMsQ0FBQyxDQUFDO2dCQUMzRixPQUFPLENBQUMsSUFBSSxHQUFHLEtBQUssQ0FBQztnQkFDckIsT0FBTyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUM7Z0JBRWYsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFO29CQUM3QixJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsSUFBSSxLQUFLLEVBQWMsQ0FBQyxDQUFDO2lCQUN2RDtnQkFFRCxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7YUFDNUM7U0FDSjthQUFNO1lBQ0gsSUFBSSxJQUFJLENBQUMsMkJBQTJCLEtBQUssSUFBSSxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRTtnQkFDcEUsTUFBTSxJQUFJLEtBQUssQ0FBQyxrQ0FBa0MsQ0FBQyxDQUFDO2FBQ3ZEO1lBRUQsSUFBSSxDQUFDLHFCQUFxQixDQUFDLElBQUksQ0FBQyxFQUFDLElBQUksRUFBRSxZQUFZLEVBQUUsUUFBUSxFQUFDLENBQUMsQ0FBQztTQUNuRTtJQUNMLENBQUM7SUFFRDs7O09BR0c7SUFDSSxhQUFhLENBQUMsVUFBc0I7UUFDdkMsSUFBSSxFQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsV0FBVyxFQUFFLGFBQWEsRUFBQyxHQUFHLFVBQVUsQ0FBQztRQUN6RCxJQUFJLFFBQVEsR0FBRyxhQUFhLEVBQUUsQ0FBQztRQUMvQixJQUFJLFlBQVksR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDO1FBRTVCLElBQUksQ0FBQyxjQUFjLENBQUMsRUFBQyxJQUFJLEVBQUUsV0FBVyxFQUFFLGFBQWEsRUFBRSxRQUFRLEVBQUUsWUFBWSxFQUFDLENBQUMsQ0FBQztJQUNwRixDQUFDO0lBRUQ7OztPQUdHO0lBQ0ksWUFBWSxDQUFDLGNBQXNCO1FBQ3RDLElBQUksWUFBWSxFQUFDO1lBQ2IsSUFBSSxJQUFJLEdBQUcsSUFBSSxDQUFDO1lBRWhCLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQztnQkFDM0UsTUFBTSxJQUFJLEtBQUssQ0FBQyx5Q0FBeUMsY0FBYyxFQUFFLENBQUMsQ0FBQTtZQUUxRSxPQUFPLEtBQUssV0FBVyxHQUFHLE1BQU07Z0JBQzVCLE9BQU8sRUFBRSxDQUFDO2dCQUNWLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7b0JBQ25DLElBQUksZUFBZSxHQUFHLENBQUMsTUFBTSxFQUFFLEVBQUU7d0JBQzdCLE9BQU8sQ0FBQyxNQUFNLENBQUMsQ0FBQztvQkFDcEIsQ0FBQyxDQUFDO29CQUVGLElBQUksY0FBYyxHQUFHLENBQUMsS0FBSyxFQUFFLEVBQUU7d0JBQzNCLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztvQkFDbEIsQ0FBQyxDQUFDO29CQUVGLElBQUksSUFBSSxHQUFHLElBQUksV0FBSSxDQUFDLGNBQWMsRUFBRSxNQUFNLEVBQUUsZUFBZSxFQUFFLGNBQWMsQ0FBQyxDQUFDO29CQUM3RSxJQUFJLENBQUMsV0FBVyxDQUFFLElBQUksQ0FBRSxDQUFDO2dCQUM3QixDQUFDLENBQUMsQ0FBQztZQUNQLENBQUMsQ0FBQTtTQUNKO0lBQ0wsQ0FBQztJQUVEOzs7T0FHRztJQUNLLEtBQUssQ0FBQyxXQUFXLENBQUMsSUFBVTtRQUNoQyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUUxQixJQUFJLENBQUMsSUFBSSxDQUFDLGtCQUFrQixFQUFFO1lBQzFCLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1NBQzlCO0lBQ0wsQ0FBQztJQUVEOzs7O09BSUc7SUFDSyxLQUFLLENBQUMsbUJBQW1CO1FBQzdCLElBQUksTUFBa0IsQ0FBQztRQUN2QixJQUFJLElBQUksQ0FBQyxrQkFBa0IsSUFBSSxJQUFJLEVBQUU7WUFDakMsT0FBTztTQUNWO1FBQ0QsSUFBSSxDQUFDLGtCQUFrQixHQUFHLFdBQVcsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUU3QyxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLENBQUMsRUFBRTtnQkFDM0IsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO2FBQ3pCO2lCQUFNO2dCQUNILEtBQUssSUFBSSxJQUFJLElBQUksSUFBSSxDQUFDLFNBQVMsRUFBRTtvQkFDN0IsSUFBSSxJQUFJLENBQUMsZ0JBQWdCLEtBQUssSUFBSSxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRTt3QkFDekQsdURBQXVEO3dCQUN2RCxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFFOzRCQUM1QyxJQUFJLGNBQWMsR0FBRyxJQUFJLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQyxpQkFBaUIsQ0FBQyxJQUFJLEtBQUssSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDOzRCQUMxSCxJQUFJLFFBQVEsR0FBRyxjQUFjLENBQUMsUUFBUSxDQUFDOzRCQUN2QyxJQUFJLFlBQVksR0FBRyxjQUFjLENBQUMsWUFBWSxDQUFDOzRCQUUvQyxJQUFJLENBQUMsY0FBYyxHQUFHLE9BQU8sQ0FBQzs0QkFDOUIsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7NEJBQ3pCLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFDO3lCQUNwQzt3QkFFRCxNQUFNLEdBQUcsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDLEtBQUssRUFBRSxDQUFDO3dCQUUzRCxJQUFJLE1BQU0sRUFBRTs0QkFDUixJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQztnQ0FDMUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxJQUFJLEtBQUssRUFBYyxDQUFDLENBQUM7NEJBRXZFLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUM7NEJBQ3ZELElBQUksR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxDQUFDOzRCQUM5QixJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQzs0QkFFNUIsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQzs0QkFFcEMsSUFBSSxDQUFDLGdCQUFnQixFQUFHLENBQUM7NEJBRXpCLE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxFQUFFLEVBQUU7Z0NBQ3JDLE1BQU0sQ0FBQyxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztnQ0FDM0MsSUFBSSxDQUFDLGtCQUFrQixDQUFDLE1BQU0sQ0FBQyxDQUFDOzRCQUNwQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxNQUFNLEVBQUUsRUFBRTtnQ0FDaEIsTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDO2dDQUN6QyxJQUFJLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUM7NEJBQ3BDLENBQUMsQ0FBQyxDQUFDO3lCQUNOO3FCQUNKO3lCQUFNO3dCQUNILE1BQU07cUJBQ1Q7aUJBQ0o7YUFDSjtRQUNMLENBQUMsRUFBRSxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7SUFDNUIsQ0FBQztJQUVEOztPQUVHO0lBQ0ssY0FBYztRQUNsQixJQUFJLElBQUksQ0FBQyxrQkFBa0IsRUFBQztZQUN4QixhQUFhLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLENBQUM7WUFDdkMsSUFBSSxDQUFDLGtCQUFrQixHQUFHLElBQUksQ0FBQztTQUNsQztJQUNMLENBQUM7SUFFRDs7O09BR0c7SUFDSyxLQUFLLENBQUMsa0JBQWtCLENBQUUsTUFBTTtRQUNwQyxJQUFJLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQztRQUN4QixJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxDQUFFLElBQUksQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLEdBQUcsS0FBSyxNQUFNLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ2xGLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN4RSxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGNBQWMsRUFBRSxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQzthQUM1QyxNQUFNLENBQUMsVUFBVSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUMsRUFBRSxLQUFLLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUNuSCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNJLFNBQVMsQ0FBQyxNQUFlO1FBQzVCLElBQUksQ0FBQyxTQUFTLEdBQUcsRUFBRSxDQUFDO1FBRXBCLElBQUksQ0FBQyxjQUFjLEVBQUUsQ0FBQztRQUV0QixLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEVBQUU7WUFDbEQsU0FBUyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsRUFBRTtnQkFDbkIsTUFBTSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3ZCLENBQUMsQ0FBQyxDQUFDO1FBQ1AsQ0FBQyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksR0FBRyxFQUE2QixDQUFDO1FBRXhELElBQUksTUFBTSxFQUFDO1lBQ1AsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxFQUFFO2dCQUNsRCxTQUFTLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFO29CQUNuQixNQUFNLENBQUMsU0FBUyxFQUFFLENBQUM7Z0JBQ3ZCLENBQUMsQ0FBQyxDQUFDO1lBQ1AsQ0FBQyxDQUFDLENBQUM7WUFFSCxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksR0FBRyxFQUE2QixDQUFDO1NBQzNEO0lBQ0wsQ0FBQztJQUVEOzs7T0FHRztJQUNILE1BQU0sQ0FBQyxNQUFNLENBQUMsV0FBb0IsS0FBSztRQUNuQyxPQUFPLENBQUMsR0FBRyxDQUFDLHFCQUFxQixDQUFDLENBQUE7UUFDbEMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQkFBcUIsRUFBRSxpQkFBaUIsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUU3RCxpQkFBaUIsQ0FBQyxHQUFHLENBQUUsQ0FBQyxJQUFVLEVBQUUsRUFBRTtZQUNsQyxJQUFJLFdBQVcsR0FBNkIsSUFBSSxLQUFLLEVBQXFCLENBQUM7WUFDM0UsSUFBSSxXQUFXLEdBQTZCLElBQUksS0FBSyxFQUFxQixDQUFDO1lBQzNFLElBQUksZ0JBQWdCLEdBQVcsQ0FBQyxDQUFDO1lBQ2pDLElBQUksZ0JBQWdCLEdBQVcsQ0FBQyxDQUFDO1lBQ2pDLElBQUksZ0JBQWdCLEdBQVcsQ0FBQyxDQUFDO1lBQ2pDLElBQUksaUJBQWlCLEdBQVcsQ0FBQyxDQUFDO1lBRWxDLFdBQVcsR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUNwRCxXQUFXLEdBQUcsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7WUFFcEQsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFdBQThCLEVBQUUsRUFBRTtnQkFDL0MsZ0JBQWdCLElBQUksV0FBVyxDQUFDLE1BQU0sQ0FBQztZQUMzQyxDQUFDLENBQUMsQ0FBQztZQUVILFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQyxXQUE4QixFQUFFLEVBQUU7Z0JBQy9DLGdCQUFnQixJQUFJLFdBQVcsQ0FBQyxNQUFNLENBQUM7WUFDM0MsQ0FBQyxDQUFDLENBQUM7WUFFSCxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQztZQUMzQyxpQkFBaUIsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQztZQUUxQyxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixJQUFJLENBQUMsTUFBTSxhQUFhLENBQUMsQ0FBQTtZQUN4RCxPQUFPLENBQUMsR0FBRyxDQUFDLDBCQUEwQixFQUFFLGdCQUFnQixDQUFDLENBQUM7WUFDMUQsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsRUFBRSxnQkFBZ0IsQ0FBQyxDQUFDO1lBQzFELE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLEVBQUUsZ0JBQWdCLENBQUMsQ0FBQztZQUMxRCxPQUFPLENBQUMsR0FBRyxDQUFDLDJCQUEyQixFQUFFLGlCQUFpQixDQUFDLENBQUM7WUFFNUQsSUFBSSxRQUFRLEVBQUU7Z0JBQ1YsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO2dCQUNsQyxJQUFJLENBQUMsV0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsRUFBRTtvQkFDN0IsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUM7Z0JBQ3JELENBQUMsQ0FBQyxDQUFDO2dCQUVILE9BQU8sQ0FBQyxHQUFHLENBQUMsbUJBQW1CLENBQUMsQ0FBQztnQkFDakMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEVBQUU7b0JBQzNCLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxFQUFDLEtBQUssRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDO2dCQUNyRCxDQUFDLENBQUMsQ0FBQzthQUNOO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDUCxDQUFDO0NBQ0o7QUEzWEQsb0JBMlhDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgVGFzayB9IGZyb20gXCIuL3Rhc2tcIjtcbmltcG9ydCB7IFRhc2tXb3JrZXIgfSBmcm9tIFwiLi9UYXNrV29ya2VyXCI7XG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xuY29uc3Qgb3MgPSByZXF1aXJlKCdvcycpO1xuY29uc3QgeyBpc01haW5UaHJlYWQgfSA9IHJlcXVpcmUoJ3dvcmtlcl90aHJlYWRzJyk7XG5jb25zdCBnZXRDYWxsZXJGaWxlID0gcmVxdWlyZSgnZ2V0LWNhbGxlci1maWxlJyk7XG5jb25zdCB7IGdlbmV0YXRlU2NyaXB0IH0gPSByZXF1aXJlKCcuL1NjcmlwdEdlbmVyYXRvcicpO1xuXG5jb25zdCBEWU5BTUlDID0gJ2R5bmFtaWMnO1xuY29uc3QgU1RBVElDID0gJ3N0YXRpYyc7XG5jb25zdCBDUFVfQ09SRVNfTk8gPSBvcy5jcHVzKCkubGVuZ3RoO1xudmFyIGluc3RhbnRpYXRlZFBvb2xzID0gW107XG5sZXQgY291bnRlciA9IDA7XG5cbmludGVyZmFjZSBUYXNrUnVubmVyIHtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgam9iPzogRnVuY3Rpb247XG4gICAgZnVuY3Rpb25OYW1lPzogc3RyaW5nO1xuICAgIGZpbGVQYXRoPzogc3RyaW5nOyBcbiAgICB0aHJlYWRDb3VudD86IG51bWJlcjtcbiAgICBsb2NrVG9UaHJlYWRzPzogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIFdvcmtlcnNQb29sT3B0aW9ucyB7XG4gICAgdGFza1J1bm5lcnM/OiBBcnJheTxUYXNrUnVubmVyPjsgLy8gQW4gYXJyYXkgb2YgYWxsIHRoZSB0YXNrUnVubmVycyBmb3IgdGhlIHBvb2xcbiAgICB0b3RhbFRocmVhZENvdW50PzogbnVtYmVyOyAvLyBUaGUgdG90YWwgbnVtYmVyIG9mIHRocmVhZHMgd2FudGVkXG4gICAgbG9ja1Rhc2tSdW5uZXJzVG9UaHJlYWRzPzogYm9vbGVhbjsgLy8gV2hldGhlciBvciBub3QgdG8gaGF2ZSBkZWRpY2F0ZWQgdGhyZWFkcyBmb3IgdGhlIHRhc2tSdW5uZXJzXG4gICAgYWxsb3dEeW5hbWljVGFza1J1bm5lckFkZGl0aW9uPzogYm9vbGVhbjsgLy8gV2hldGhlciBvciBub3QgdG8gYWxsb3cgYWRkaW5nIG1vcmUgdGFzayBydW5uZXJzXG4gICAgdGhyZWFkQ291bnQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGNsYXNzIFBvb2x7XG4gICAgd29ya2Vyc1Bvb2w6IE1hcDxzdHJpbmcsIEFycmF5PFRhc2tXb3JrZXI+PjtcbiAgICBidXN5V29ya2VyczogTWFwPHN0cmluZywgQXJyYXk8VGFza1dvcmtlcj4+O1xuICAgIHRhc2tRdWV1ZTogQXJyYXk8VGFzaz47XG4gICAgYWN0aXZlVGFza3M6IEFycmF5PFRhc2s+O1xuICAgIHByb2Nlc3NlZDogTWFwPG51bWJlciwgYm9vbGVhbj47XG4gICAgZHluYW1pY1Rhc2tSdW5uZXJMaXN0OiBBcnJheTxUYXNrUnVubmVyPlxuICAgIGJ1c3lXb3JrZXJzQ291bnQ6IG51bWJlcjtcbiAgICBvcHRpb25zOiBXb3JrZXJzUG9vbE9wdGlvbnM7XG4gICAgcHJvY2Vzc2luZ0ludGVydmFsOiBOb2RlSlMuVGltZW91dDtcbiAgICBpbnRlcnZhbExlbmd0aDogbnVtYmVyO1xuICAgIHN0YXRpY1Rhc2tSdW5uZXJUaHJlYWRDb3VudDogbnVtYmVyO1xuICAgIHBvb2xObzogbnVtYmVyO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGNvbnN0cnVjdG9yIG9mIFBvb2wgY2xhc3NcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbiBUaGUgbnVtYmVyIG9mIHRocmVhZHMgKGRlZmF1bHQgaXMgdGhlIG51bWJlciBvZiBjcHUgY29yZXMgLSAxKVxuICAgICAqIEBwYXJhbSB7V29ya2Vyc1Bvb2xPcHRpb25zfSBvcHRpb25zIFRoZSBvcHRpb25hbCBvcHRpb25zIHVzZWQgaW4gY3JlYXRpbmcgd29ya2Vyc1xuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFdvcmtlcnNQb29sT3B0aW9ucyl7XG4gICAgICAgIGlmIChpc01haW5UaHJlYWQpIHtcbiAgICAgICAgICAgIHRoaXMud29ya2Vyc1Bvb2wgPSBuZXcgTWFwKCk7IC8vIGNvbnRhaW5zIHRoZSBpZGxlIHdvcmtlcnNcbiAgICAgICAgICAgIHRoaXMuYnVzeVdvcmtlcnMgPSBuZXcgTWFwKCk7IC8vIGNvbnRhaW5zIHRoZSBidXN5IHdvcmtlcnMgKHByb2Nlc3NpbmcgY29kZSlcbiAgICAgICAgICAgIHRoaXMudGFza1F1ZXVlICAgPSBuZXcgQXJyYXkoKTsgLy8gY29udGFpbnMgdGhlIHRhc2tzIHRvIGJlIHByb2Nlc3NlZFxuICAgICAgICAgICAgdGhpcy5hY3RpdmVUYXNrcyA9IG5ldyBBcnJheSgpOyAvLyBjb250YWlucyB0aGUgdGFza3MgYmVpbmcgcHJvY2Vzc2VkXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NlZCA9IG5ldyBNYXAoKTsgICAvLyB7dGFza0tleTpib29sZWFufSB3aGV0aGVyIGEgdGFzayBoYXMgYmVlbiBwcm9jZXNzZWQgeWV0XG4gICAgICAgICAgICB0aGlzLmR5bmFtaWNUYXNrUnVubmVyTGlzdCA9IG5ldyBBcnJheSgpO1xuICAgICAgICAgICAgdGhpcy5idXN5V29ya2Vyc0NvdW50ID0gMDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc2luZ0ludGVydmFsID0gbnVsbDtcbiAgICAgICAgICAgIHRoaXMuaW50ZXJ2YWxMZW5ndGggPSAxO1xuICAgICAgICAgICAgdGhpcy5zdGF0aWNUYXNrUnVubmVyVGhyZWFkQ291bnQgPSAwO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLnZhbGlkYXRlT3B0aW9ucygpO1xuICAgICAgICAgICAgdGhpcy5pbml0V29ya2VyUG9vbChnZXRDYWxsZXJGaWxlKCkpO1xuXG4gICAgICAgICAgICBpbnN0YW50aWF0ZWRQb29scy5wdXNoKHRoaXMpO1xuICAgICAgICAgICAgdGhpcy5wb29sTm8gPSBpbnN0YW50aWF0ZWRQb29scy5sZW5ndGggLSAxO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogSW5pdGlhdGVzIHRoZSB3b3JrZXJzIHBvb2wgYnkgY3JlYXRpbmcgdGhlIHdvcmtlciB0aHJlYWRzXG4gICAgICovXG4gICAgcHJpdmF0ZSBpbml0V29ya2VyUG9vbChjYWxsZXJQYXRoOiBzdHJpbmcpe1xuICAgICAgICBsZXQgdGFza1J1bm5lcnNDb3VudCA9IHRoaXMub3B0aW9ucy50YXNrUnVubmVycz90aGlzLm9wdGlvbnMudGFza1J1bm5lcnMubGVuZ3RoOjA7XG4gICAgICAgIGxldCBmaWxlUGF0aCA9IGNhbGxlclBhdGg7XG4gICAgICAgIGxldCB0b3RhbFN0YXRpY1RocmVhZHMgPSAwO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGFza1J1bm5lcnNDb3VudDsgaSsrKXtcbiAgICAgICAgICAgIGxldCBmdW5jdGlvbk5hbWUgPSB0aGlzLm9wdGlvbnMudGFza1J1bm5lcnNbaV0uam9iLm5hbWU7XG4gICAgICAgICAgICBsZXQgbmFtZSA9IHRoaXMub3B0aW9ucy50YXNrUnVubmVyc1tpXS5uYW1lO1xuICAgICAgICAgICAgbGV0IHRocmVhZENvdW50ID0gdGhpcy5vcHRpb25zLnRhc2tSdW5uZXJzW2ldLnRocmVhZENvdW50O1xuICAgICAgICAgICAgbGV0IGxvY2tUb1RocmVhZHMgPSB0aGlzLm9wdGlvbnMubG9ja1Rhc2tSdW5uZXJzVG9UaHJlYWRzO1xuICAgICAgICAgICAgdG90YWxTdGF0aWNUaHJlYWRzICs9IHRocmVhZENvdW50O1xuICAgICAgICAgICAgdGhpcy5fYWRkVGFza1J1bm5lcih7bmFtZSwgdGhyZWFkQ291bnQsIGxvY2tUb1RocmVhZHMsIGZpbGVQYXRoLCBmdW5jdGlvbk5hbWV9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE1ha2UgYWxsIG90aGVycyBkeW5hbWljXG4gICAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgKHRoaXMub3B0aW9ucy50b3RhbFRocmVhZENvdW50IC0gdG90YWxTdGF0aWNUaHJlYWRzKTsgaysrKSB7XG4gICAgICAgICAgICBsZXQgX3dvcmtlciA9IG5ldyBUYXNrV29ya2VyKGdlbmV0YXRlU2NyaXB0KERZTkFNSUMpLCB7ZXZhbDogdHJ1ZX0pO1xuICAgICAgICAgICAgX3dvcmtlci5idXN5ID0gZmFsc2U7XG4gICAgICAgICAgICBfd29ya2VyLmlkID0gaTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCF0aGlzLndvcmtlcnNQb29sLmhhcyhEWU5BTUlDKSkge1xuICAgICAgICAgICAgICAgIHRoaXMud29ya2Vyc1Bvb2wuc2V0KERZTkFNSUMsIG5ldyBBcnJheTxUYXNrV29ya2VyPigpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy53b3JrZXJzUG9vbC5nZXQoRFlOQU1JQykucHVzaChfd29ya2VyKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqL1xuICAgIHByaXZhdGUgdmFsaWRhdGVPcHRpb25zKCkge1xuICAgICAgICBsZXQgdGhyZWFkQ291bnRPZlRhc2tSdW5uZXJzID0gMDtcblxuICAgICAgICBpZiAodGhpcy5vcHRpb25zLnRhc2tSdW5uZXJzKSB7XG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMudGFza1J1bm5lcnMubWFwKCh0YXNrUnVubmVyKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCF0YXNrUnVubmVyLm5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXZlcnkgdGFzayBydW5uZXIgc2hvdWxkIGhhdmUgYSBuYW1lXCIpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghdGFza1J1bm5lci50aHJlYWRDb3VudCkge1xuICAgICAgICAgICAgICAgICAgICB0YXNrUnVubmVyLnRocmVhZENvdW50ID0gTWF0aC5mbG9vcih0aGlzLm9wdGlvbnMudG90YWxUaHJlYWRDb3VudC90aGlzLm9wdGlvbnMudGFza1J1bm5lcnMubGVuZ3RoKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBUaGUgdGFzayAke3Rhc2tSdW5uZXIubmFtZX0gaGFzIG5vIHRocmVhZCBjb3VudCBzcGVjaWZpZWQ7IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZXJlZm9yZSwgJHt0YXNrUnVubmVyLnRocmVhZENvdW50fSBpcyBhc3NpZ25lZCB0byBpdGApXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdGhyZWFkQ291bnRPZlRhc2tSdW5uZXJzICs9IHRhc2tSdW5uZXIudGhyZWFkQ291bnQ7XG4gICAgICAgICAgICB9KTsgIFxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRocmVhZENvdW50T2ZUYXNrUnVubmVycyA+IHRoaXMub3B0aW9ucy50aHJlYWRDb3VudCkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGBUaGUgdG90YWwgbnVtYmVyIG9mIHRocmVhZHMgcmVxdWVzdGVkIGJ5IHRhc2sgcnVubmVycyAoJHt0aHJlYWRDb3VudE9mVGFza1J1bm5lcnN9KVxuICAgICAgICAgICAgICAgICAgICAgICAgICBleGNlZWRzIHRoZSB0b3RhbCBudW1iZXIgb2YgdGhyZWFkcyBzcGVjaWZpZWQgKCR7dGhpcy5vcHRpb25zLnRocmVhZENvdW50fSkuIFRoZSB0b3RhbCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbnVtYmVyIG9mIHRocmVhZHMgaXMgdXBkYXRlZCB0byBtYXRjaCB0aGUgbnVtYmVyIG9mIHRocmVhZHMgXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVlc3RlZCBieSB0YXNrIHJ1bm5lcnNgKTtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy50aHJlYWRDb3VudCA9IHRocmVhZENvdW50T2ZUYXNrUnVubmVycztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLm9wdGlvbnMudGhyZWFkQ291bnQgPCAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3RocmVhZENvdW50IGNhbm5vdCBiZSBsZXNzIHRoYW4gMScpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLm9wdGlvbnMudGhyZWFkQ291bnQpIHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy50aHJlYWRDb3VudCA9IENQVV9DT1JFU19OTyAtIDE7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMub3B0aW9ucy5sb2NrVGFza1J1bm5lcnNUb1RocmVhZHMpIHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy5sb2NrVGFza1J1bm5lcnNUb1RocmVhZHMgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLm9wdGlvbnMuYWxsb3dEeW5hbWljVGFza1J1bm5lckFkZGl0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMuYWxsb3dEeW5hbWljVGFza1J1bm5lckFkZGl0aW9uID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFxuICAgICAqIEBwYXJhbSBwYXJhbTAgXG4gICAgICovXG4gICAgcHJpdmF0ZSBfYWRkVGFza1J1bm5lcih7bmFtZSwgdGhyZWFkQ291bnQsIGxvY2tUb1RocmVhZHMsIGZpbGVQYXRoLCBmdW5jdGlvbk5hbWV9KSB7XG4gICAgICAgIGlmIChsb2NrVG9UaHJlYWRzKSB7XG4gICAgICAgICAgICBpZiAoIXRocmVhZENvdW50IHx8IHRocmVhZENvdW50ID4gdGhpcy5vcHRpb25zLnRvdGFsVGhyZWFkQ291bnQgLSB0aGlzLnN0YXRpY1Rhc2tSdW5uZXJUaHJlYWRDb3VudCkge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLmR5bmFtaWNUYXNrUnVubmVyTGlzdC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocmVhZENvdW50ID0gdGhpcy5vcHRpb25zLnRvdGFsVGhyZWFkQ291bnQgLSB0aGlzLnN0YXRpY1Rhc2tSdW5uZXJUaHJlYWRDb3VudCAtIDE7XG4gICAgXG4gICAgICAgICAgICAgICAgICAgIGlmICh0aHJlYWRDb3VudCA9PT0gMClcbiAgICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVGhlcmUgYXJlIG5vIGVub3VnaCBmcmVlIHRocmVhZHMnKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICB0aHJlYWRDb3VudCA9IHRoaXMub3B0aW9ucy50b3RhbFRocmVhZENvdW50IC0gdGhpcy5zdGF0aWNUYXNrUnVubmVyVGhyZWFkQ291bnQ7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdGhpcy5zdGF0aWNUYXNrUnVubmVyVGhyZWFkQ291bnQgKz0gdGhyZWFkQ291bnQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIENyZWF0ZSB0aGUgbmV3IHdvcmtlclxuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aHJlYWRDb3VudDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgbGV0IHBhdGhBcnIgPSBwYXRoLm5vcm1hbGl6ZShmaWxlUGF0aCkuc3BsaXQocGF0aC5zZXApO1xuICAgICAgICAgICAgICAgIGZpbGVQYXRoID0gJyc7XG4gICAgICAgICAgICAgICAgcGF0aEFyci5tYXAoKHNlZzogc3RyaW5nLCBpOiBudW1iZXIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGggKz0gc2VnO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChpICE9IHBhdGhBcnIubGVuZ3RoIC0gMSlcbiAgICAgICAgICAgICAgICAgICAgICAgIGZpbGVQYXRoICs9ICdcXFxcXFxcXCc7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgXG4gICAgICAgICAgICAgICAgbGV0IF93b3JrZXIgPSBuZXcgVGFza1dvcmtlcihnZW5ldGF0ZVNjcmlwdChTVEFUSUMsIGZpbGVQYXRoLCBmdW5jdGlvbk5hbWUpLCB7ZXZhbDogdHJ1ZX0pO1xuICAgICAgICAgICAgICAgIF93b3JrZXIuYnVzeSA9IGZhbHNlO1xuICAgICAgICAgICAgICAgIF93b3JrZXIuaWQgPSBpO1xuXG4gICAgICAgICAgICAgICAgaWYgKCF0aGlzLndvcmtlcnNQb29sLmhhcyhuYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLndvcmtlcnNQb29sLnNldChuYW1lLCBuZXcgQXJyYXk8VGFza1dvcmtlcj4oKSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdGhpcy53b3JrZXJzUG9vbC5nZXQobmFtZSkucHVzaChfd29ya2VyKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGlmICh0aGlzLnN0YXRpY1Rhc2tSdW5uZXJUaHJlYWRDb3VudCA9PT0gdGhpcy5vcHRpb25zLnRvdGFsVGhyZWFkQ291bnQpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1RoZXJlIGFyZSBubyBlbm91Z2ggZnJlZSB0aHJlYWRzJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuZHluYW1pY1Rhc2tSdW5uZXJMaXN0LnB1c2goe25hbWUsIGZ1bmN0aW9uTmFtZSwgZmlsZVBhdGh9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFxuICAgICAqIEBwYXJhbSB0YXNrUnVubmVyIFxuICAgICAqL1xuICAgIHB1YmxpYyBhZGRUYXNrUnVubmVyKHRhc2tSdW5uZXI6IFRhc2tSdW5uZXIpIHtcbiAgICAgICAgbGV0IHtuYW1lLCBqb2IsIHRocmVhZENvdW50LCBsb2NrVG9UaHJlYWRzfSA9IHRhc2tSdW5uZXI7XG4gICAgICAgIGxldCBmaWxlUGF0aCA9IGdldENhbGxlckZpbGUoKTtcbiAgICAgICAgbGV0IGZ1bmN0aW9uTmFtZSA9IGpvYi5uYW1lO1xuXG4gICAgICAgIHRoaXMuX2FkZFRhc2tSdW5uZXIoe25hbWUsIHRocmVhZENvdW50LCBsb2NrVG9UaHJlYWRzLCBmaWxlUGF0aCwgZnVuY3Rpb25OYW1lfSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGVzIGFuIGFzeW5jaHJvbm91cyBwcm9taXNlIGJhc2VkIGZ1bmN0aW9uIG91dCBvZiBhIHN5bmNocm9ub3VzIG9uZVxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB0YXNrUnVubmVyTmFtZVxuICAgICAqL1xuICAgIHB1YmxpYyBnZXRBc3luY0Z1bmModGFza1J1bm5lck5hbWU6IHN0cmluZyl7XG4gICAgICAgIGlmIChpc01haW5UaHJlYWQpe1xuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIXRoaXMud29ya2Vyc1Bvb2wuZ2V0KHRhc2tSdW5uZXJOYW1lKSAmJiAhdGhpcy53b3JrZXJzUG9vbC5nZXQoRFlOQU1JQykpXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZXJlIGlzIG5vIHRhc2sgcnVubmVyIHdpdGggdGhlIG5hbWUgJHt0YXNrUnVubmVyTmFtZX1gKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gYXN5bmMgZnVuY3Rpb24gKC4uLnBhcmFtcykge1xuICAgICAgICAgICAgICAgIGNvdW50ZXIrKztcbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgcmVzb2x2ZUNhbGxiYWNrID0gKHJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgICAgIGxldCByZWplY3RDYWxsYmFjayA9IChlcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgICAgICBsZXQgdGFzayA9IG5ldyBUYXNrKHRhc2tSdW5uZXJOYW1lLCBwYXJhbXMsIHJlc29sdmVDYWxsYmFjaywgcmVqZWN0Q2FsbGJhY2spO1xuICAgICAgICAgICAgICAgICAgICBzZWxmLmVucXVldWVUYXNrKCB0YXNrICk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFbnF1ZXVlcyBhIHRhc2sgdG8gYmUgcHJvY2Vzc2VkIHdoZW4gYW4gaWRsZSB3b3JrZXIgdGhyZWFkIGlzIGF2YWlsYWJsZVxuICAgICAqIEBwYXJhbSB7VGFza30gdGFzayBUaGUgdGFzayB0byBiZSBydW4gXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyBlbnF1ZXVlVGFzayh0YXNrOiBUYXNrKXtcbiAgICAgICAgdGhpcy50YXNrUXVldWUucHVzaCh0YXNrKTtcblxuICAgICAgICBpZiAoIXRoaXMucHJvY2Vzc2luZ0ludGVydmFsKSB7XG4gICAgICAgICAgICB0aGlzLnN0YXJ0VGFza1Byb2Nlc3NpbmcoKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIENoZWNrcyBpZiB0aGVyZSBhcmUgYW55IHBlbmRpbmcgdGFza3MgYW5kIGlmIHRoZXJlIGFyZSBhbnkgaWRsZVxuICAgICAqIHdvcmtlcnMgdG8gcHJvY2VzcyB0aGVtLCBwcmVwYXJlcyB0aGVtIGZvciBwcm9jZXNzaW5nLCBhbmQgcHJvY2Vzc2VzXG4gICAgICogdGhlbS5cbiAgICAgKi9cbiAgICBwcml2YXRlIGFzeW5jIHN0YXJ0VGFza1Byb2Nlc3NpbmcoKXtcbiAgICAgICAgdmFyIHdvcmtlcjogVGFza1dvcmtlcjtcbiAgICAgICAgaWYgKHRoaXMucHJvY2Vzc2luZ0ludGVydmFsICE9IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnByb2Nlc3NpbmdJbnRlcnZhbCA9IHNldEludGVydmFsKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMudGFza1F1ZXVlLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnN0b3BQcm9jZXNzaW5nKCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGZvciAobGV0IHRhc2sgb2YgdGhpcy50YXNrUXVldWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuYnVzeVdvcmtlcnNDb3VudCAhPT0gdGhpcy5vcHRpb25zLnRvdGFsVGhyZWFkQ291bnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlbW92ZSBhIGZyZWUgd29ya2VyIGZyb20gdGhlIGJlZ2luaW5ncyBvZiB0aGUgYXJyYXlcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy53b3JrZXJzUG9vbC5nZXQodGFzay50YXNrUnVubmVyTmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgdGFza1J1bm5lckluZm8gPSB0aGlzLmR5bmFtaWNUYXNrUnVubmVyTGlzdC5maW5kKGR5bmFtaWNUYXNrUnVubmVyID0+IGR5bmFtaWNUYXNrUnVubmVyLm5hbWUgPT09IHRhc2sudGFza1J1bm5lck5hbWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxldCBmaWxlUGF0aCA9IHRhc2tSdW5uZXJJbmZvLmZpbGVQYXRoO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxldCBmdW5jdGlvbk5hbWUgPSB0YXNrUnVubmVySW5mby5mdW5jdGlvbk5hbWU7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXNrLnRhc2tSdW5uZXJOYW1lID0gRFlOQU1JQztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXNrLmZpbGVQYXRoID0gZmlsZVBhdGg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFzay5mdW5jdGlvbk5hbWUgPSBmdW5jdGlvbk5hbWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHdvcmtlciA9IHRoaXMud29ya2Vyc1Bvb2wuZ2V0KHRhc2sudGFza1J1bm5lck5hbWUpLnNoaWZ0KCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh3b3JrZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuYnVzeVdvcmtlcnMuaGFzKHRhc2sudGFza1J1bm5lck5hbWUpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJ1c3lXb3JrZXJzLnNldCh0YXNrLnRhc2tSdW5uZXJOYW1lLCBuZXcgQXJyYXk8VGFza1dvcmtlcj4oKSk7XG4gICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5idXN5V29ya2Vycy5nZXQodGFzay50YXNrUnVubmVyTmFtZSkucHVzaCh3b3JrZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhc2sgPSB0aGlzLnRhc2tRdWV1ZS5zaGlmdCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYWN0aXZlVGFza3MucHVzaCh0YXNrKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZC5zZXQodGFzay5rZXksIGZhbHNlKTtcbiAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5idXN5V29ya2Vyc0NvdW50ICsrO1xuICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdvcmtlci5wcm9jZXNzVGFzayh0YXNrKS50aGVuKChhbnN3ZXIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYW5zd2VyLnRhc2sucmVzb2x2ZUNhbGxiYWNrKGFuc3dlci5yZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZVdvcmtlcnNRdWV1ZShhbnN3ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pLmNhdGNoKChhbnN3ZXIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYW5zd2VyLnRhc2sucmVqZWN0Q2FsbGJhY2soYW5zd2VyLmVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy51cGRhdGVXb3JrZXJzUXVldWUoYW5zd2VyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LCB0aGlzLmludGVydmFsTGVuZ3RoKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBcbiAgICAgKi9cbiAgICBwcml2YXRlIHN0b3BQcm9jZXNzaW5nICgpIHtcbiAgICAgICAgaWYgKHRoaXMucHJvY2Vzc2luZ0ludGVydmFsKXtcbiAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5wcm9jZXNzaW5nSW50ZXJ2YWwpO1xuICAgICAgICAgICAgdGhpcy5wcm9jZXNzaW5nSW50ZXJ2YWwgPSBudWxsO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogXG4gICAgICogQHBhcmFtIHsqfSBhbnN3ZXIgXG4gICAgICovXG4gICAgcHJpdmF0ZSBhc3luYyB1cGRhdGVXb3JrZXJzUXVldWUgKGFuc3dlcikge1xuICAgICAgICB0aGlzLmJ1c3lXb3JrZXJzQ291bnQtLTtcbiAgICAgICAgdGhpcy5hY3RpdmVUYXNrcyA9IHRoaXMuYWN0aXZlVGFza3MuZmlsdGVyKCB0YXNrID0+IHRhc2sua2V5ICE9PSBhbnN3ZXIudGFzay5rZXkpO1xuICAgICAgICB0aGlzLndvcmtlcnNQb29sLmdldChhbnN3ZXIudGFzay50YXNrUnVubmVyTmFtZSkudW5zaGlmdChhbnN3ZXIud29ya2VyKTtcbiAgICAgICAgdGhpcy5idXN5V29ya2Vycy5zZXQoYW5zd2VyLnRhc2sudGFza1J1bm5lck5hbWUsIHRoaXMuYnVzeVdvcmtlcnMuZ2V0KGFuc3dlci50YXNrLnRhc2tSdW5uZXJOYW1lKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLmZpbHRlcihidXN5V29ya2VyID0+IGJ1c3lXb3JrZXIuaWQgIT09IGFuc3dlci53b3JrZXIuaWQpKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUZXJtaW5hdGVzIGFsbCB0aGUgdGFza3MuIElmIGZvcmNlZCBpcyB0cnVlIGl0IHdpbGwgbm90IHdhaXQgZm9yIHRoZVxuICAgICAqIGFjdGl2ZSB0YXNrcyB0byBmaW5pc2guXG4gICAgICogQHBhcmFtIHtib29sZWFufSBmb3JjZWQgVG8gdGVybWluYXRlIGltbWVkaWF0ZWx5XG4gICAgICovXG4gICAgcHVibGljIHRlcm1pbmF0ZShmb3JjZWQ6IGJvb2xlYW4pe1xuICAgICAgICB0aGlzLnRhc2tRdWV1ZSA9IFtdO1xuXG4gICAgICAgIHRoaXMuc3RvcFByb2Nlc3NpbmcoKTtcblxuICAgICAgICBBcnJheS5mcm9tKHRoaXMud29ya2Vyc1Bvb2wudmFsdWVzKCkpLm1hcCh3b3JrZXJBcnIgPT4ge1xuICAgICAgICAgICAgd29ya2VyQXJyLm1hcCh3b3JrZXIgPT4ge1xuICAgICAgICAgICAgICAgIHdvcmtlci50ZXJtaW5hdGUoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICB0aGlzLndvcmtlcnNQb29sID0gbmV3IE1hcDxzdHJpbmcsIEFycmF5PFRhc2tXb3JrZXI+PigpO1xuXG4gICAgICAgIGlmIChmb3JjZWQpe1xuICAgICAgICAgICAgQXJyYXkuZnJvbSh0aGlzLmJ1c3lXb3JrZXJzLnZhbHVlcygpKS5tYXAod29ya2VyQXJyID0+IHtcbiAgICAgICAgICAgICAgICB3b3JrZXJBcnIubWFwKHdvcmtlciA9PiB7XG4gICAgICAgICAgICAgICAgICAgIHdvcmtlci50ZXJtaW5hdGUoKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB0aGlzLmJ1c3lXb3JrZXJzID0gbmV3IE1hcDxzdHJpbmcsIEFycmF5PFRhc2tXb3JrZXI+PigpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogVGhlIGN1cnJlbnQgc3RhdHVzIG9mIHRoZSBwb29sXG4gICAgICogQHBhcmFtIHtib29sZWFufSBkZXRhaWxlZCBJZiB0cnVlIHRoZSBpbmZvcm1hdGlvbiB3aWxsIGJlIGRldGFpbGVkXG4gICAgICovXG4gICAgc3RhdGljIHN0YXR1cyhkZXRhaWxlZDogYm9vbGVhbiA9IGZhbHNlKXtcbiAgICAgICAgY29uc29sZS5sb2coJy0tLS0tLS0tLS0tLS0tLS0tLS0nKVxuICAgICAgICBjb25zb2xlLmxvZygnXFxuTnVtYmVyIG9mIHBvb2xzOiAnLCBpbnN0YW50aWF0ZWRQb29scy5sZW5ndGgpO1xuXG4gICAgICAgIGluc3RhbnRpYXRlZFBvb2xzLm1hcCggKHBvb2w6IFBvb2wpID0+IHtcbiAgICAgICAgICAgIGxldCBpZGxlV29ya2VyczogQXJyYXk8QXJyYXk8VGFza1dvcmtlcj4+ID0gbmV3IEFycmF5PEFycmF5PFRhc2tXb3JrZXI+PigpO1xuICAgICAgICAgICAgbGV0IGJ1c3lXb3JrZXJzOiBBcnJheTxBcnJheTxUYXNrV29ya2VyPj4gPSBuZXcgQXJyYXk8QXJyYXk8VGFza1dvcmtlcj4+KCk7XG4gICAgICAgICAgICBsZXQgaWRsZVdvcmtlcnNDb3VudDogbnVtYmVyID0gMDtcbiAgICAgICAgICAgIGxldCBidXN5V29ya2Vyc0NvdW50OiBudW1iZXIgPSAwO1xuICAgICAgICAgICAgbGV0IGFjdGl2ZVRhc2tzQ291bnQ6IG51bWJlciA9IDA7IFxuICAgICAgICAgICAgbGV0IHdhaXRpbmdUYXNrc0NvdW50OiBudW1iZXIgPSAwO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZGxlV29ya2VycyA9IEFycmF5LmZyb20ocG9vbC53b3JrZXJzUG9vbC52YWx1ZXMoKSk7XG4gICAgICAgICAgICBidXN5V29ya2VycyA9IEFycmF5LmZyb20ocG9vbC5idXN5V29ya2Vycy52YWx1ZXMoKSk7XG5cbiAgICAgICAgICAgIGlkbGVXb3JrZXJzLm1hcCgod29ya2Vyc0xpc3Q6IEFycmF5PFRhc2tXb3JrZXI+KSA9PiB7XG4gICAgICAgICAgICAgICAgaWRsZVdvcmtlcnNDb3VudCArPSB3b3JrZXJzTGlzdC5sZW5ndGg7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgYnVzeVdvcmtlcnMubWFwKCh3b3JrZXJzTGlzdDogQXJyYXk8VGFza1dvcmtlcj4pID0+IHtcbiAgICAgICAgICAgICAgICBidXN5V29ya2Vyc0NvdW50ICs9IHdvcmtlcnNMaXN0Lmxlbmd0aDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBhY3RpdmVUYXNrc0NvdW50ID0gcG9vbC5hY3RpdmVUYXNrcy5sZW5ndGg7XG4gICAgICAgICAgICB3YWl0aW5nVGFza3NDb3VudCA9IHBvb2wudGFza1F1ZXVlLmxlbmd0aDtcblxuICAgICAgICAgICAgY29uc29sZS5sb2coYC0tLS0tLS0tLS0gUE9PTCAke3Bvb2wucG9vbE5vfSAtLS0tLS0tLS0tYClcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdOdW1iZXIgb2YgaWRsZSB3b3JrZXJzOiAnLCBpZGxlV29ya2Vyc0NvdW50KTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdOdW1iZXIgb2YgYnVzeSB3b3JrZXJzOiAnLCBidXN5V29ya2Vyc0NvdW50KTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdOdW1iZXIgb2YgYWN0aXZlIHRhc2tzOiAnLCBhY3RpdmVUYXNrc0NvdW50KTtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKCdOdW1iZXIgb2YgV2FpdGluZyB0YXNrczogJywgd2FpdGluZ1Rhc2tzQ291bnQpOyBcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKGRldGFpbGVkKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1xcbkFjdGl2ZSB0YXNrczogXFxuJyk7XG4gICAgICAgICAgICAgICAgcG9vbC5hY3RpdmVUYXNrcy5tYXAoKHRhc2ssIGkpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5sb2coaSwnIDogJywgSlNPTi5zdHJpbmdpZnkodGFzayksICdcXG4nKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2coJ1dhaXRpbmcgdGFza3M6IFxcbicpO1xuICAgICAgICAgICAgICAgIHBvb2wudGFza1F1ZXVlLm1hcCgodGFzaywgaSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhpLCcgOiAnLCBKU09OLnN0cmluZ2lmeSh0YXNrKSwgJ1xcbicpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG59Il19
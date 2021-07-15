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
            this._validateOptions();
            this._initWorkerPool(getCallerFile());
            instantiatedPools.push(this);
            this.poolNo = instantiatedPools.length - 1;
        }
    }
    /**
     * @private
     * Initiates the workers pool by creating the worker threads
     */
    _initWorkerPool(callerPath) {
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
            this._startTaskProcessing();
        }
    }
    /**
     * @private
     * Checks if there are any pending tasks and if there are any idle
     * workers to process them, prepares them for processing, and processes
     * them.
     */
    async _startTaskProcessing() {
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
        Object.values(this.workersPool).map(worker => {
            worker.terminate();
        });
        this.workersPool = new Map();
        if (forced) {
            Object.values(this.busyWorkers).map(worker => {
                worker.terminate();
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUG9vbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL2xpYi9Qb29sLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLGlDQUE4QjtBQUM5Qiw2Q0FBMEM7QUFDMUMsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0FBQzdCLE1BQU0sRUFBRSxHQUFHLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUN6QixNQUFNLEVBQUUsWUFBWSxFQUFFLEdBQUcsT0FBTyxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFDbkQsTUFBTSxhQUFhLEdBQUcsT0FBTyxDQUFDLGlCQUFpQixDQUFDLENBQUM7QUFDakQsTUFBTSxFQUFFLGNBQWMsRUFBRSxHQUFHLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO0FBRXhELE1BQU0sT0FBTyxHQUFHLFNBQVMsQ0FBQztBQUMxQixNQUFNLE1BQU0sR0FBRyxRQUFRLENBQUM7QUFDeEIsTUFBTSxZQUFZLEdBQUcsRUFBRSxDQUFDLElBQUksRUFBRSxDQUFDLE1BQU0sQ0FBQztBQUN0QyxJQUFJLGlCQUFpQixHQUFHLEVBQUUsQ0FBQztBQUMzQixJQUFJLE9BQU8sR0FBRyxDQUFDLENBQUM7QUFtQmhCLE1BQWEsSUFBSTtJQWNiOzs7O09BSUc7SUFDSCxZQUFZLE9BQTJCO1FBQ25DLElBQUksWUFBWSxFQUFFO1lBQ2QsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsNEJBQTRCO1lBQzFELElBQUksQ0FBQyxXQUFXLEdBQUcsSUFBSSxHQUFHLEVBQUUsQ0FBQyxDQUFDLDhDQUE4QztZQUM1RSxJQUFJLENBQUMsU0FBUyxHQUFLLElBQUksS0FBSyxFQUFFLENBQUMsQ0FBQyxxQ0FBcUM7WUFDckUsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFDLENBQUMscUNBQXFDO1lBQ3JFLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxHQUFHLEVB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QkFDckQsQ0FBQyxDQUFDLENBQUM7Z0JBRUgsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUIsQ0FBQyxDQUFDO2dCQUNqQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLEVBQUUsRUFBRTtvQkFDM0IsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLEVBQUMsS0FBSyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUM7Z0JBQ3JELENBQUMsQ0FBQyxDQUFDO2FBQ047UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQWhYRCxvQkFnWEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBUYXNrIH0gZnJvbSBcIi4vdGFza1wiO1xuaW1wb3J0IHsgVGFza1dvcmtlciB9IGZyb20gXCIuL1Rhc2tXb3JrZXJcIjtcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBvcyA9IHJlcXVpcmUoJ29zJyk7XG5jb25zdCB7IGlzTWFpblRocmVhZCB9ID0gcmVxdWlyZSgnd29ya2VyX3RocmVhZHMnKTtcbmNvbnN0IGdldENhbGxlckZpbGUgPSByZXF1aXJlKCdnZXQtY2FsbGVyLWZpbGUnKTtcbmNvbnN0IHsgZ2VuZXRhdGVTY3JpcHQgfSA9IHJlcXVpcmUoJy4vU2NyaXB0R2VuZXJhdG9yJyk7XG5cbmNvbnN0IERZTkFNSUMgPSAnZHluYW1pYyc7XG5jb25zdCBTVEFUSUMgPSAnc3RhdGljJztcbmNvbnN0IENQVV9DT1JFU19OTyA9IG9zLmNwdXMoKS5sZW5ndGg7XG52YXIgaW5zdGFudGlhdGVkUG9vbHMgPSBbXTtcbmxldCBjb3VudGVyID0gMDtcblxuaW50ZXJmYWNlIFRhc2tSdW5uZXIge1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBqb2I/OiBGdW5jdGlvbjtcbiAgICBmdW5jdGlvbk5hbWU/OiBzdHJpbmc7XG4gICAgZmlsZVBhdGg/OiBzdHJpbmc7IFxuICAgIHRocmVhZENvdW50PzogbnVtYmVyO1xuICAgIGxvY2tUb1RocmVhZHM/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgV29ya2Vyc1Bvb2xPcHRpb25zIHtcbiAgICB0YXNrUnVubmVycz86IEFycmF5PFRhc2tSdW5uZXI+OyAvLyBBbiBhcnJheSBvZiBhbGwgdGhlIHRhc2tSdW5uZXJzIGZvciB0aGUgcG9vbFxuICAgIHRvdGFsVGhyZWFkQ291bnQ/OiBudW1iZXI7IC8vIFRoZSB0b3RhbCBudW1iZXIgb2YgdGhyZWFkcyB3YW50ZWRcbiAgICBsb2NrVGFza1J1bm5lcnNUb1RocmVhZHM/OiBib29sZWFuOyAvLyBXaGV0aGVyIG9yIG5vdCB0byBoYXZlIGRlZGljYXRlZCB0aHJlYWRzIGZvciB0aGUgdGFza1J1bm5lcnNcbiAgICBhbGxvd0R5bmFtaWNUYXNrUnVubmVyQWRkaXRpb24/OiBib29sZWFuOyAvLyBXaGV0aGVyIG9yIG5vdCB0byBhbGxvdyBhZGRpbmcgbW9yZSB0YXNrIHJ1bm5lcnNcbiAgICB0aHJlYWRDb3VudDogbnVtYmVyO1xufVxuXG5leHBvcnQgY2xhc3MgUG9vbHtcbiAgICB3b3JrZXJzUG9vbDogTWFwPHN0cmluZywgQXJyYXk8VGFza1dvcmtlcj4+O1xuICAgIGJ1c3lXb3JrZXJzOiBNYXA8c3RyaW5nLCBBcnJheTxUYXNrV29ya2VyPj47XG4gICAgdGFza1F1ZXVlOiBBcnJheTxUYXNrPjtcbiAgICBhY3RpdmVUYXNrczogQXJyYXk8VGFzaz47XG4gICAgcHJvY2Vzc2VkOiBNYXA8bnVtYmVyLCBib29sZWFuPjtcbiAgICBkeW5hbWljVGFza1J1bm5lckxpc3Q6IEFycmF5PFRhc2tSdW5uZXI+XG4gICAgYnVzeVdvcmtlcnNDb3VudDogbnVtYmVyO1xuICAgIG9wdGlvbnM6IFdvcmtlcnNQb29sT3B0aW9ucztcbiAgICBwcm9jZXNzaW5nSW50ZXJ2YWw6IE5vZGVKUy5UaW1lb3V0O1xuICAgIGludGVydmFsTGVuZ3RoOiBudW1iZXI7XG4gICAgc3RhdGljVGFza1J1bm5lclRocmVhZENvdW50OiBudW1iZXI7XG4gICAgcG9vbE5vOiBudW1iZXI7XG5cbiAgICAvKipcbiAgICAgKiBUaGUgY29uc3RydWN0b3Igb2YgUG9vbCBjbGFzc1xuICAgICAqIEBwYXJhbSB7bnVtYmVyfSBuIFRoZSBudW1iZXIgb2YgdGhyZWFkcyAoZGVmYXVsdCBpcyB0aGUgbnVtYmVyIG9mIGNwdSBjb3JlcyAtIDEpXG4gICAgICogQHBhcmFtIHtXb3JrZXJzUG9vbE9wdGlvbnN9IG9wdGlvbnMgVGhlIG9wdGlvbmFsIG9wdGlvbnMgdXNlZCBpbiBjcmVhdGluZyB3b3JrZXJzXG4gICAgICovXG4gICAgY29uc3RydWN0b3Iob3B0aW9uczogV29ya2Vyc1Bvb2xPcHRpb25zKXtcbiAgICAgICAgaWYgKGlzTWFpblRocmVhZCkge1xuICAgICAgICAgICAgdGhpcy53b3JrZXJzUG9vbCA9IG5ldyBNYXAoKTsgLy8gY29udGFpbnMgdGhlIGlkbGUgd29ya2Vyc1xuICAgICAgICAgICAgdGhpcy5idXN5V29ya2VycyA9IG5ldyBNYXAoKTsgLy8gY29udGFpbnMgdGhlIGJ1c3kgd29ya2VycyAocHJvY2Vzc2luZyBjb2RlKVxuICAgICAgICAgICAgdGhpcy50YXNrUXVldWUgICA9IG5ldyBBcnJheSgpOyAvLyBjb250YWlucyB0aGUgdGFza3MgdG8gYmUgcHJvY2Vzc2VkXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZVRhc2tzID0gbmV3IEFycmF5KCk7IC8vIGNvbnRhaW5zIHRoZSB0YXNrcyBiZWluZyBwcm9jZXNzZWRcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc2VkID0gbmV3IE1hcCgpOyAgIC8vIHt0YXNrS2V5OmJvb2xlYW59IHdoZXRoZXIgYSB0YXNrIGhhcyBiZWVuIHByb2Nlc3NlZCB5ZXRcbiAgICAgICAgICAgIHRoaXMuZHluYW1pY1Rhc2tSdW5uZXJMaXN0ID0gbmV3IEFycmF5KCk7XG4gICAgICAgICAgICB0aGlzLmJ1c3lXb3JrZXJzQ291bnQgPSAwO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuICAgICAgICAgICAgdGhpcy5wcm9jZXNzaW5nSW50ZXJ2YWwgPSBudWxsO1xuICAgICAgICAgICAgdGhpcy5pbnRlcnZhbExlbmd0aCA9IDE7XG4gICAgICAgICAgICB0aGlzLnN0YXRpY1Rhc2tSdW5uZXJUaHJlYWRDb3VudCA9IDA7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHRoaXMuX3ZhbGlkYXRlT3B0aW9ucygpO1xuICAgICAgICAgICAgdGhpcy5faW5pdFdvcmtlclBvb2woZ2V0Q2FsbGVyRmlsZSgpKTtcblxuICAgICAgICAgICAgaW5zdGFudGlhdGVkUG9vbHMucHVzaCh0aGlzKTtcbiAgICAgICAgICAgIHRoaXMucG9vbE5vID0gaW5zdGFudGlhdGVkUG9vbHMubGVuZ3RoIC0gMTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEBwcml2YXRlXG4gICAgICogSW5pdGlhdGVzIHRoZSB3b3JrZXJzIHBvb2wgYnkgY3JlYXRpbmcgdGhlIHdvcmtlciB0aHJlYWRzXG4gICAgICovXG4gICAgX2luaXRXb3JrZXJQb29sKGNhbGxlclBhdGg6IHN0cmluZyl7XG4gICAgICAgIGxldCB0YXNrUnVubmVyc0NvdW50ID0gdGhpcy5vcHRpb25zLnRhc2tSdW5uZXJzP3RoaXMub3B0aW9ucy50YXNrUnVubmVycy5sZW5ndGg6MDtcbiAgICAgICAgbGV0IGZpbGVQYXRoID0gY2FsbGVyUGF0aDtcbiAgICAgICAgbGV0IHRvdGFsU3RhdGljVGhyZWFkcyA9IDA7XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0YXNrUnVubmVyc0NvdW50OyBpKyspe1xuICAgICAgICAgICAgbGV0IGZ1bmN0aW9uTmFtZSA9IHRoaXMub3B0aW9ucy50YXNrUnVubmVyc1tpXS5qb2IubmFtZTtcbiAgICAgICAgICAgIGxldCBuYW1lID0gdGhpcy5vcHRpb25zLnRhc2tSdW5uZXJzW2ldLm5hbWU7XG4gICAgICAgICAgICBsZXQgdGhyZWFkQ291bnQgPSB0aGlzLm9wdGlvbnMudGFza1J1bm5lcnNbaV0udGhyZWFkQ291bnQ7XG4gICAgICAgICAgICBsZXQgbG9ja1RvVGhyZWFkcyA9IHRoaXMub3B0aW9ucy5sb2NrVGFza1J1bm5lcnNUb1RocmVhZHM7XG4gICAgICAgICAgICB0b3RhbFN0YXRpY1RocmVhZHMgKz0gdGhyZWFkQ291bnQ7XG4gICAgICAgICAgICB0aGlzLl9hZGRUYXNrUnVubmVyKHtuYW1lLCB0aHJlYWRDb3VudCwgbG9ja1RvVGhyZWFkcywgZmlsZVBhdGgsIGZ1bmN0aW9uTmFtZX0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTWFrZSBhbGwgb3RoZXJzIGR5bmFtaWNcbiAgICAgICAgZm9yIChsZXQgayA9IDA7IGsgPCAodGhpcy5vcHRpb25zLnRvdGFsVGhyZWFkQ291bnQgLSB0b3RhbFN0YXRpY1RocmVhZHMpOyBrKyspIHtcbiAgICAgICAgICAgIGxldCBfd29ya2VyID0gbmV3IFRhc2tXb3JrZXIoZ2VuZXRhdGVTY3JpcHQoRFlOQU1JQyksIHtldmFsOiB0cnVlfSk7XG4gICAgICAgICAgICBfd29ya2VyLmJ1c3kgPSBmYWxzZTtcbiAgICAgICAgICAgIF93b3JrZXIuaWQgPSBpO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIXRoaXMud29ya2Vyc1Bvb2wuaGFzKERZTkFNSUMpKSB7XG4gICAgICAgICAgICAgICAgdGhpcy53b3JrZXJzUG9vbC5zZXQoRFlOQU1JQywgbmV3IEFycmF5PFRhc2tXb3JrZXI+KCkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLndvcmtlcnNQb29sLmdldChEWU5BTUlDKS5wdXNoKF93b3JrZXIpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBfdmFsaWRhdGVPcHRpb25zKCkge1xuICAgICAgICBsZXQgdGhyZWFkQ291bnRPZlRhc2tSdW5uZXJzID0gMDtcblxuICAgICAgICBpZiAodGhpcy5vcHRpb25zLnRhc2tSdW5uZXJzKSB7XG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMudGFza1J1bm5lcnMubWFwKCh0YXNrUnVubmVyKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCF0YXNrUnVubmVyLm5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXZlcnkgdGFzayBydW5uZXIgc2hvdWxkIGhhdmUgYSBuYW1lXCIpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghdGFza1J1bm5lci50aHJlYWRDb3VudCkge1xuICAgICAgICAgICAgICAgICAgICB0YXNrUnVubmVyLnRocmVhZENvdW50ID0gTWF0aC5mbG9vcih0aGlzLm9wdGlvbnMudG90YWxUaHJlYWRDb3VudC90aGlzLm9wdGlvbnMudGFza1J1bm5lcnMubGVuZ3RoKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBUaGUgdGFzayAke3Rhc2tSdW5uZXIubmFtZX0gaGFzIG5vIHRocmVhZCBjb3VudCBzcGVjaWZpZWQ7IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZXJlZm9yZSwgJHt0YXNrUnVubmVyLnRocmVhZENvdW50fSBpcyBhc3NpZ25lZCB0byBpdGApXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdGhyZWFkQ291bnRPZlRhc2tSdW5uZXJzICs9IHRhc2tSdW5uZXIudGhyZWFkQ291bnQ7XG4gICAgICAgICAgICB9KTsgIFxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRocmVhZENvdW50T2ZUYXNrUnVubmVycyA+IHRoaXMub3B0aW9ucy50aHJlYWRDb3VudCkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGBUaGUgdG90YWwgbnVtYmVyIG9mIHRocmVhZHMgcmVxdWVzdGVkIGJ5IHRhc2sgcnVubmVycyAoJHt0aHJlYWRDb3VudE9mVGFza1J1bm5lcnN9KVxuICAgICAgICAgICAgICAgICAgICAgICAgICBleGNlZWRzIHRoZSB0b3RhbCBudW1iZXIgb2YgdGhyZWFkcyBzcGVjaWZpZWQgKCR7dGhpcy5vcHRpb25zLnRocmVhZENvdW50fSkuIFRoZSB0b3RhbCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbnVtYmVyIG9mIHRocmVhZHMgaXMgdXBkYXRlZCB0byBtYXRjaCB0aGUgbnVtYmVyIG9mIHRocmVhZHMgXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVlc3RlZCBieSB0YXNrIHJ1bm5lcnNgKTtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy50aHJlYWRDb3VudCA9IHRocmVhZENvdW50T2ZUYXNrUnVubmVycztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLm9wdGlvbnMudGhyZWFkQ291bnQgPCAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3RocmVhZENvdW50IGNhbm5vdCBiZSBsZXNzIHRoYW4gMScpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLm9wdGlvbnMudGhyZWFkQ291bnQpIHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy50aHJlYWRDb3VudCA9IENQVV9DT1JFU19OTyAtIDE7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMub3B0aW9ucy5sb2NrVGFza1J1bm5lcnNUb1RocmVhZHMpIHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy5sb2NrVGFza1J1bm5lcnNUb1RocmVhZHMgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLm9wdGlvbnMuYWxsb3dEeW5hbWljVGFza1J1bm5lckFkZGl0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMuYWxsb3dEeW5hbWljVGFza1J1bm5lckFkZGl0aW9uID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9hZGRUYXNrUnVubmVyKHtuYW1lLCB0aHJlYWRDb3VudCwgbG9ja1RvVGhyZWFkcywgZmlsZVBhdGgsIGZ1bmN0aW9uTmFtZX0pIHtcbiAgICAgICAgaWYgKGxvY2tUb1RocmVhZHMpIHtcbiAgICAgICAgICAgIGlmICghdGhyZWFkQ291bnQgfHwgdGhyZWFkQ291bnQgPiB0aGlzLm9wdGlvbnMudG90YWxUaHJlYWRDb3VudCAtIHRoaXMuc3RhdGljVGFza1J1bm5lclRocmVhZENvdW50KSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZHluYW1pY1Rhc2tSdW5uZXJMaXN0Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyZWFkQ291bnQgPSB0aGlzLm9wdGlvbnMudG90YWxUaHJlYWRDb3VudCAtIHRoaXMuc3RhdGljVGFza1J1bm5lclRocmVhZENvdW50IC0gMTtcbiAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRocmVhZENvdW50ID09PSAwKVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaGVyZSBhcmUgbm8gZW5vdWdoIGZyZWUgdGhyZWFkcycpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRocmVhZENvdW50ID0gdGhpcy5vcHRpb25zLnRvdGFsVGhyZWFkQ291bnQgLSB0aGlzLnN0YXRpY1Rhc2tSdW5uZXJUaHJlYWRDb3VudDtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aGlzLnN0YXRpY1Rhc2tSdW5uZXJUaHJlYWRDb3VudCArPSB0aHJlYWRDb3VudDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ3JlYXRlIHRoZSBuZXcgd29ya2VyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRocmVhZENvdW50OyBpKyspIHtcbiAgICAgICAgICAgICAgICBsZXQgcGF0aEFyciA9IHBhdGgubm9ybWFsaXplKGZpbGVQYXRoKS5zcGxpdChwYXRoLnNlcCk7XG4gICAgICAgICAgICAgICAgZmlsZVBhdGggPSAnJztcbiAgICAgICAgICAgICAgICBwYXRoQXJyLm1hcCgoc2VnOiBzdHJpbmcsIGk6IG51bWJlcikgPT4ge1xuICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aCArPSBzZWc7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGkgIT0gcGF0aEFyci5sZW5ndGggLSAxKVxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGggKz0gJ1xcXFxcXFxcJztcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBsZXQgX3dvcmtlciA9IG5ldyBUYXNrV29ya2VyKGdlbmV0YXRlU2NyaXB0KFNUQVRJQywgZmlsZVBhdGgsIGZ1bmN0aW9uTmFtZSksIHtldmFsOiB0cnVlfSk7XG4gICAgICAgICAgICAgICAgX3dvcmtlci5idXN5ID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgX3dvcmtlci5pZCA9IGk7XG5cbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMud29ya2Vyc1Bvb2wuaGFzKG5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMud29ya2Vyc1Bvb2wuc2V0KG5hbWUsIG5ldyBBcnJheTxUYXNrV29ya2VyPigpKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aGlzLndvcmtlcnNQb29sLmdldChuYW1lKS5wdXNoKF93b3JrZXIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaWYgKHRoaXMuc3RhdGljVGFza1J1bm5lclRocmVhZENvdW50ID09PSB0aGlzLm9wdGlvbnMudG90YWxUaHJlYWRDb3VudCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVGhlcmUgYXJlIG5vIGVub3VnaCBmcmVlIHRocmVhZHMnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdGhpcy5keW5hbWljVGFza1J1bm5lckxpc3QucHVzaCh7bmFtZSwgZnVuY3Rpb25OYW1lLCBmaWxlUGF0aH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkVGFza1J1bm5lcih0YXNrUnVubmVyOiBUYXNrUnVubmVyKSB7XG4gICAgICAgIGxldCB7bmFtZSwgam9iLCB0aHJlYWRDb3VudCwgbG9ja1RvVGhyZWFkc30gPSB0YXNrUnVubmVyO1xuICAgICAgICBsZXQgZmlsZVBhdGggPSBnZXRDYWxsZXJGaWxlKCk7XG4gICAgICAgIGxldCBmdW5jdGlvbk5hbWUgPSBqb2IubmFtZTtcblxuICAgICAgICB0aGlzLl9hZGRUYXNrUnVubmVyKHtuYW1lLCB0aHJlYWRDb3VudCwgbG9ja1RvVGhyZWFkcywgZmlsZVBhdGgsIGZ1bmN0aW9uTmFtZX0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEdlbmVyYXRlcyBhbiBhc3luY2hyb25vdXMgcHJvbWlzZSBiYXNlZCBmdW5jdGlvbiBvdXQgb2YgYSBzeW5jaHJvbm91cyBvbmVcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdGFza1J1bm5lck5hbWVcbiAgICAgKi9cbiAgICBnZXRBc3luY0Z1bmModGFza1J1bm5lck5hbWU6IHN0cmluZyl7XG4gICAgICAgIGlmIChpc01haW5UaHJlYWQpe1xuICAgICAgICAgICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoIXRoaXMud29ya2Vyc1Bvb2wuZ2V0KHRhc2tSdW5uZXJOYW1lKSAmJiAhdGhpcy53b3JrZXJzUG9vbC5nZXQoRFlOQU1JQykpXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFRoZXJlIGlzIG5vIHRhc2sgcnVubmVyIHdpdGggdGhlIG5hbWUgJHt0YXNrUnVubmVyTmFtZX1gKVxuICAgICAgICAgICAgXG4gICAgICAgICAgICByZXR1cm4gYXN5bmMgZnVuY3Rpb24gKC4uLnBhcmFtcykge1xuICAgICAgICAgICAgICAgIGNvdW50ZXIrKztcbiAgICAgICAgICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBsZXQgcmVzb2x2ZUNhbGxiYWNrID0gKHJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgICAgIGxldCByZWplY3RDYWxsYmFjayA9IChlcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgICAgICBsZXQgdGFzayA9IG5ldyBUYXNrKHRhc2tSdW5uZXJOYW1lLCBwYXJhbXMsIHJlc29sdmVDYWxsYmFjaywgcmVqZWN0Q2FsbGJhY2spO1xuICAgICAgICAgICAgICAgICAgICBzZWxmLmVucXVldWVUYXNrKCB0YXNrICk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBFbnF1ZXVlcyBhIHRhc2sgdG8gYmUgcHJvY2Vzc2VkIHdoZW4gYW4gaWRsZSB3b3JrZXIgdGhyZWFkIGlzIGF2YWlsYWJsZVxuICAgICAqIEBwYXJhbSB7VGFza30gdGFzayBUaGUgdGFzayB0byBiZSBydW4gXG4gICAgICovXG4gICAgYXN5bmMgZW5xdWV1ZVRhc2sodGFzazogVGFzayl7XG4gICAgICAgIHRoaXMudGFza1F1ZXVlLnB1c2godGFzayk7XG5cbiAgICAgICAgaWYgKCF0aGlzLnByb2Nlc3NpbmdJbnRlcnZhbCkge1xuICAgICAgICAgICAgdGhpcy5fc3RhcnRUYXNrUHJvY2Vzc2luZygpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQHByaXZhdGVcbiAgICAgKiBDaGVja3MgaWYgdGhlcmUgYXJlIGFueSBwZW5kaW5nIHRhc2tzIGFuZCBpZiB0aGVyZSBhcmUgYW55IGlkbGVcbiAgICAgKiB3b3JrZXJzIHRvIHByb2Nlc3MgdGhlbSwgcHJlcGFyZXMgdGhlbSBmb3IgcHJvY2Vzc2luZywgYW5kIHByb2Nlc3Nlc1xuICAgICAqIHRoZW0uXG4gICAgICovXG4gICAgYXN5bmMgX3N0YXJ0VGFza1Byb2Nlc3NpbmcoKXtcbiAgICAgICAgdmFyIHdvcmtlcjogVGFza1dvcmtlcjtcbiAgICAgICAgaWYgKHRoaXMucHJvY2Vzc2luZ0ludGVydmFsICE9IG51bGwpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnByb2Nlc3NpbmdJbnRlcnZhbCA9IHNldEludGVydmFsKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKHRoaXMudGFza1F1ZXVlLmxlbmd0aCA8IDEpIHtcbiAgICAgICAgICAgICAgICB0aGlzLnN0b3BQcm9jZXNzaW5nKCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIGZvciAobGV0IHRhc2sgb2YgdGhpcy50YXNrUXVldWUpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMuYnVzeVdvcmtlcnNDb3VudCAhPT0gdGhpcy5vcHRpb25zLnRvdGFsVGhyZWFkQ291bnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHJlbW92ZSBhIGZyZWUgd29ya2VyIGZyb20gdGhlIGJlZ2luaW5ncyBvZiB0aGUgYXJyYXlcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy53b3JrZXJzUG9vbC5nZXQodGFzay50YXNrUnVubmVyTmFtZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsZXQgdGFza1J1bm5lckluZm8gPSB0aGlzLmR5bmFtaWNUYXNrUnVubmVyTGlzdC5maW5kKGR5bmFtaWNUYXNrUnVubmVyID0+IGR5bmFtaWNUYXNrUnVubmVyLm5hbWUgPT09IHRhc2sudGFza1J1bm5lck5hbWUpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxldCBmaWxlUGF0aCA9IHRhc2tSdW5uZXJJbmZvLmZpbGVQYXRoO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxldCBmdW5jdGlvbk5hbWUgPSB0YXNrUnVubmVySW5mby5mdW5jdGlvbk5hbWU7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXNrLnRhc2tSdW5uZXJOYW1lID0gRFlOQU1JQztcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXNrLmZpbGVQYXRoID0gZmlsZVBhdGg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFzay5mdW5jdGlvbk5hbWUgPSBmdW5jdGlvbk5hbWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIHdvcmtlciA9IHRoaXMud29ya2Vyc1Bvb2wuZ2V0KHRhc2sudGFza1J1bm5lck5hbWUpLnNoaWZ0KCk7XG5cbiAgICAgICAgICAgICAgICAgICAgICAgIGlmICh3b3JrZXIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAoIXRoaXMuYnVzeVdvcmtlcnMuaGFzKHRhc2sudGFza1J1bm5lck5hbWUpKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJ1c3lXb3JrZXJzLnNldCh0YXNrLnRhc2tSdW5uZXJOYW1lLCBuZXcgQXJyYXk8VGFza1dvcmtlcj4oKSk7XG4gICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5idXN5V29ya2Vycy5nZXQodGFzay50YXNrUnVubmVyTmFtZSkucHVzaCh3b3JrZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhc2sgPSB0aGlzLnRhc2tRdWV1ZS5zaGlmdCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYWN0aXZlVGFza3MucHVzaCh0YXNrKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnByb2Nlc3NlZC5zZXQodGFzay5rZXksIGZhbHNlKTtcbiAgICAgICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5idXN5V29ya2Vyc0NvdW50ICsrO1xuICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHdvcmtlci5wcm9jZXNzVGFzayh0YXNrKS50aGVuKChhbnN3ZXIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYW5zd2VyLnRhc2sucmVzb2x2ZUNhbGxiYWNrKGFuc3dlci5yZXN1bHQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZVdvcmtlcnNRdWV1ZShhbnN3ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pLmNhdGNoKChhbnN3ZXIpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYW5zd2VyLnRhc2sucmVqZWN0Q2FsbGJhY2soYW5zd2VyLmVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy51cGRhdGVXb3JrZXJzUXVldWUoYW5zd2VyKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9LCB0aGlzLmludGVydmFsTGVuZ3RoKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBcbiAgICAgKi9cbiAgICBzdG9wUHJvY2Vzc2luZygpe1xuICAgICAgICBpZiAodGhpcy5wcm9jZXNzaW5nSW50ZXJ2YWwpe1xuICAgICAgICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnByb2Nlc3NpbmdJbnRlcnZhbCk7XG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NpbmdJbnRlcnZhbCA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBcbiAgICAgKiBAcGFyYW0geyp9IGFuc3dlciBcbiAgICAgKi9cbiAgICBhc3luYyB1cGRhdGVXb3JrZXJzUXVldWUgKGFuc3dlcikge1xuICAgICAgICB0aGlzLmJ1c3lXb3JrZXJzQ291bnQtLTtcbiAgICAgICAgdGhpcy5hY3RpdmVUYXNrcyA9IHRoaXMuYWN0aXZlVGFza3MuZmlsdGVyKCB0YXNrID0+IHRhc2sua2V5ICE9PSBhbnN3ZXIudGFzay5rZXkpO1xuICAgICAgICB0aGlzLndvcmtlcnNQb29sLmdldChhbnN3ZXIudGFzay50YXNrUnVubmVyTmFtZSkudW5zaGlmdChhbnN3ZXIud29ya2VyKTtcbiAgICAgICAgdGhpcy5idXN5V29ya2Vycy5zZXQoYW5zd2VyLnRhc2sudGFza1J1bm5lck5hbWUsIHRoaXMuYnVzeVdvcmtlcnMuZ2V0KGFuc3dlci50YXNrLnRhc2tSdW5uZXJOYW1lKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLmZpbHRlcihidXN5V29ya2VyID0+IGJ1c3lXb3JrZXIuaWQgIT09IGFuc3dlci53b3JrZXIuaWQpKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUZXJtaW5hdGVzIGFsbCB0aGUgdGFza3MuIElmIGZvcmNlZCBpcyB0cnVlIGl0IHdpbGwgbm90IHdhaXQgZm9yIHRoZVxuICAgICAqIGFjdGl2ZSB0YXNrcyB0byBmaW5pc2guXG4gICAgICogQHBhcmFtIHtib29sZWFufSBmb3JjZWQgVG8gdGVybWluYXRlIGltbWVkaWF0ZWx5XG4gICAgICovXG4gICAgdGVybWluYXRlKGZvcmNlZDogYm9vbGVhbil7XG4gICAgICAgIHRoaXMudGFza1F1ZXVlID0gW107XG5cbiAgICAgICAgT2JqZWN0LnZhbHVlcyh0aGlzLndvcmtlcnNQb29sKS5tYXAod29ya2VyID0+IHtcbiAgICAgICAgICAgIHdvcmtlci50ZXJtaW5hdGUoKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgdGhpcy53b3JrZXJzUG9vbCA9IG5ldyBNYXA8c3RyaW5nLCBBcnJheTxUYXNrV29ya2VyPj4oKTtcblxuICAgICAgICBpZiAoZm9yY2VkKXtcbiAgICAgICAgICAgIE9iamVjdC52YWx1ZXModGhpcy5idXN5V29ya2VycykubWFwKHdvcmtlciA9PiB7XG4gICAgICAgICAgICAgICAgd29ya2VyLnRlcm1pbmF0ZSgpO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHRoaXMuYnVzeVdvcmtlcnMgPSBuZXcgTWFwPHN0cmluZywgQXJyYXk8VGFza1dvcmtlcj4+KCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUaGUgY3VycmVudCBzdGF0dXMgb2YgdGhlIHBvb2xcbiAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IGRldGFpbGVkIElmIHRydWUgdGhlIGluZm9ybWF0aW9uIHdpbGwgYmUgZGV0YWlsZWRcbiAgICAgKi9cbiAgICBzdGF0aWMgc3RhdHVzKGRldGFpbGVkOiBib29sZWFuID0gZmFsc2Upe1xuICAgICAgICBjb25zb2xlLmxvZygnLS0tLS0tLS0tLS0tLS0tLS0tLScpXG4gICAgICAgIGNvbnNvbGUubG9nKCdcXG5OdW1iZXIgb2YgcG9vbHM6ICcsIGluc3RhbnRpYXRlZFBvb2xzLmxlbmd0aCk7XG5cbiAgICAgICAgaW5zdGFudGlhdGVkUG9vbHMubWFwKCAocG9vbDogUG9vbCkgPT4ge1xuICAgICAgICAgICAgbGV0IGlkbGVXb3JrZXJzOiBBcnJheTxBcnJheTxUYXNrV29ya2VyPj4gPSBuZXcgQXJyYXk8QXJyYXk8VGFza1dvcmtlcj4+KCk7XG4gICAgICAgICAgICBsZXQgYnVzeVdvcmtlcnM6IEFycmF5PEFycmF5PFRhc2tXb3JrZXI+PiA9IG5ldyBBcnJheTxBcnJheTxUYXNrV29ya2VyPj4oKTtcbiAgICAgICAgICAgIGxldCBpZGxlV29ya2Vyc0NvdW50OiBudW1iZXIgPSAwO1xuICAgICAgICAgICAgbGV0IGJ1c3lXb3JrZXJzQ291bnQ6IG51bWJlciA9IDA7XG4gICAgICAgICAgICBsZXQgYWN0aXZlVGFza3NDb3VudDogbnVtYmVyID0gMDsgXG4gICAgICAgICAgICBsZXQgd2FpdGluZ1Rhc2tzQ291bnQ6IG51bWJlciA9IDA7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlkbGVXb3JrZXJzID0gQXJyYXkuZnJvbShwb29sLndvcmtlcnNQb29sLnZhbHVlcygpKTtcbiAgICAgICAgICAgIGJ1c3lXb3JrZXJzID0gQXJyYXkuZnJvbShwb29sLmJ1c3lXb3JrZXJzLnZhbHVlcygpKTtcblxuICAgICAgICAgICAgaWRsZVdvcmtlcnMubWFwKCh3b3JrZXJzTGlzdDogQXJyYXk8VGFza1dvcmtlcj4pID0+IHtcbiAgICAgICAgICAgICAgICBpZGxlV29ya2Vyc0NvdW50ICs9IHdvcmtlcnNMaXN0Lmxlbmd0aDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBidXN5V29ya2Vycy5tYXAoKHdvcmtlcnNMaXN0OiBBcnJheTxUYXNrV29ya2VyPikgPT4ge1xuICAgICAgICAgICAgICAgIGJ1c3lXb3JrZXJzQ291bnQgKz0gd29ya2Vyc0xpc3QubGVuZ3RoO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGFjdGl2ZVRhc2tzQ291bnQgPSBwb29sLmFjdGl2ZVRhc2tzLmxlbmd0aDtcbiAgICAgICAgICAgIHdhaXRpbmdUYXNrc0NvdW50ID0gcG9vbC50YXNrUXVldWUubGVuZ3RoO1xuXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgLS0tLS0tLS0tLSBQT09MICR7cG9vbC5wb29sTm99IC0tLS0tLS0tLS1gKVxuICAgICAgICAgICAgY29uc29sZS5sb2coJ051bWJlciBvZiBpZGxlIHdvcmtlcnM6ICcsIGlkbGVXb3JrZXJzQ291bnQpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ051bWJlciBvZiBidXN5IHdvcmtlcnM6ICcsIGJ1c3lXb3JrZXJzQ291bnQpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ051bWJlciBvZiBhY3RpdmUgdGFza3M6ICcsIGFjdGl2ZVRhc2tzQ291bnQpO1xuICAgICAgICAgICAgY29uc29sZS5sb2coJ051bWJlciBvZiBXYWl0aW5nIHRhc2tzOiAnLCB3YWl0aW5nVGFza3NDb3VudCk7IFxuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAoZGV0YWlsZWQpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnXFxuQWN0aXZlIHRhc2tzOiBcXG4nKTtcbiAgICAgICAgICAgICAgICBwb29sLmFjdGl2ZVRhc2tzLm1hcCgodGFzaywgaSkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhpLCcgOiAnLCBKU09OLnN0cmluZ2lmeSh0YXNrKSwgJ1xcbicpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICBcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnV2FpdGluZyB0YXNrczogXFxuJyk7XG4gICAgICAgICAgICAgICAgcG9vbC50YXNrUXVldWUubWFwKCh0YXNrLCBpKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGksJyA6ICcsIEpTT04uc3RyaW5naWZ5KHRhc2spLCAnXFxuJyk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbn0iXX0=
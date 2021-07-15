"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
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
module.exports = class Pool {
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
            this.workersPool[DYNAMIC].push(_worker);
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
                this.workersPool[name].push(_worker);
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
        this.workersPool.get(answer.task.taskRunnerName).unshift(answer.worker);
        this.busyWorkers.set(answer.task.taskRunnerName, this.busyWorkers[answer.task.taskRunnerName]
            .filter(busyWorker => busyWorker.id !== answer.worker.id));
    }
    /**
     * Terminates all the tasks. If forced is true it will not wait for the
     * active tasks to finish.
     * @param {boolean} forced To terminate immediately
     */
    terminate(forced) {
        // // tq_mutex.acquire().then((tq_release) => {
        //     this.taskQueue = [];
        //     // tq_release();
        //     // wp_mutex.acquire().then((wp_release) => {
        //         this.workersPool.map(worker => {
        //             worker.terminate();
        //         });
        //         this.workersPool = [];
        //         // wp_release();
        //         if (forced){
        //             // bw_mutex.acquire().then((bw_release) => {
        //                 this.busyWorkers.map(worker => {
        //                     worker.terminate();
        //                 });
        //                 this.busyWorkers = {};
        //                 // bw_release();
        //             // });
        //         }
        //     // });
        // // });
    }
    /**
     * The current status of the pool
     * @param {boolean} detailed If true the information will be detailed
     */
    static status(detailed) {
        // console.log('Number of pools: ', instantiatedPools.length);
        // instantiatedPools.map( pool => {
        //     console.log(`---------- POOL ${pool.poolNo} ----------`)
        //     console.log('Number of idle workers: ', pool.workersPool.length);
        //     console.log('Number of busy workers: ', pool.workersNo - pool.workersPool.length);
        //     console.log('Number of active tasks: ', pool.activeTasks.length);
        //     console.log('Number of Waiting tasks: ', pool.taskQueue.length); 
        //     if (detailed) {
        //         console.log('\nActive tasks: \n');
        //         pool.activeTasks.map((task, i) => {
        //             console.log(i,' : ', JSON.stringify(task), '\n');
        //         });
        //         console.log('Waiting tasks: \n');
        //         pool.taskQueue.map((task, i) => {
        //             console.log(i,' : ', JSON.stringify(task), '\n');
        //         });
        //     }
        // });
    }
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUG9vbC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uL2xpYi9Qb29sLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUEsaUNBQThCO0FBQzlCLDZDQUEwQztBQUMxQyxNQUFNLElBQUksR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7QUFDN0IsTUFBTSxFQUFFLEdBQUcsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ3pCLE1BQU0sRUFBRSxZQUFZLEVBQUUsR0FBRyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztBQUNuRCxNQUFNLGFBQWEsR0FBRyxPQUFPLENBQUMsaUJBQWlCLENBQUMsQ0FBQztBQUNqRCxNQUFNLEVBQUUsY0FBYyxFQUFFLEdBQUcsT0FBTyxDQUFDLG1CQUFtQixDQUFDLENBQUM7QUFFeEQsTUFBTSxPQUFPLEdBQUcsU0FBUyxDQUFDO0FBQzFCLE1BQU0sTUFBTSxHQUFHLFFBQVEsQ0FBQztBQUN4QixNQUFNLFlBQVksR0FBRyxFQUFFLENBQUMsSUFBSSxFQUFFLENBQUMsTUFBTSxDQUFDO0FBQ3RDLElBQUksaUJBQWlCLEdBQUcsRUFBRSxDQUFDO0FBQzNCLElBQUksT0FBTyxHQUFHLENBQUMsQ0FBQztBQW1CaEIsTUFBTSxDQUFDLE9BQU8sR0FBRyxNQUFNLElBQUk7SUFjdkI7Ozs7T0FJRztJQUNILFlBQVksT0FBMkI7UUFDbkMsSUFBSSxZQUFZLEVBQUU7WUFDZCxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksR0FBRyxFQUFFLENBQUMsQ0FBQyw0QkFBNEI7WUFDMUQsSUFBSSxDQUFDLFdBQVcsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDLENBQUMsOENBQThDO1lBQzVFLElBQUksQ0FBQyxTQUFTLEdBQUssSUFBSSxLQUFLLEVBQUUsQ0FBQyxDQUFDLHFDQUFxQztZQUNyRSxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUksS0FBSyxFQUFFLENBQUMsQ0FBQyxxQ0FBcUM7WUFDckUsSUFBSSxDQUFDLFNB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RCwwQ0FBMEM7UUFDMUMsc0JBQXNCO1FBQ3RCLHlDQUF5QztRQUN6QyxtQ0FBbUM7UUFDbkMscUJBQXFCO1FBQ3JCLFlBQVk7UUFDWixhQUFhO1FBQ2IsU0FBUztJQUNiLENBQUM7SUFFRDs7O09BR0c7SUFDSCxNQUFNLENBQUMsTUFBTSxDQUFDLFFBQVE7UUFDbEIsOERBQThEO1FBRTlELG1DQUFtQztRQUNuQywrREFBK0Q7UUFDL0Qsd0VBQXdFO1FBQ3hFLHlGQUF5RjtRQUN6Rix3RUFBd0U7UUFDeEUsd0VBQXdFO1FBRXhFLHNCQUFzQjtRQUN0Qiw2Q0FBNkM7UUFDN0MsOENBQThDO1FBQzlDLGdFQUFnRTtRQUNoRSxjQUFjO1FBRWQsNENBQTRDO1FBQzVDLDRDQUE0QztRQUM1QyxnRUFBZ0U7UUFDaEUsY0FBYztRQUNkLFFBQVE7UUFDUixNQUFNO0lBQ1YsQ0FBQztDQUNKLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBUYXNrIH0gZnJvbSBcIi4vdGFza1wiO1xuaW1wb3J0IHsgVGFza1dvcmtlciB9IGZyb20gXCIuL1Rhc2tXb3JrZXJcIjtcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBvcyA9IHJlcXVpcmUoJ29zJyk7XG5jb25zdCB7IGlzTWFpblRocmVhZCB9ID0gcmVxdWlyZSgnd29ya2VyX3RocmVhZHMnKTtcbmNvbnN0IGdldENhbGxlckZpbGUgPSByZXF1aXJlKCdnZXQtY2FsbGVyLWZpbGUnKTtcbmNvbnN0IHsgZ2VuZXRhdGVTY3JpcHQgfSA9IHJlcXVpcmUoJy4vU2NyaXB0R2VuZXJhdG9yJyk7XG5cbmNvbnN0IERZTkFNSUMgPSAnZHluYW1pYyc7XG5jb25zdCBTVEFUSUMgPSAnc3RhdGljJztcbmNvbnN0IENQVV9DT1JFU19OTyA9IG9zLmNwdXMoKS5sZW5ndGg7XG52YXIgaW5zdGFudGlhdGVkUG9vbHMgPSBbXTtcbmxldCBjb3VudGVyID0gMDtcblxuaW50ZXJmYWNlIFRhc2tSdW5uZXIge1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBqb2I/OiBGdW5jdGlvbjtcbiAgICBmdW5jdGlvbk5hbWU/OiBzdHJpbmc7XG4gICAgZmlsZVBhdGg/OiBzdHJpbmc7IFxuICAgIHRocmVhZENvdW50PzogbnVtYmVyO1xuICAgIGxvY2tUb1RocmVhZHM/OiBib29sZWFuO1xufVxuXG5pbnRlcmZhY2UgV29ya2Vyc1Bvb2xPcHRpb25zIHtcbiAgICB0YXNrUnVubmVycz86IEFycmF5PFRhc2tSdW5uZXI+OyAvLyBBbiBhcnJheSBvZiBhbGwgdGhlIHRhc2tSdW5uZXJzIGZvciB0aGUgcG9vbFxuICAgIHRvdGFsVGhyZWFkQ291bnQ/OiBudW1iZXI7IC8vIFRoZSB0b3RhbCBudW1iZXIgb2YgdGhyZWFkcyB3YW50ZWRcbiAgICBsb2NrVGFza1J1bm5lcnNUb1RocmVhZHM/OiBib29sZWFuOyAvLyBXaGV0aGVyIG9yIG5vdCB0byBoYXZlIGRlZGljYXRlZCB0aHJlYWRzIGZvciB0aGUgdGFza1J1bm5lcnNcbiAgICBhbGxvd0R5bmFtaWNUYXNrUnVubmVyQWRkaXRpb24/OiBib29sZWFuOyAvLyBXaGV0aGVyIG9yIG5vdCB0byBhbGxvdyBhZGRpbmcgbW9yZSB0YXNrIHJ1bm5lcnNcbiAgICB0aHJlYWRDb3VudDogbnVtYmVyO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGNsYXNzIFBvb2x7XG4gICAgd29ya2Vyc1Bvb2w6IE1hcDxzdHJpbmcsIEFycmF5PFRhc2tXb3JrZXI+PjtcbiAgICBidXN5V29ya2VyczogTWFwPHN0cmluZywgQXJyYXk8VGFza1dvcmtlcj4+O1xuICAgIHRhc2tRdWV1ZTogQXJyYXk8VGFzaz47XG4gICAgYWN0aXZlVGFza3M6IEFycmF5PFRhc2s+O1xuICAgIHByb2Nlc3NlZDogTWFwPG51bWJlciwgYm9vbGVhbj47XG4gICAgZHluYW1pY1Rhc2tSdW5uZXJMaXN0OiBBcnJheTxUYXNrUnVubmVyPlxuICAgIGJ1c3lXb3JrZXJzQ291bnQ6IG51bWJlcjtcbiAgICBvcHRpb25zOiBXb3JrZXJzUG9vbE9wdGlvbnM7XG4gICAgcHJvY2Vzc2luZ0ludGVydmFsOiBOb2RlSlMuVGltZW91dDtcbiAgICBpbnRlcnZhbExlbmd0aDogbnVtYmVyO1xuICAgIHN0YXRpY1Rhc2tSdW5uZXJUaHJlYWRDb3VudDogbnVtYmVyO1xuICAgIHBvb2xObzogbnVtYmVyO1xuXG4gICAgLyoqXG4gICAgICogVGhlIGNvbnN0cnVjdG9yIG9mIFBvb2wgY2xhc3NcbiAgICAgKiBAcGFyYW0ge251bWJlcn0gbiBUaGUgbnVtYmVyIG9mIHRocmVhZHMgKGRlZmF1bHQgaXMgdGhlIG51bWJlciBvZiBjcHUgY29yZXMgLSAxKVxuICAgICAqIEBwYXJhbSB7V29ya2Vyc1Bvb2xPcHRpb25zfSBvcHRpb25zIFRoZSBvcHRpb25hbCBvcHRpb25zIHVzZWQgaW4gY3JlYXRpbmcgd29ya2Vyc1xuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFdvcmtlcnNQb29sT3B0aW9ucyl7XG4gICAgICAgIGlmIChpc01haW5UaHJlYWQpIHtcbiAgICAgICAgICAgIHRoaXMud29ya2Vyc1Bvb2wgPSBuZXcgTWFwKCk7IC8vIGNvbnRhaW5zIHRoZSBpZGxlIHdvcmtlcnNcbiAgICAgICAgICAgIHRoaXMuYnVzeVdvcmtlcnMgPSBuZXcgTWFwKCk7IC8vIGNvbnRhaW5zIHRoZSBidXN5IHdvcmtlcnMgKHByb2Nlc3NpbmcgY29kZSlcbiAgICAgICAgICAgIHRoaXMudGFza1F1ZXVlICAgPSBuZXcgQXJyYXkoKTsgLy8gY29udGFpbnMgdGhlIHRhc2tzIHRvIGJlIHByb2Nlc3NlZFxuICAgICAgICAgICAgdGhpcy5hY3RpdmVUYXNrcyA9IG5ldyBBcnJheSgpOyAvLyBjb250YWlucyB0aGUgdGFza3MgYmVpbmcgcHJvY2Vzc2VkXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NlZCA9IG5ldyBNYXAoKTsgICAvLyB7dGFza0tleTpib29sZWFufSB3aGV0aGVyIGEgdGFzayBoYXMgYmVlbiBwcm9jZXNzZWQgeWV0XG4gICAgICAgICAgICB0aGlzLmR5bmFtaWNUYXNrUnVubmVyTGlzdCA9IG5ldyBBcnJheSgpO1xuICAgICAgICAgICAgdGhpcy5idXN5V29ya2Vyc0NvdW50ID0gMDtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc2luZ0ludGVydmFsID0gbnVsbDtcbiAgICAgICAgICAgIHRoaXMuaW50ZXJ2YWxMZW5ndGggPSAxO1xuICAgICAgICAgICAgdGhpcy5zdGF0aWNUYXNrUnVubmVyVGhyZWFkQ291bnQgPSAwO1xuICAgICAgICAgICAgXG4gICAgICAgICAgICB0aGlzLl92YWxpZGF0ZU9wdGlvbnMoKTtcbiAgICAgICAgICAgIHRoaXMuX2luaXRXb3JrZXJQb29sKGdldENhbGxlckZpbGUoKSk7XG5cbiAgICAgICAgICAgIGluc3RhbnRpYXRlZFBvb2xzLnB1c2godGhpcyk7XG4gICAgICAgICAgICB0aGlzLnBvb2xObyA9IGluc3RhbnRpYXRlZFBvb2xzLmxlbmd0aCAtIDE7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIEluaXRpYXRlcyB0aGUgd29ya2VycyBwb29sIGJ5IGNyZWF0aW5nIHRoZSB3b3JrZXIgdGhyZWFkc1xuICAgICAqL1xuICAgIF9pbml0V29ya2VyUG9vbChjYWxsZXJQYXRoOiBzdHJpbmcpe1xuICAgICAgICBsZXQgdGFza1J1bm5lcnNDb3VudCA9IHRoaXMub3B0aW9ucy50YXNrUnVubmVycz90aGlzLm9wdGlvbnMudGFza1J1bm5lcnMubGVuZ3RoOjA7XG4gICAgICAgIGxldCBmaWxlUGF0aCA9IGNhbGxlclBhdGg7XG4gICAgICAgIGxldCB0b3RhbFN0YXRpY1RocmVhZHMgPSAwO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGFza1J1bm5lcnNDb3VudDsgaSsrKXtcbiAgICAgICAgICAgIGxldCBmdW5jdGlvbk5hbWUgPSB0aGlzLm9wdGlvbnMudGFza1J1bm5lcnNbaV0uam9iLm5hbWU7XG4gICAgICAgICAgICBsZXQgbmFtZSA9IHRoaXMub3B0aW9ucy50YXNrUnVubmVyc1tpXS5uYW1lO1xuICAgICAgICAgICAgbGV0IHRocmVhZENvdW50ID0gdGhpcy5vcHRpb25zLnRhc2tSdW5uZXJzW2ldLnRocmVhZENvdW50O1xuICAgICAgICAgICAgbGV0IGxvY2tUb1RocmVhZHMgPSB0aGlzLm9wdGlvbnMubG9ja1Rhc2tSdW5uZXJzVG9UaHJlYWRzO1xuICAgICAgICAgICAgdG90YWxTdGF0aWNUaHJlYWRzICs9IHRocmVhZENvdW50O1xuICAgICAgICAgICAgdGhpcy5fYWRkVGFza1J1bm5lcih7bmFtZSwgdGhyZWFkQ291bnQsIGxvY2tUb1RocmVhZHMsIGZpbGVQYXRoLCBmdW5jdGlvbk5hbWV9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE1ha2UgYWxsIG90aGVycyBkeW5hbWljXG4gICAgICAgIGZvciAobGV0IGsgPSAwOyBrIDwgKHRoaXMub3B0aW9ucy50b3RhbFRocmVhZENvdW50IC0gdG90YWxTdGF0aWNUaHJlYWRzKTsgaysrKSB7XG4gICAgICAgICAgICBsZXQgX3dvcmtlciA9IG5ldyBUYXNrV29ya2VyKGdlbmV0YXRlU2NyaXB0KERZTkFNSUMpLCB7ZXZhbDogdHJ1ZX0pO1xuICAgICAgICAgICAgX3dvcmtlci5idXN5ID0gZmFsc2U7XG4gICAgICAgICAgICBfd29ya2VyLmlkID0gaTtcbiAgICAgICAgICAgIFxuICAgICAgICAgICAgaWYgKCF0aGlzLndvcmtlcnNQb29sLmhhcyhEWU5BTUlDKSkge1xuICAgICAgICAgICAgICAgIHRoaXMud29ya2Vyc1Bvb2wuc2V0KERZTkFNSUMsIG5ldyBBcnJheTxUYXNrV29ya2VyPigpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFxuICAgICAgICAgICAgdGhpcy53b3JrZXJzUG9vbFtEWU5BTUlDXS5wdXNoKF93b3JrZXIpO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBfdmFsaWRhdGVPcHRpb25zKCkge1xuICAgICAgICBsZXQgdGhyZWFkQ291bnRPZlRhc2tSdW5uZXJzID0gMDtcblxuICAgICAgICBpZiAodGhpcy5vcHRpb25zLnRhc2tSdW5uZXJzKSB7XG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMudGFza1J1bm5lcnMubWFwKCh0YXNrUnVubmVyKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKCF0YXNrUnVubmVyLm5hbWUpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRXZlcnkgdGFzayBydW5uZXIgc2hvdWxkIGhhdmUgYSBuYW1lXCIpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmICghdGFza1J1bm5lci50aHJlYWRDb3VudCkge1xuICAgICAgICAgICAgICAgICAgICB0YXNrUnVubmVyLnRocmVhZENvdW50ID0gTWF0aC5mbG9vcih0aGlzLm9wdGlvbnMudG90YWxUaHJlYWRDb3VudC90aGlzLm9wdGlvbnMudGFza1J1bm5lcnMubGVuZ3RoKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKGBUaGUgdGFzayAke3Rhc2tSdW5uZXIubmFtZX0gaGFzIG5vIHRocmVhZCBjb3VudCBzcGVjaWZpZWQ7IFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoZXJlZm9yZSwgJHt0YXNrUnVubmVyLnRocmVhZENvdW50fSBpcyBhc3NpZ25lZCB0byBpdGApXG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdGhyZWFkQ291bnRPZlRhc2tSdW5uZXJzICs9IHRhc2tSdW5uZXIudGhyZWFkQ291bnQ7XG4gICAgICAgICAgICB9KTsgIFxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHRocmVhZENvdW50T2ZUYXNrUnVubmVycyA+IHRoaXMub3B0aW9ucy50aHJlYWRDb3VudCkge1xuICAgICAgICAgICAgY29uc29sZS53YXJuKGBUaGUgdG90YWwgbnVtYmVyIG9mIHRocmVhZHMgcmVxdWVzdGVkIGJ5IHRhc2sgcnVubmVycyAoJHt0aHJlYWRDb3VudE9mVGFza1J1bm5lcnN9KVxuICAgICAgICAgICAgICAgICAgICAgICAgICBleGNlZWRzIHRoZSB0b3RhbCBudW1iZXIgb2YgdGhyZWFkcyBzcGVjaWZpZWQgKCR7dGhpcy5vcHRpb25zLnRocmVhZENvdW50fSkuIFRoZSB0b3RhbCBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgbnVtYmVyIG9mIHRocmVhZHMgaXMgdXBkYXRlZCB0byBtYXRjaCB0aGUgbnVtYmVyIG9mIHRocmVhZHMgXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVlc3RlZCBieSB0YXNrIHJ1bm5lcnNgKTtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy50aHJlYWRDb3VudCA9IHRocmVhZENvdW50T2ZUYXNrUnVubmVycztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0aGlzLm9wdGlvbnMudGhyZWFkQ291bnQgPCAxKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ3RocmVhZENvdW50IGNhbm5vdCBiZSBsZXNzIHRoYW4gMScpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLm9wdGlvbnMudGhyZWFkQ291bnQpIHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy50aHJlYWRDb3VudCA9IENQVV9DT1JFU19OTyAtIDE7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAoIXRoaXMub3B0aW9ucy5sb2NrVGFza1J1bm5lcnNUb1RocmVhZHMpIHtcbiAgICAgICAgICAgIHRoaXMub3B0aW9ucy5sb2NrVGFza1J1bm5lcnNUb1RocmVhZHMgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF0aGlzLm9wdGlvbnMuYWxsb3dEeW5hbWljVGFza1J1bm5lckFkZGl0aW9uKSB7XG4gICAgICAgICAgICB0aGlzLm9wdGlvbnMuYWxsb3dEeW5hbWljVGFza1J1bm5lckFkZGl0aW9uID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9hZGRUYXNrUnVubmVyKHtuYW1lLCB0aHJlYWRDb3VudCwgbG9ja1RvVGhyZWFkcywgZmlsZVBhdGgsIGZ1bmN0aW9uTmFtZX0pIHtcbiAgICAgICAgaWYgKGxvY2tUb1RocmVhZHMpIHtcbiAgICAgICAgICAgIGlmICghdGhyZWFkQ291bnQgfHwgdGhyZWFkQ291bnQgPiB0aGlzLm9wdGlvbnMudG90YWxUaHJlYWRDb3VudCAtIHRoaXMuc3RhdGljVGFza1J1bm5lclRocmVhZENvdW50KSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuZHluYW1pY1Rhc2tSdW5uZXJMaXN0Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgdGhyZWFkQ291bnQgPSB0aGlzLm9wdGlvbnMudG90YWxUaHJlYWRDb3VudCAtIHRoaXMuc3RhdGljVGFza1J1bm5lclRocmVhZENvdW50IC0gMTtcbiAgICBcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRocmVhZENvdW50ID09PSAwKVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaGVyZSBhcmUgbm8gZW5vdWdoIGZyZWUgdGhyZWFkcycpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHRocmVhZENvdW50ID0gdGhpcy5vcHRpb25zLnRvdGFsVGhyZWFkQ291bnQgLSB0aGlzLnN0YXRpY1Rhc2tSdW5uZXJUaHJlYWRDb3VudDtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aGlzLnN0YXRpY1Rhc2tSdW5uZXJUaHJlYWRDb3VudCArPSB0aHJlYWRDb3VudDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gQ3JlYXRlIHRoZSBuZXcgd29ya2VyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRocmVhZENvdW50OyBpKyspIHtcbiAgICAgICAgICAgICAgICBsZXQgcGF0aEFyciA9IHBhdGgubm9ybWFsaXplKGZpbGVQYXRoKS5zcGxpdChwYXRoLnNlcCk7XG4gICAgICAgICAgICAgICAgZmlsZVBhdGggPSAnJztcbiAgICAgICAgICAgICAgICBwYXRoQXJyLm1hcCgoc2VnOiBzdHJpbmcsIGk6IG51bWJlcikgPT4ge1xuICAgICAgICAgICAgICAgICAgICBmaWxlUGF0aCArPSBzZWc7XG5cbiAgICAgICAgICAgICAgICAgICAgaWYgKGkgIT0gcGF0aEFyci5sZW5ndGggLSAxKVxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZVBhdGggKz0gJ1xcXFxcXFxcJztcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgICAgICBsZXQgX3dvcmtlciA9IG5ldyBUYXNrV29ya2VyKGdlbmV0YXRlU2NyaXB0KFNUQVRJQywgZmlsZVBhdGgsIGZ1bmN0aW9uTmFtZSksIHtldmFsOiB0cnVlfSk7XG4gICAgICAgICAgICAgICAgX3dvcmtlci5idXN5ID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgX3dvcmtlci5pZCA9IGk7XG5cbiAgICAgICAgICAgICAgICBpZiAoIXRoaXMud29ya2Vyc1Bvb2wuaGFzKG5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMud29ya2Vyc1Bvb2wuc2V0KG5hbWUsIG5ldyBBcnJheTxUYXNrV29ya2VyPigpKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB0aGlzLndvcmtlcnNQb29sW25hbWVdLnB1c2goX3dvcmtlcik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpZiAodGhpcy5zdGF0aWNUYXNrUnVubmVyVGhyZWFkQ291bnQgPT09IHRoaXMub3B0aW9ucy50b3RhbFRocmVhZENvdW50KSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaGVyZSBhcmUgbm8gZW5vdWdoIGZyZWUgdGhyZWFkcycpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmR5bmFtaWNUYXNrUnVubmVyTGlzdC5wdXNoKHtuYW1lLCBmdW5jdGlvbk5hbWUsIGZpbGVQYXRofSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGRUYXNrUnVubmVyKHRhc2tSdW5uZXI6IFRhc2tSdW5uZXIpIHtcbiAgICAgICAgbGV0IHtuYW1lLCBqb2IsIHRocmVhZENvdW50LCBsb2NrVG9UaHJlYWRzfSA9IHRhc2tSdW5uZXI7XG4gICAgICAgIGxldCBmaWxlUGF0aCA9IGdldENhbGxlckZpbGUoKTtcbiAgICAgICAgbGV0IGZ1bmN0aW9uTmFtZSA9IGpvYi5uYW1lO1xuXG4gICAgICAgIHRoaXMuX2FkZFRhc2tSdW5uZXIoe25hbWUsIHRocmVhZENvdW50LCBsb2NrVG9UaHJlYWRzLCBmaWxlUGF0aCwgZnVuY3Rpb25OYW1lfSk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogR2VuZXJhdGVzIGFuIGFzeW5jaHJvbm91cyBwcm9taXNlIGJhc2VkIGZ1bmN0aW9uIG91dCBvZiBhIHN5bmNocm9ub3VzIG9uZVxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB0YXNrUnVubmVyTmFtZVxuICAgICAqL1xuICAgIGdldEFzeW5jRnVuYyh0YXNrUnVubmVyTmFtZTogc3RyaW5nKXtcbiAgICAgICAgaWYgKGlzTWFpblRocmVhZCl7XG4gICAgICAgICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICAgICAgICBcbiAgICAgICAgICAgIGlmICghdGhpcy53b3JrZXJzUG9vbC5nZXQodGFza1J1bm5lck5hbWUpICYmICF0aGlzLndvcmtlcnNQb29sLmdldChEWU5BTUlDKSlcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVGhlcmUgaXMgbm8gdGFzayBydW5uZXIgd2l0aCB0aGUgbmFtZSAke3Rhc2tSdW5uZXJOYW1lfWApXG4gICAgICAgICAgICBcbiAgICAgICAgICAgIHJldHVybiBhc3luYyBmdW5jdGlvbiAoLi4ucGFyYW1zKSB7XG4gICAgICAgICAgICAgICAgY291bnRlcisrO1xuICAgICAgICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGxldCByZXNvbHZlQ2FsbGJhY2sgPSAocmVzdWx0KSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICAgICAgbGV0IHJlamVjdENhbGxiYWNrID0gKGVycm9yKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAgICAgICAgIGxldCB0YXNrID0gbmV3IFRhc2sodGFza1J1bm5lck5hbWUsIHBhcmFtcywgcmVzb2x2ZUNhbGxiYWNrLCByZWplY3RDYWxsYmFjayk7XG4gICAgICAgICAgICAgICAgICAgIHNlbGYuZW5xdWV1ZVRhc2soIHRhc2sgKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIEVucXVldWVzIGEgdGFzayB0byBiZSBwcm9jZXNzZWQgd2hlbiBhbiBpZGxlIHdvcmtlciB0aHJlYWQgaXMgYXZhaWxhYmxlXG4gICAgICogQHBhcmFtIHtUYXNrfSB0YXNrIFRoZSB0YXNrIHRvIGJlIHJ1biBcbiAgICAgKi9cbiAgICBhc3luYyBlbnF1ZXVlVGFzayh0YXNrOiBUYXNrKXtcbiAgICAgICAgdGhpcy50YXNrUXVldWUucHVzaCh0YXNrKTtcblxuICAgICAgICBpZiAoIXRoaXMucHJvY2Vzc2luZ0ludGVydmFsKSB7XG4gICAgICAgICAgICB0aGlzLl9zdGFydFRhc2tQcm9jZXNzaW5nKCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqIENoZWNrcyBpZiB0aGVyZSBhcmUgYW55IHBlbmRpbmcgdGFza3MgYW5kIGlmIHRoZXJlIGFyZSBhbnkgaWRsZVxuICAgICAqIHdvcmtlcnMgdG8gcHJvY2VzcyB0aGVtLCBwcmVwYXJlcyB0aGVtIGZvciBwcm9jZXNzaW5nLCBhbmQgcHJvY2Vzc2VzXG4gICAgICogdGhlbS5cbiAgICAgKi9cbiAgICBhc3luYyBfc3RhcnRUYXNrUHJvY2Vzc2luZygpe1xuICAgICAgICB2YXIgd29ya2VyOiBUYXNrV29ya2VyO1xuICAgICAgICBpZiAodGhpcy5wcm9jZXNzaW5nSW50ZXJ2YWwgIT0gbnVsbCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMucHJvY2Vzc2luZ0ludGVydmFsID0gc2V0SW50ZXJ2YWwoYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgXG4gICAgICAgICAgICBpZiAodGhpcy50YXNrUXVldWUubGVuZ3RoIDwgMSkge1xuICAgICAgICAgICAgICAgIHRoaXMuc3RvcFByb2Nlc3NpbmcoKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZm9yIChsZXQgdGFzayBvZiB0aGlzLnRhc2tRdWV1ZSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy5idXN5V29ya2Vyc0NvdW50ICE9PSB0aGlzLm9wdGlvbnMudG90YWxUaHJlYWRDb3VudCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmVtb3ZlIGEgZnJlZSB3b3JrZXIgZnJvbSB0aGUgYmVnaW5pbmdzIG9mIHRoZSBhcnJheVxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKCF0aGlzLndvcmtlcnNQb29sLmdldCh0YXNrLnRhc2tSdW5uZXJOYW1lKSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxldCB0YXNrUnVubmVySW5mbyA9IHRoaXMuZHluYW1pY1Rhc2tSdW5uZXJMaXN0LmZpbmQoZHluYW1pY1Rhc2tSdW5uZXIgPT4gZHluYW1pY1Rhc2tSdW5uZXIubmFtZSA9PT0gdGFzay50YXNrUnVubmVyTmFtZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGV0IGZpbGVQYXRoID0gdGFza1J1bm5lckluZm8uZmlsZVBhdGg7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbGV0IGZ1bmN0aW9uTmFtZSA9IHRhc2tSdW5uZXJJbmZvLmZ1bmN0aW9uTmFtZTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhc2sudGFza1J1bm5lck5hbWUgPSBEWU5BTUlDO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRhc2suZmlsZVBhdGggPSBmaWxlUGF0aDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0YXNrLmZ1bmN0aW9uTmFtZSA9IGZ1bmN0aW9uTmFtZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICAgICAgd29ya2VyID0gdGhpcy53b3JrZXJzUG9vbC5nZXQodGFzay50YXNrUnVubmVyTmFtZSkuc2hpZnQoKTtcblxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHdvcmtlcikge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmICghdGhpcy5idXN5V29ya2Vycy5oYXModGFzay50YXNrUnVubmVyTmFtZSkpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYnVzeVdvcmtlcnMuc2V0KHRhc2sudGFza1J1bm5lck5hbWUsIG5ldyBBcnJheTxUYXNrV29ya2VyPigpKTtcbiAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJ1c3lXb3JrZXJzLmdldCh0YXNrLnRhc2tSdW5uZXJOYW1lKS5wdXNoKHdvcmtlcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGFzayA9IHRoaXMudGFza1F1ZXVlLnNoaWZ0KCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5hY3RpdmVUYXNrcy5wdXNoKHRhc2spO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMucHJvY2Vzc2VkLnNldCh0YXNrLmtleSwgZmFsc2UpO1xuICAgICAgICBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmJ1c3lXb3JrZXJzQ291bnQgKys7XG4gICAgXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgd29ya2VyLnByb2Nlc3NUYXNrKHRhc2spLnRoZW4oKGFuc3dlcikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbnN3ZXIudGFzay5yZXNvbHZlQ2FsbGJhY2soYW5zd2VyLnJlc3VsdCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlV29ya2Vyc1F1ZXVlKGFuc3dlcik7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSkuY2F0Y2goKGFuc3dlcikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBhbnN3ZXIudGFzay5yZWplY3RDYWxsYmFjayhhbnN3ZXIuZXJyb3IpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZVdvcmtlcnNRdWV1ZShhbnN3ZXIpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIHRoaXMuaW50ZXJ2YWxMZW5ndGgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFxuICAgICAqL1xuICAgIHN0b3BQcm9jZXNzaW5nKCl7XG4gICAgICAgIGlmICh0aGlzLnByb2Nlc3NpbmdJbnRlcnZhbCl7XG4gICAgICAgICAgICBjbGVhckludGVydmFsKHRoaXMucHJvY2Vzc2luZ0ludGVydmFsKTtcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc2luZ0ludGVydmFsID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFxuICAgICAqIEBwYXJhbSB7Kn0gYW5zd2VyIFxuICAgICAqL1xuICAgIGFzeW5jIHVwZGF0ZVdvcmtlcnNRdWV1ZSAoYW5zd2VyKSB7XG4gICAgICAgIHRoaXMuYnVzeVdvcmtlcnNDb3VudC0tO1xuICAgICAgICB0aGlzLndvcmtlcnNQb29sLmdldChhbnN3ZXIudGFzay50YXNrUnVubmVyTmFtZSkudW5zaGlmdChhbnN3ZXIud29ya2VyKTtcbiAgICAgICAgdGhpcy5idXN5V29ya2Vycy5zZXQoYW5zd2VyLnRhc2sudGFza1J1bm5lck5hbWUsIHRoaXMuYnVzeVdvcmtlcnNbYW5zd2VyLnRhc2sudGFza1J1bm5lck5hbWVdXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuZmlsdGVyKGJ1c3lXb3JrZXIgPT4gYnVzeVdvcmtlci5pZCAhPT0gYW5zd2VyLndvcmtlci5pZCkpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIFRlcm1pbmF0ZXMgYWxsIHRoZSB0YXNrcy4gSWYgZm9yY2VkIGlzIHRydWUgaXQgd2lsbCBub3Qgd2FpdCBmb3IgdGhlXG4gICAgICogYWN0aXZlIHRhc2tzIHRvIGZpbmlzaC5cbiAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IGZvcmNlZCBUbyB0ZXJtaW5hdGUgaW1tZWRpYXRlbHlcbiAgICAgKi9cbiAgICB0ZXJtaW5hdGUoZm9yY2VkKXtcbiAgICAgICAgLy8gLy8gdHFfbXV0ZXguYWNxdWlyZSgpLnRoZW4oKHRxX3JlbGVhc2UpID0+IHtcbiAgICAgICAgLy8gICAgIHRoaXMudGFza1F1ZXVlID0gW107XG4gICAgICAgIC8vICAgICAvLyB0cV9yZWxlYXNlKCk7XG5cbiAgICAgICAgLy8gICAgIC8vIHdwX211dGV4LmFjcXVpcmUoKS50aGVuKCh3cF9yZWxlYXNlKSA9PiB7XG4gICAgICAgIC8vICAgICAgICAgdGhpcy53b3JrZXJzUG9vbC5tYXAod29ya2VyID0+IHtcbiAgICAgICAgLy8gICAgICAgICAgICAgd29ya2VyLnRlcm1pbmF0ZSgpO1xuICAgICAgICAvLyAgICAgICAgIH0pO1xuICAgICAgICAvLyAgICAgICAgIHRoaXMud29ya2Vyc1Bvb2wgPSBbXTtcbiAgICAgICAgLy8gICAgICAgICAvLyB3cF9yZWxlYXNlKCk7XG5cbiAgICAgICAgLy8gICAgICAgICBpZiAoZm9yY2VkKXtcbiAgICAgICAgLy8gICAgICAgICAgICAgLy8gYndfbXV0ZXguYWNxdWlyZSgpLnRoZW4oKGJ3X3JlbGVhc2UpID0+IHtcbiAgICAgICAgLy8gICAgICAgICAgICAgICAgIHRoaXMuYnVzeVdvcmtlcnMubWFwKHdvcmtlciA9PiB7XG4gICAgICAgIC8vICAgICAgICAgICAgICAgICAgICAgd29ya2VyLnRlcm1pbmF0ZSgpO1xuICAgICAgICAvLyAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgIC8vICAgICAgICAgICAgICAgICB0aGlzLmJ1c3lXb3JrZXJzID0ge307XG4gICAgICAgIC8vICAgICAgICAgICAgICAgICAvLyBid19yZWxlYXNlKCk7XG4gICAgICAgIC8vICAgICAgICAgICAgIC8vIH0pO1xuICAgICAgICAvLyAgICAgICAgIH1cbiAgICAgICAgLy8gICAgIC8vIH0pO1xuICAgICAgICAvLyAvLyB9KTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBUaGUgY3VycmVudCBzdGF0dXMgb2YgdGhlIHBvb2xcbiAgICAgKiBAcGFyYW0ge2Jvb2xlYW59IGRldGFpbGVkIElmIHRydWUgdGhlIGluZm9ybWF0aW9uIHdpbGwgYmUgZGV0YWlsZWRcbiAgICAgKi9cbiAgICBzdGF0aWMgc3RhdHVzKGRldGFpbGVkKXtcbiAgICAgICAgLy8gY29uc29sZS5sb2coJ051bWJlciBvZiBwb29sczogJywgaW5zdGFudGlhdGVkUG9vbHMubGVuZ3RoKTtcblxuICAgICAgICAvLyBpbnN0YW50aWF0ZWRQb29scy5tYXAoIHBvb2wgPT4ge1xuICAgICAgICAvLyAgICAgY29uc29sZS5sb2coYC0tLS0tLS0tLS0gUE9PTCAke3Bvb2wucG9vbE5vfSAtLS0tLS0tLS0tYClcbiAgICAgICAgLy8gICAgIGNvbnNvbGUubG9nKCdOdW1iZXIgb2YgaWRsZSB3b3JrZXJzOiAnLCBwb29sLndvcmtlcnNQb29sLmxlbmd0aCk7XG4gICAgICAgIC8vICAgICBjb25zb2xlLmxvZygnTnVtYmVyIG9mIGJ1c3kgd29ya2VyczogJywgcG9vbC53b3JrZXJzTm8gLSBwb29sLndvcmtlcnNQb29sLmxlbmd0aCk7XG4gICAgICAgIC8vICAgICBjb25zb2xlLmxvZygnTnVtYmVyIG9mIGFjdGl2ZSB0YXNrczogJywgcG9vbC5hY3RpdmVUYXNrcy5sZW5ndGgpO1xuICAgICAgICAvLyAgICAgY29uc29sZS5sb2coJ051bWJlciBvZiBXYWl0aW5nIHRhc2tzOiAnLCBwb29sLnRhc2tRdWV1ZS5sZW5ndGgpOyBcbiAgICAgICAgICAgIFxuICAgICAgICAvLyAgICAgaWYgKGRldGFpbGVkKSB7XG4gICAgICAgIC8vICAgICAgICAgY29uc29sZS5sb2coJ1xcbkFjdGl2ZSB0YXNrczogXFxuJyk7XG4gICAgICAgIC8vICAgICAgICAgcG9vbC5hY3RpdmVUYXNrcy5tYXAoKHRhc2ssIGkpID0+IHtcbiAgICAgICAgLy8gICAgICAgICAgICAgY29uc29sZS5sb2coaSwnIDogJywgSlNPTi5zdHJpbmdpZnkodGFzayksICdcXG4nKTtcbiAgICAgICAgLy8gICAgICAgICB9KTtcbiAgICAgICAgXG4gICAgICAgIC8vICAgICAgICAgY29uc29sZS5sb2coJ1dhaXRpbmcgdGFza3M6IFxcbicpO1xuICAgICAgICAvLyAgICAgICAgIHBvb2wudGFza1F1ZXVlLm1hcCgodGFzaywgaSkgPT4ge1xuICAgICAgICAvLyAgICAgICAgICAgICBjb25zb2xlLmxvZyhpLCcgOiAnLCBKU09OLnN0cmluZ2lmeSh0YXNrKSwgJ1xcbicpO1xuICAgICAgICAvLyAgICAgICAgIH0pO1xuICAgICAgICAvLyAgICAgfVxuICAgICAgICAvLyB9KTtcbiAgICB9XG59Il19
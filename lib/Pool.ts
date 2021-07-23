import os from 'os';
import path from 'path';
import getCallerFile from 'get-caller-file';
import { isMainThread } from 'worker_threads';

import { Task } from "./task";
import { TaskWorker } from "./TaskWorker";
import { genetateScript } from './ScriptGenerator';

const DYNAMIC = 'dynamic';
const STATIC = 'static';
const CPU_CORES_NO = os.cpus().length;
var instantiatedPools = [];
let counter = 0;

interface TaskRunner {
    name: string;
    job?: Function;
    functionName?: string;
    filePath?: string; 
    threadCount?: number;
    lockToThreads?: boolean;
}

interface WorkersPoolOptions {
    taskRunners?: Array<TaskRunner>; // An array of all the taskRunners for the pool
    totalThreadCount?: number; // The total number of threads wanted
    lockTaskRunnersToThreads?: boolean; // Whether or not to have dedicated threads for the taskRunners
    allowDynamicTaskRunnerAddition?: boolean; // Whether or not to allow adding more task runners
    threadCount: number;
}

export class Pool{
    workersPool: Map<string, Array<TaskWorker>>;
    busyWorkers: Map<string, Array<TaskWorker>>;
    taskQueue: Array<Task>;
    activeTasks: Array<Task>;
    processed: Map<number, boolean>;
    dynamicTaskRunnerList: Array<TaskRunner>
    busyWorkersCount: number;
    options: WorkersPoolOptions;
    processingInterval: NodeJS.Timeout;
    intervalLength: number;
    staticTaskRunnerThreadCount: number;
    poolNo: number;

    /**
     * The constructor of Pool class
     * @param {number} n The number of threads (default is the number of cpu cores - 1)
     * @param {WorkersPoolOptions} options The optional options used in creating workers
     */
    constructor(options: WorkersPoolOptions){
        if (isMainThread) {
            this.workersPool = new Map(); // contains the idle workers
            this.busyWorkers = new Map(); // contains the busy workers (processing code)
            this.taskQueue   = new Array(); // contains the tasks to be processed
            this.activeTasks = new Array(); // contains the tasks being processed
            this.processed = new Map();   // {taskKey:boolean} whether a task has been processed yet
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
    private initWorkerPool(callerPath: string){
        let taskRunnersCount = this.options.taskRunners?this.options.taskRunners.length:0;
        let filePath = callerPath;
        let totalStaticThreads = 0;

        for (var i = 0; i < taskRunnersCount; i++){
            let functionName = this.options.taskRunners[i].job.name;
            let name = this.options.taskRunners[i].name;
            let threadCount = this.options.taskRunners[i].threadCount;
            let lockToThreads = this.options.lockTaskRunnersToThreads;
            totalStaticThreads += threadCount;
            this._addTaskRunner({name, threadCount, lockToThreads, filePath, functionName});
        }

        // Make all others dynamic
        for (let k = 0; k < (this.options.totalThreadCount - totalStaticThreads); k++) {
            let _worker = new TaskWorker(genetateScript(DYNAMIC), {eval: true});
            _worker.busy = false;
            _worker.id = i;
            
            if (!this.workersPool.has(DYNAMIC)) {
                this.workersPool.set(DYNAMIC, new Array<TaskWorker>());
            }
            
            this.workersPool.get(DYNAMIC).push(_worker);
        }
    }

    /**
     */
    private validateOptions() {
        let threadCountOfTaskRunners = 0;

        if (this.options.taskRunners) {
            this.options.taskRunners.map((taskRunner) => {
                if (!taskRunner.name) {
                    throw new Error("Every task runner should have a name");
                }

                if (!taskRunner.threadCount) {
                    taskRunner.threadCount = Math.floor(this.options.totalThreadCount/this.options.taskRunners.length);
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

        if (!this.options.allowDynamicTaskRunnerAddition) {
            this.options.allowDynamicTaskRunnerAddition = true;
        }
    }

    /**
     * 
     * @param param0 
     */
    private _addTaskRunner({name, threadCount, lockToThreads, filePath, functionName}) {
        if (lockToThreads) {
            if (!threadCount || threadCount > this.options.totalThreadCount - this.staticTaskRunnerThreadCount) {
                if (this.dynamicTaskRunnerList.length > 0) {
                    threadCount = this.options.totalThreadCount - this.staticTaskRunnerThreadCount - 1;
    
                    if (threadCount === 0)
                        throw new Error('There are no enough free threads');
                } else {
                    threadCount = this.options.totalThreadCount - this.staticTaskRunnerThreadCount;
                }

                this.staticTaskRunnerThreadCount += threadCount;
            }

            // Create the new worker
            for (let i = 0; i < threadCount; i++) {
                if (path.sep === '\\') {
                    let pathArr = path.normalize(filePath).split(path.sep);
                    filePath = '';
                    pathArr.map((seg: string, i: number) => {
                        filePath += seg;

                        if (i != pathArr.length - 1)
                            filePath += '\\\\';
                    });
                }
                
                let _worker = new TaskWorker(genetateScript(STATIC, filePath, functionName), {eval: true});
                _worker.busy = false;
                _worker.id = i;

                if (!this.workersPool.has(name)) {
                    this.workersPool.set(name, new Array<TaskWorker>());
                }

                this.workersPool.get(name).push(_worker);
            }
        } else {
            if (this.staticTaskRunnerThreadCount === this.options.totalThreadCount) {
                throw new Error('There are no enough free threads');
            }

            this.dynamicTaskRunnerList.push({name, functionName, filePath});
        }
    }

    /**
     * 
     * @param taskRunner 
     */
    public addTaskRunner(taskRunner: TaskRunner) {
        let {name, job, threadCount, lockToThreads} = taskRunner;
        let filePath = getCallerFile();
        let functionName = job.name;

        this._addTaskRunner({name, threadCount, lockToThreads, filePath, functionName});
    }

    /**
     * Generates an asynchronous promise based function out of a synchronous one
     * @param {string} taskRunnerName
     */
    public getAsyncFunc(taskRunnerName: string){
        if (isMainThread){
            var self = this;
            
            if (!this.workersPool.get(taskRunnerName) && !this.workersPool.get(DYNAMIC))
            throw new Error(`There is no task runner with the name ${taskRunnerName}`)
            
            return async function (...params) {
                counter++;
                return new Promise((resolve, reject) => {
                    let resolveCallback = (result) => {
                        resolve(result);
                    };

                    let rejectCallback = (error) => {
                        reject(error);
                    };

                    let task = new Task(taskRunnerName, params, resolveCallback, rejectCallback);
                    self.enqueueTask( task );
                });
            }
        }
    }

    /**
     * Enqueues a task to be processed when an idle worker thread is available
     * @param {Task} task The task to be run 
     */
    private async enqueueTask(task: Task){
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
    private async startTaskProcessing(){
        var worker: TaskWorker;
        if (this.processingInterval != null) {
            return;
        }
        this.processingInterval = setInterval(async () => {
            
            if (this.taskQueue.length < 1) {
                this.stopProcessing();
            } else {
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
                                this.busyWorkers.set(task.taskRunnerName, new Array<TaskWorker>());
    
                            this.busyWorkers.get(task.taskRunnerName).push(worker);
                            task = this.taskQueue.shift();
                            this.activeTasks.push(task);
                            
                            this.processed.set(task.key, false);
        
                            this.busyWorkersCount ++;
    
                            worker.processTask(task).then((answer) => {
                                answer.task.resolveCallback(answer.result);
                                this.updateWorkersQueue(answer);
                            }).catch((answer) => {
                                answer.task.rejectCallback(answer.error);
                                this.updateWorkersQueue(answer);
                            });
                        }
                    } else {
                        break;
                    }
                }
            }
        }, this.intervalLength);
    }

    /**
     * 
     */
    private stopProcessing () {
        if (this.processingInterval){
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
    }

    /**
     * 
     * @param {*} answer 
     */
    private async updateWorkersQueue (answer) {
        this.busyWorkersCount--;
        this.activeTasks = this.activeTasks.filter( task => task.key !== answer.task.key);
        this.workersPool.get(answer.task.taskRunnerName).unshift(answer.worker);
        this.busyWorkers.set(answer.task.taskRunnerName, this.busyWorkers.get(answer.task.taskRunnerName)
                                                            .filter(busyWorker => busyWorker.id !== answer.worker.id));
    }

    /**
     * Terminates all the tasks. If forced is true it will not wait for the
     * active tasks to finish.
     * @param {boolean} forced To terminate immediately
     */
    public terminate(forced: boolean){
        this.taskQueue = [];

        this.stopProcessing();

        Array.from(this.workersPool.values()).map(workerArr => {
            workerArr.map(worker => {
                worker.terminate();
            });
        });

        this.workersPool = new Map<string, Array<TaskWorker>>();

        if (forced){
            Array.from(this.busyWorkers.values()).map(workerArr => {
                workerArr.map(worker => {
                    worker.terminate();
                });
            });

            this.busyWorkers = new Map<string, Array<TaskWorker>>();
        }
    }

    /**
     * The current statistics of the pool
     * @param {boolean} detailed If true the information will be detailed
     */
    static stats(detailed: boolean = false){
        console.log('-------------------')
        console.log('\nNumber of pools: ', instantiatedPools.length);

        instantiatedPools.map( (pool: Pool) => {
            let idleWorkers: Array<Array<TaskWorker>> = new Array<Array<TaskWorker>>();
            let busyWorkers: Array<Array<TaskWorker>> = new Array<Array<TaskWorker>>();
            let idleWorkersCount: number = 0;
            let busyWorkersCount: number = 0;
            let activeTasksCount: number = 0; 
            let waitingTasksCount: number = 0;
            
            idleWorkers = Array.from(pool.workersPool.values());
            busyWorkers = Array.from(pool.busyWorkers.values());

            idleWorkers.map((workersList: Array<TaskWorker>) => {
                idleWorkersCount += workersList.length;
            });
            
            busyWorkers.map((workersList: Array<TaskWorker>) => {
                busyWorkersCount += workersList.length;
            });
            
            activeTasksCount = pool.activeTasks.length;
            waitingTasksCount = pool.taskQueue.length;

            console.log(`---------- POOL ${pool.poolNo} ----------`)
            console.log('Number of idle workers: ', idleWorkersCount);
            console.log('Number of busy workers: ', busyWorkersCount);
            console.log('Number of active tasks: ', activeTasksCount);
            console.log('Number of Waiting tasks: ', waitingTasksCount); 
            
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
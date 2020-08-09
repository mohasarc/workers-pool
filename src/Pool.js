const TaskHandler = require('./TaskHandler');
const {Worker} = require('worker_threads');
const path = require('path');
const {MESSAGE_CHANNEL} = require('./constants');

module.exports = class Pool{
    constructor(n){
        this.workersPool = []; // contains the workers
        this.taskQueue   = []; // contains the tasks to be processed
        this.activeTasks = []; // contains the tasks being processed
        this.processed = {};
        this.counter = 0;

        this.initWorkerPool(n);
    }

    initWorkerPool(n){
        // Create n number of workers and set them to be not busy
        for (var i = 0; i < n; i++){
            var _worker = new Worker(path.join(__dirname, 'worker.js'))
            _worker.busy = false;
            this.workersPool.push(_worker);
        }
    }

    getTaskHandler(filePath, functionName){
        return new TaskHandler(filePath, functionName, this);
    }

    enqueueTask(filePath, functionName, params, callBack){
        var task = {filePath : filePath, 
                    functionName : functionName, 
                    params : params, 
                    callBack : callBack, 
                    key : this.counter++ };
        this.taskQueue.push(task);
        this.processTasks();
    }

    processTasks(){
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

            worker.on(MESSAGE_CHANNEL, function (returnMessage) {
                if (!this.processed[returnMessage.key]){
                    this.processed[returnMessage.key] = true;
                    

                    // get the callBack
                    var callBack;
                    this.activeTasks.map( function (task, i) {
                        if (task.key == returnMessage.key){
                            callBack = task.callBack;
                            this.activeTasks.splice(i, 1);
                        }
                    }.bind(this));

                    // call the callback
                    callBack(returnMessage.result);
                
                    // mark the worker as not busy and add it back to the pool
                    worker.busy = false;
                    this.workersPool.unshift(worker);
    
                    // a worker is freed, check if there is any task to be processed
                    this.processTasks();
                }
            }.bind(this));
        }
    }
}
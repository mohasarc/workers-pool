const TaskHandler = require('./TaskHandler');
const {Worker} = require('worker_threads');
const path = require('path');

module.exports = class Pool{
    constructor(n){
        this.workersPool = []; // contains the workers
        this.taskQueue = []; // contains the tasks to be processed
        this.processed = {};
        this.tasksWaitingList = [];
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

    enqueueTask(taskHandler){
        console.log('enqueueing the task');
        this.taskQueue.push({taskHandler : taskHandler, key : this.counter++ });
        this.processTasks();
    }

    processTasks(){
        console.log('processing the task');

        while (this.taskQueue.length > 0 && this.workersPool.length > 0){
            // remove a free worker from the beginings of the array
            var worker = this.workersPool.shift();
            worker.busy = true;

            // remove the first item in the tasks queue
            var task = this.taskQueue.shift();
            this.tasksWaitingList.push(task);

            // set its key as not processed
            this.processed[task.key] = false;

            // Build the message object
            var message = {
                filePath : task.taskHandler.filePath,
                functionName : task.taskHandler.functionName,
                params : task.taskHandler.params,
                key : task.key,
            }

            // send the task to the worker to be processed
            worker.postMessage(message);

            worker.on('message', function (returnMessage) {
                if (!this.processed[returnMessage.key]){
                    this.processed[returnMessage.key] = true;
                    

                    // get the callBack
                    var callBack;
                    this.tasksWaitingList.map( task => {
                        if (task.key == returnMessage.key)
                            callBack = task.taskHandler.callBack;
                    });

                    // call the callback
                    console.log('the callback', callBack);
                    callBack(returnMessage.result);
                
                    // mark the worker as not busy and add it back to the pool
                    worker.busy = false;
    
                    console.log('worker has not been added to list yet [ ');
                    this.workersPool.map( work => {
                        console.log(work.busy + ' , ');
                    });
                    console.log(' ] ');
                    this.workersPool.unshift(worker);
                    console.log('worker made not busy', worker.busy);
                    console.log('worker has been added to list [ ');
                    this.workersPool.map( work => {
                        console.log(work.busy + ' , ');
                    });
                    console.log(' ] ');
    
                    // a worker is freed, check if there is any task to be processed
                    this.processTasks();
                }
            }.bind(this));
        }
    }
}
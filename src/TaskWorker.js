const {Worker} = require('worker_threads');

module.exports = class TaskWorker extends Worker{
    constructor(fileName, options){
        super(fileName, options);
        this.busy = false;
        this.task;
        this.rejectCallback;
        this.resolveCallback;
        this.initListeners();
    }

    isBusy(){
        return this.busy;
    }

    initListeners() {
        super.on("error", (error) => { // TODO rejectCallback can be undefined
            this.rejectCallback({task: this.task, worker: this, error});
            this.clenUp();
        });

        super.on("messageerror", (error) => {
            this.rejectCallback({task: this.task, worker: this, error});
            this.clenUp();
        });

        super.on("online", () => {
            // console.log("TaskWorker is online");
        });

        super.on("message", (response) => {
            if (response.type == 'success')
                this.resolveCallback({task: this.task, worker: this, result: response.value});
            else if (response.type == 'error')
                this.rejectCallback({task: this.task, worker: this, result: response.value});

            this.clenUp();
        });
    }

    async processTask(task){
        // Build the message object
        this.busy = true;
        this.task = task;
        var message = {
            filePath : task.filePath,
            functionName : task.functionName,
            params : task.params,
            id: task.id
        }

        let promise = new Promise((resolve, reject) => {
            this.resolveCallback = resolve;
            this.rejectCallback = reject;
            super.postMessage(message);
        });

        return promise;
    }

    clenUp() {
        this.task = null;
        this.rejectCallback = null;
        this.resolveCallback = null;
        this.busy = false;
    }
}
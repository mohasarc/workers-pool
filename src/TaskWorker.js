const {Worker} = require('worker_threads');

module.exports = class TaskWorker extends Worker{
    constructor(fileName, options){
        super(fileName, options);
        this.busy = false;
    }

    setBusy(busy){
        this.busy = busy;
    }

    isBusy(){
        return this.busy;
    }

    async processTask(task){
        // Build the message object
        var message = {
            filePath : task.filePath,
            functionName : task.functionName,
            params : task.params,
        }

        super.postMessage(message);

        return new Promise((resolve, reject) => {
            super.on("error", (error) => {
                reject({task, worker: this, error});
            });

            super.on("exit", (exitCode) => {
                reject({task, worker: this, error: new Error("TaskWorker exited with code: ", exitCode)});
            });

            super.on("messageerror", (error) => {
                reject({task, worker: this, error});
            });

            super.on("online", () => {
                // console.log("TaskWorker is online");
            });

            super.on("message", (response) => {
                if (response.type == 'success')
                    resolve({task, worker: this, result: response.value});
                else if (response.type == 'error')
                    reject({task, worker: this, result: response.value});
            });
        });
    }
}
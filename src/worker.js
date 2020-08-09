const {parentPort} = require('worker_threads');

parentPort.on('message', (args) => {
    var result = require(args.filePath)[args.functionName](...args.params);

    returnMessage = {
        result : result,
        key : args.key,
    }
    parentPort.postMessage(returnMessage);
});
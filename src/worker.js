const {parentPort} = require('worker_threads');
const {MESSAGE_CHANNEL} = require('./constants');

parentPort.on(MESSAGE_CHANNEL, (args) => {
    // Call the function for this specific task
    var result = require(args.filePath)[args.functionName](...args.params);

    // Prepare the return object
    returnMessage = {
        result : result,
        key : args.key,
    }

    // Send the results back
    parentPort.postMessage(returnMessage);
});
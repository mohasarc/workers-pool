const {parentPort} = require('worker_threads');
const {MESSAGE_CHANNEL} = require('./constants');

parentPort.on(MESSAGE_CHANNEL, async (args) => {
    // Require and call the function for this specific task
    var result = require(args.filePath)[args.functionName](...args.params);

    // If the result is a Promise resolve it
    if ( Promise.resolve(result) == result) {
        try{
            result = await result;
        } catch(error){
            result = error;
        }
    }

    // Send the results back
    parentPort.postMessage(result);
});

module.exports.genetateScript = function genetateScript(type, filePath, functionName) {
    if (type === 'dynamic') {
        return ` 
            const {parentPort} = require('worker_threads');
        
            parentPort.on('message', async (args) => {
                // Require and call the function for this specific task
                var response = {'type': 'success', 'value': undefined};
                try {
                    response.value = require(args.filePath)[args.functionName](...args.params);
            
                    // If the result is a Promise resolve it
                    if ( Promise.resolve(response.value) == response.value) {
                        try{
                            response.value = await response.value;
                        } catch(error){
                            response.type = 'error';
                            response.value = error;
                        }
                    }
                } catch (error) {
                    response.type = 'error';
                    response.value = error;
                }
            
                // Send the results back
                parentPort.postMessage(response);
            });
        `
    } else if (type === 'static') {
        return ` 
        const {parentPort} = require('worker_threads');
        const processingFunction = require("${filePath}")["${functionName}"];

        parentPort.on('message', async (args) => {
            // console.timeEnd(\`SENDING TO PROCESS \${args.id}\`)
            // Require and call the function for this specific task
            console.log("THE ARGS: ", args);
            var response = {'type': 'success', 'value': undefined, id: args.id};
            try {
                response.value = processingFunction(...args.params);
        
                // If the result is a Promise resolve it
                if ( Promise.resolve(response.value) == response.value) {
                    try{
                        response.value = await response.value;
                    } catch(error){
                        response.type = 'error';
                        response.value = error;
                    }
                }
            } catch (error) {
                response.type = 'error';
                response.value = error;
            }

            // Send the results back
            parentPort.postMessage(response);
        });
    `
    }
}

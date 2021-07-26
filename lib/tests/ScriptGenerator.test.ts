import { genetateScript } from '../src/ScriptGenerator';

test('generateScript - dynamic script', () => {
    let expectedDynamicScript, actualDynamicScript;

    expectedDynamicScript = ` 
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
    `.replace(/\s+|\r?\n|\r/g, '');

    actualDynamicScript = genetateScript('dynamic').replace(/\s+|\r?\n|\r/g, '');

    expect(actualDynamicScript).toBe(expectedDynamicScript);
});
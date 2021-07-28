import { Task } from "../src/Task";
import { TaskWorker } from "../src/TaskWorker";

const script = ` 
        const {parentPort} = require('worker_threads');
        const processingFunction = (a, b) => a + b;

        parentPort.on('message', async (args) => {
            // Require and call the function for this specific task
            var response = {'type': 'success', 'value': undefined};
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
    `;

const script_throwing_err = ` 
        const {parentPort} = require('worker_threads');
        const processingFunction = () => { throw new Error('test') };

        parentPort.on('message', async (args) => {
            // Require and call the function for this specific task
            var response = {'type': 'success', 'value': undefined};
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
    `;

test('TaskWorker instantiation', done => {
    let testTaskWorker = new TaskWorker(script, {eval: true});
    expect(testTaskWorker).toBeInstanceOf(TaskWorker);

    // Teardown the worker
    testTaskWorker.terminate().then(() => done());
});

test('TaskWorker fails when provided a wrong path to script', done => {
    function createTaskWorker () {
        let testTaskWorker: TaskWorker;
        try {
            testTaskWorker = new TaskWorker('A', {});
            
            // Teardown the worker
            testTaskWorker.terminate().then(() => done());
        } catch (error) {
            throw error;
        }
    }
    
    expect(createTaskWorker).toThrowError();
    done();
});

test('TaskWorker isBusy() must return true when it is processing something', done => {
    let testTaskWorker = new TaskWorker(script, {eval: true});
    testTaskWorker.processTask(new Task('Add', [2, 3], () => {}, () => {}));
    expect(testTaskWorker.isBusy()).toBe(true); // Can be flaky :)

    testTaskWorker.terminate().then(() => done());
});

test('TaskWorker isBusy() must return false when it is not processing something', done => {
    let testTaskWorker = new TaskWorker(script, {eval: true});
    expect(testTaskWorker.isBusy()).toBe(false);

    testTaskWorker.terminate().then(() => done());
});

test('TaskWorker reject callback should be called when an error occurs in the function being processed', done => {
    let testTaskWorker = new TaskWorker(script_throwing_err, {eval: true});
    
    async function runProcess() {
        try {
            await testTaskWorker.processTask(new Task('error', [], () => {}, () => {}));
        } catch (response) {
            expect(response.error).toEqual(new Error('test'));
            testTaskWorker.terminate().then(() => done());
        }
    }

    runProcess();
});

test('TaskWorker resolve callback should be called when an the function being processed finishes execution', done => {
    let testTaskWorker = new TaskWorker(script, {eval: true});
    
    async function runProcess() {
        try {
            let response = await testTaskWorker.processTask(new Task('Add', [2, 3], () => {}, () => {}));
            expect(response.result).toEqual(5);
        } catch (response) {
            fail();
        }

        testTaskWorker.terminate().then(() => done());
    }

    runProcess();
});
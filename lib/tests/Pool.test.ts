import {Pool} from '../src/Pool';
import isMainThread from 'worker_threads';

test('Instantiating pool object', ()=>{
    let testPool = new Pool();
    expect(testPool).toBeInstanceOf(Pool);
    testPool.terminate(true);
});

test('Error if a task runner have no name', () => {
    // Some function to be made asynchronous
    function add (a, b) {
        return a + b;
    }

    function sub (a, b) {
        return a - b;
    }

    module.exports.add = add;
    module.exports.sub = sub;

    const testPool = new Pool({
        taskRunners: [
            {name: 'add', job: add, threadCount: 4, static: true},
            {name: 'sub', job: sub, threadCount: 4, static: true},
        ],
        threadCount: 8,
    });

    testPool.terminate(true);
});
# workers-pool
Creating truly asynchronus functions has never been easier!  
      
![npm](https://img.shields.io/npm/dt/workers-pool)
![NPM](https://img.shields.io/npm/l/workers-pool)
![npm](https://img.shields.io/npm/v/workers-pool)
    
The `workers-pool` package allows you to easily create a pool of workers, pass them
some heavy tasks in the form of functions, and use the generated async function as 
asynchronous Promise-based functions.

**Important note 1:** This is not yet fully tested, so be careful while using it!  
**Important note 2:** Currently there is supports for only node environment!

## Installing the package
```js
npm i workers-pool
```

## Usage
### Adding `TaskRunners` statically    

`functions.js`
```js
const { Pool } = require('workers-pool');
const {isMainThread} = require('worker_threads');

// Some function to be made asynchronous
function add (a, b) {
    return a + b;
}

function sub (a, b) {
    return a - b;
}

// Step 1: export the functions
module.exports.add = add;
module.exports.sub = sub;

if (isMainThread){
    // Step 2: create a pool (can create a 
    // separate pool for separate functions)
    const myPool = new Pool({
        taskRunners: [
            {name: 'add', job: add, threadCount: 4, lockToThreads: true},
            {name: 'sub', job: sub, threadCount: 4, lockToThreads: true},
        ],
        totalThreadCount: 8,
    });

    // Step 3: generate the async version of the functions
    let addAsync = myPool.getAsyncFunc('add');
    let subAsync = myPool.getAsyncFunc('sub');

    // Step 4: export the new async functions
    module.exports.addAsync = addAsync;
    module.exports.subAsync = subAsync;
    module.exports.myPool = myPool;
}
```

`index.js`
```js
const {addAsync, subAsync, myPool} = require('./functions.js')
    
async function test() {
    try {
        let result = await addAsync(2, 5);
        console.log(result); // output: 7
    } catch (error) {
        console.log(error);
    }

    try {
        let result = await subAsync(100, 10);
        console.log(result) // output: 90
    } catch (error) {
        console.log(error);
    }
}

test().then(() => {
    myPool.terminate();
});
```
Note `isMainThread` is essential to defferentiate whether a file is being run in the main 
thread or a worker thread, so it can be used to prevent certain parts of the code, especially 
pool and async functions creation, from being recursively run as shown in the example.

### Adding `TaskRunners` dynamically
To allow dynamical addition of functions to workers, you only to enable the option of `allowDynamicTaskRunnerAddition`.

You can still have static ones, but make sure that the `totalThreadCount` is more than the sume of `threadCount` of each static `taskRunner` since they can cause a starvation for the dynamic ones.

`index.js`
```js
const { Pool } = require('workers-pool');
const {isMainThread} = require('worker_threads');

// Some function to be made asynchronous
function mul (a, b) {
    return a * b;
}

function add (a, b) {
    return a + b;
}

function sub (a, b) {
    return a - b;
}

// Export the functions
module.exports.add = add;
module.exports.sub = sub;
module.exports.mul = mul;

if (isMainThread) {
    // Create the pool with some static TaskRunners (if wanted)
    const myPool = new Pool({
        taskRunners: [
            {name: 'add', job: add, threadCount: 2, lockToThreads: true}, // Static
            {name: 'sub', job: sub, threadCount: 2, lockToThreads: true}, // Static
        ],
        totalThreadCount: 5,
        allowDynamicTaskRunnerAddition: true,
    });
    
    // Then finally, to add a dynamic TaskRunner call addTaskRunner(TaskRunner[])
    myPool.addTaskRunner({name: 'multiply', job: mul}); // Dynamic
    let mulAsync = myPool.getAsyncFunc('multiply');

    // Use the async function
    mulAsync(2, 5).then((answer) => {
        console.log(answer);
    });
}
```

### Difference between static and dynamic TaskRunners     
The dynamic `TaskRunnres` are not bound to a worker thread; therefore, at every call to the generated 
async function corresponding to them, they are required by a different thread and executed there.

The static `TaskRunners` on the other hand, they are required by the worker thread at its instantiation and
they are bound to it.

As a result, we can have more of the dynamic `TaskRunners` with a smaller number of threads; however, static `TaskRunners`
execute faster since there is no overhead of requiring the function everytime we try to execute the generated async function
corresponfing to it.

### Stats
You can also get the statistics of the pools:
```js
const Pool = require('workers-pool');

Pool.stats();     // brief info about the pools
Pool.stats(true); // Verbose info about the pools
```

### terminate
You can terminate all the threads in the pool at once by calling:
```js
myPool.terminate(true);
```
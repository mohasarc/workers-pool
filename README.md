# workers-pool
Creating truly asynchronus functions has never been easier!  
      
![npm](https://img.shields.io/npm/dt/workers-pool)

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
            {name: 'add', job: add, threadCount: 4},
            {name: 'sub', job: sub, threadCount: 4},
        ],
        totalThreadCount: 8,
        lockTaskRunnersToThreads: true,
        allowDynamicTaskRunnerAddition: false,
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

### Stats
You can also get the statistics of the pools:
```js
const Pool = require('workers-pool');

Pool.stats();     // brief info about the pools
Pool.stats(true); // Verbose info about the pools
```